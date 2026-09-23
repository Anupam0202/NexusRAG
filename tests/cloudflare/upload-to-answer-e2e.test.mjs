import test from "node:test";
import assert from "node:assert/strict";
import { handleQueue } from "../../apps/gateway/src/worker-jobs.js";
import { handle } from "../../apps/gateway/src/preview-worker.js";
import { chunkText } from "../../apps/gateway/src/worker-pipeline.js";
import { encryptGeminiKey } from "../../apps/gateway/src/user-gemini-key.js";

const workspace = "10101010-1010-4010-8010-101010101010";
const userId = "20202020-2020-4020-8020-202020202020";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function localAppFixture() {
  const user = { id: userId };
  const member = { workspace_id: workspace, user_id: userId, role: "owner" };
  const docs = new Map();
  const versions = new Map();
  const jobs = new Map();
  const chunks = new Map();
  const extractionManifests = new Map();
  const extractionChunks = new Map();
  const objects = new Map();
  const points = new Map();
  const sessions = new Map();
  const messages = [];
  const outbound = [];
  const auditEvents = [];
  const accountUsage = { free_chat_queries: 0, lifetime_documents: 0 };
  const accountOperations = new Set();
  const userKeys = new Map();
  const deletionReceipts = [];
  const deletionTargets = new Map();
  let deletionOperation = null;
  const events = [];
  const queue = { sent: [], async send(body) { this.sent.push(body); } };
  const env = {
    SUPABASE_URL: "https://supabase.invalid",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-only",
    GEMINI_USER_KEY_ENCRYPTION_SECRET: Buffer.alloc(32, 9).toString("base64"),
    QDRANT_URL: "https://qdrant.invalid",
    QDRANT_API_KEY: "synthetic-qdrant-only",
    QDRANT_COLLECTION: "nexusrag-e2e",
    GOOGLE_API_KEY: "synthetic-gemini-only",
    GEMINI_EMBEDDING_MODEL: "gemini-embedding-001",
    GEMINI_MODEL: "gemini-2.5-flash",
    FRONTEND_ORIGIN: "https://app.invalid",
    INGESTION_QUEUE: queue,
  };
  const source = `${"The published policy sets evidence retention at 30 days. ".repeat(120)}\n`;
  const expectedChunks = chunkText(source).length;
  assert.ok(expectedChunks > 3 && expectedChunks <= 400, `fixture must exercise bounded batches, got ${expectedChunks}`);
  let embeddingCalls = 0;
  let generationCalls = 0;
  let expectedGeminiApiKey = null;
  const matchesFilter = (point, filter) => (filter?.must || []).every((condition) => {
    const actual = point.payload?.[condition.key];
    if (condition.match?.value !== undefined) return actual === condition.match.value;
    if (condition.match?.any) return condition.match.any.includes(actual);
    return false;
  });
  const fetch = async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    const method = init.method || "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    events.push({ host: url.hostname, path: url.pathname, method, userKeyHeader: new Headers(init.headers || {}).has("x-goog-api-key") });

    if (url.hostname === "supabase.invalid" && url.pathname === "/auth/v1/user") return json(user);
    if (url.hostname === "supabase.invalid" && url.pathname.startsWith("/storage/v1/object/")) {
      const key = decodeURIComponent(url.pathname.split("/documents/")[1] || "");
      if (method === "POST") { objects.set(key, new Uint8Array(await init.body.arrayBuffer())); return json({ Key: key }); }
      if (method === "DELETE") { objects.delete(key); return new Response(null, { status: 204 }); }
      if (method === "GET") return objects.has(key) ? new Response(objects.get(key), { status: 200 }) : json({ code: "NoSuchKey" }, 404);
    }
    if (url.hostname === "supabase.invalid" && url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/rest/v1/")[1];
      if (table.startsWith("nexus_user_provider_keys")) {
        const userKey = userKeys.get(userId);
        return json(userKey ? [structuredClone(userKey)] : []);
      }
      if (table === "workspace_members") return json([member]);
      if (table === "documents") {
        if (method === "POST") {
          for (const row of body) docs.set(row.id, { ...row, lifecycle_state: "active", lifecycle_epoch: 1, active_version_id: null, created_at: new Date().toISOString(), revision: 1 });
          return json(body.map((row) => docs.get(row.id)), 201);
        }
        if (method === "GET") {
          const idFilter = url.searchParams.get("id") || "";
          if (idFilter.startsWith("eq.")) { const id = idFilter.slice(3); return json(docs.has(id) ? [structuredClone(docs.get(id))] : []); }
          if (url.searchParams.has("active_version_id")) return json([...docs.values()].filter((row) => row.workspace_id === workspace && row.lifecycle_state === "active" && row.active_version_id && (!idFilter.startsWith("in.(") || idFilter.slice(4, -1).split(",").includes(row.id))).map((row) => ({ id: row.id, active_version_id: row.active_version_id })));
          if (url.searchParams.has("sha256")) return json([]);
          return json([...docs.values()].filter((row) => row.workspace_id === workspace));
        }
        if (method === "DELETE") { docs.delete(url.searchParams.get("id")?.slice(3)); return json([]); }
      }
      if (table === "document_versions") {
        if (method === "POST") { for (const row of body) versions.set(row.id, { ...row }); return json(body.map((row) => versions.get(row.id)), 201); }
        if (method === "GET") { const id = url.searchParams.get("id")?.replace(/^eq\./, ""); if (id) return json(versions.has(id) ? [structuredClone(versions.get(id))] : []); return json([...versions.values()].filter((row) => row.workspace_id === workspace && row.publication_state === "ready" && row.data_classification === "non_sensitive").map((row) => ({ id: row.id, document_id: row.document_id }))); }
      }
      if (table === "ingestion_jobs") {
        if (method === "POST") { for (const row of body) jobs.set(row.id, { ...row, lease_generation: 0, max_attempts: row.max_attempts || 3, cancellation_requested_at: null }); return json(body.map((row) => jobs.get(row.id)), 201); }
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        if (method === "GET") return json(jobs.has(id) ? [structuredClone(jobs.get(id))] : []);
        if (method === "PATCH") {
          const job = jobs.get(id);
          if (!job) return json([]);
          Object.assign(job, body);
          return json([structuredClone(job)]);
        }
      }
      if (table === "document_chunks") {
        const rawVersion = url.searchParams.get("version_id") || "";
        const versionId = rawVersion.startsWith("eq.") ? rawVersion.slice(3) : rawVersion.startsWith("in.(") ? rawVersion.slice(4, -1).split(",")[0] : "";
        if (method === "DELETE") { chunks.delete(versionId); return json([]); }
        if (method === "GET") return json(chunks.get(versionId) || []);
      }
      if (table === "deletion_operations") {
        if (method === "PATCH") { if (deletionOperation) Object.assign(deletionOperation, body); return json(deletionOperation ? [deletionOperation] : []); }
        if (method === "GET") return json(deletionOperation ? [deletionOperation] : []);
      }
      if (table === "deletion_targets") {
        if (method === "GET") return json([...deletionTargets.values()]);
        if (method === "PATCH") { const target = deletionTargets.get(url.searchParams.get("id")?.slice(3)); if (target) Object.assign(target, body); return json(target ? [target] : []); }
      }
      if (table === "deletion_receipts" && method === "POST") { deletionReceipts.push(...body); return json(body, 201); }
      if (table === "chat_sessions") {
        if (method === "POST") { for (const row of body) sessions.set(row.id, { ...row, revision: 1, deleted_at: null }); return json(body.map((row) => sessions.get(row.id)), 201); }
        if (method === "GET") { const id = url.searchParams.get("id")?.replace(/^eq\./, ""); return json(sessions.has(id) ? [sessions.get(id)] : []); }
        if (method === "PATCH") { const id = url.searchParams.get("id")?.replace(/^eq\./, ""); if (sessions.has(id)) Object.assign(sessions.get(id), body); return json(sessions.has(id) ? [sessions.get(id)] : []); }
      }
      if (table === "chat_messages" && method === "POST") { messages.push(...body); return json(body, 201); }
      if (table === "audit_events" && method === "POST") { auditEvents.push(...body); return json(body, 201); }
      if (table === "llm_usage_events" && method === "POST") return json(body, 201);
      if (table.startsWith("rpc/")) {
        const rpc = table.slice("rpc/".length);
        if (rpc === "nexus_admit_account_operation") {
          const operationKey = `${body.p_user}:${body.p_operation}:${body.p_idempotency_key}`;
          if (accountOperations.has(operationKey)) return json({ state: "READY", replayed: true, credential_mode: "platform_trial" });
          accountOperations.add(operationKey);
          if (body.p_operation === "chat") {
            if (accountUsage.free_chat_queries >= 5) return json({ state: "BYOK_REQUIRED", used: 5, limit: 5, credential_mode: "none" });
            accountUsage.free_chat_queries += 1;
            return json({ state: "READY", used: accountUsage.free_chat_queries, limit: 5, credential_mode: "platform_trial" });
          }
          if (accountUsage.lifetime_documents >= 10) return json({ state: "CAPACITY_REACHED", used: 10, limit: 10, credential_mode: "none" });
          if (accountUsage.lifetime_documents >= 1 && !userKeys.has(body.p_user)) return json({ state: "BYOK_REQUIRED", used: accountUsage.lifetime_documents, limit: 10, credential_mode: "none" });
          accountUsage.lifetime_documents += 1;
          return json({ state: "READY", used: accountUsage.lifetime_documents, limit: 10, credential_mode: accountUsage.lifetime_documents === 1 ? "platform_trial" : "user_byok" });
        }
        if (rpc === "tombstone_document") {
          const doc = docs.get(body.p_document); assert.ok(doc); doc.lifecycle_state = "deleting";
          deletionOperation = { id: crypto.randomUUID(), workspace_id: workspace, resource_id: doc.id, state: "pending" };
          const version = versions.get(doc.active_version_id);
          for (const target of [
            { id: crypto.randomUUID(), kind: "version_index", object_key: null },
            { id: crypto.randomUUID(), kind: "original", object_key: version.original_key },
          ]) deletionTargets.set(target.id, { ...target, workspace_id: workspace, operation_id: deletionOperation.id, verified_at: null, attempts: 0 });
          return json(deletionOperation.id);
        }
        if (rpc === "v6_reserve_many") return json({ state: "READY", reservations: Object.entries(body.p_dimensions).map(([dimension, amount]) => ({ id: crypto.randomUUID(), amount, dimension })) });
        if (rpc === "v6_settle_many") return json({ state: body.p_provider_called ? "SETTLED" : "RELEASED" });
        if (rpc === "workbench_read_extracted_batch") {
          const manifest = extractionManifests.get(body.p_job);
          if (!manifest) return json({ found: false });
          return json({
            found: true, total_chunks: manifest.total_chunks, manifest: manifest.extraction_manifest,
            chunks: [...(extractionChunks.get(body.p_job)?.values() || [])].filter((row) => row.ordinal >= body.p_offset).slice(0, body.p_limit),
          });
        }
        if (rpc === "workbench_store_extracted_chunks") {
          const oldManifest = extractionManifests.get(body.p_job);
          if (oldManifest) assert.deepEqual(oldManifest.extraction_manifest, body.p_manifest);
          const stored = extractionChunks.get(body.p_job) || new Map();
          assert.equal(body.p_chunks.length, body.p_total_chunks);
          for (const row of body.p_chunks) {
            const existing = stored.get(row.ordinal);
            if (existing) assert.deepEqual(existing, row);
            else stored.set(row.ordinal, row);
          }
          extractionChunks.set(body.p_job, stored);
          extractionManifests.set(body.p_job, { total_chunks: body.p_total_chunks, extraction_manifest: body.p_manifest });
          const version = versions.get(body.p_version);
          version.index_generation = body.p_index;
          version.publication_state = "processing";
          version.extraction_manifest = { ...body.p_manifest, expected_chunks: body.p_total_chunks };
          return json({ found: true, count: stored.size, total_chunks: body.p_total_chunks, manifest: body.p_manifest });
        }
        if (rpc === "workbench_stage_chunk_batch") {
          const stored = chunks.get(body.p_version) || [];
          for (const row of body.p_chunks) {
            const existing = stored.find((item) => item.chunk_index === row.ordinal);
            if (existing) assert.equal(existing.original_content_hash, row.original_content_hash);
            else stored.push({ id: row.chunk_id, workspace_id: row.workspace_id, document_id: row.document_id, version_id: row.version_id, chunk_index: row.ordinal, content: row.original_text, original_content_hash: row.original_content_hash, metadata: { filename: docs.get(row.document_id).filename, content: row.retrieval_text }, page_number: 0 });
          }
          chunks.set(body.p_version, stored);
          return json({ count: stored.length, expected_chunks: body.p_total_chunks, manifest_hash: "a".repeat(64), next_offset: body.p_offset + body.p_chunks.length });
        }
        if (rpc === "workbench_finalize_chunk_stage") return json({ count: chunks.get(body.p_version)?.length || 0, manifest_hash: "a".repeat(64), index_generation: versions.get(body.p_version).index_generation });
        if (rpc === "workbench_publish_version") {
          const version = versions.get(body.p_version); const doc = docs.get(version.document_id); const job = jobs.get(body.p_job);
          version.publication_state = "ready"; doc.active_version_id = version.id; doc.status = "ready"; doc.chunk_count = chunks.get(version.id)?.length || 0; job.status = "completed";
          extractionManifests.delete(body.p_job); extractionChunks.delete(body.p_job);
          return json({ state: "ready", chunks: doc.chunk_count });
        }
        throw new Error(`Unexpected RPC: ${rpc}`);
      }
      throw new Error(`Unexpected local Supabase request: ${method} ${table}${url.search}`);
    }
    if (url.hostname === "generativelanguage.googleapis.com") {
      assert.equal(url.searchParams.get("key"), null, "Gemini API keys must never be placed in provider URLs");
      if (expectedGeminiApiKey) assert.equal(new Headers(init.headers || {}).get("x-goog-api-key"), expectedGeminiApiKey);
      if (url.pathname.endsWith(":embedContent")) { embeddingCalls += 1; return json({ embedding: { values: Array(768).fill(0.01) } }); }
      if (url.pathname.endsWith(":generateContent")) { generationCalls += 1; return json({ candidates: [{ content: { parts: [{ text: "The evidence describes a 30-day retention policy. [S1]" }] } }], usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 12 } }); }
    }
    if (url.hostname === "qdrant.invalid") {
      if (url.pathname.endsWith("/points/delete")) { for (const [id, point] of points) if (matchesFilter(point, body.filter)) points.delete(id); return json({ result: { status: "completed" } }); }
      if (url.pathname.endsWith("/points/count")) return json({ result: { count: [...points.values()].filter((point) => matchesFilter(point, body.filter)).length } });
      if (url.pathname.endsWith("/points/query")) return json({ result: { points: [...points.values()].filter((point) => matchesFilter(point, body.filter)).slice(0, body.limit).map((point, index) => ({ id: point.id, payload: point.payload, score: 1 - index / 100 })) } });
      if (url.pathname.includes("/collections/") && url.pathname.endsWith("/index")) return json({ result: true });
      if (url.pathname.includes("/collections/") && url.pathname.endsWith("/points")) { for (const point of body.points) points.set(point.id, point); return json({ result: { status: "completed" } }); }
      if (url.pathname.includes("/collections/")) return json({ result: { status: "green" } });
    }
    throw new Error(`Unexpected synthetic network request: ${method} ${url.href}`);
  };
  return { env, user, source, expectedChunks, docs, versions, jobs, chunks, extractionManifests, extractionChunks, objects, points, sessions, messages, outbound, auditEvents, deletionReceipts, deletionTargets, events, queue, accountUsage, userKeys, fetch, setExpectedGeminiApiKey(value) { expectedGeminiApiKey = value; }, get deletionOperation() { return deletionOperation; }, get embeddingCalls() { return embeddingCalls; }, get generationCalls() { return generationCalls; } };
}

test("synthetic upload → queued ingestion → indexed evidence → grounded chat completes without external calls", async (t) => {
  const fixture = localAppFixture();
  t.mock.method(globalThis, "fetch", fixture.fetch);
  const file = new File([fixture.source], "retention-policy.txt", { type: "text/plain" });
  const form = new FormData(); form.set("file", file); form.set("data_classification", "non_sensitive"); form.set("non_sensitive_attested", "true");
  const upload = await handle(new Request("https://gateway.invalid/api/v1/documents/upload", {
    method: "POST", headers: { authorization: "Bearer synthetic-oauth-token", "x-nexus-workspace-id": workspace, "idempotency-key": crypto.randomUUID() }, body: form,
  }), fixture.env);
  assert.equal(upload.status, 202);
  const uploaded = await upload.json();
  assert.equal(fixture.objects.size, 1);
  assert.equal(fixture.queue.sent.length, 1);
  assert.equal(fixture.jobs.get(uploaded.job_id).status, "queued");

  const acked = [];
  while (fixture.queue.sent.length) {
    const body = fixture.queue.sent.shift();
    await handleQueue({ messages: [{ body, ack() { acked.push("ack"); }, retry() { acked.push("retry"); } }] }, fixture.env);
  }
  assert.ok(fixture.expectedChunks > 3);
  const doc = fixture.docs.get(uploaded.document.document_id);
  const version = fixture.versions.get(doc.active_version_id);
  assert.equal(version.data_classification, "non_sensitive");
  assert.equal(version.classification_declared_by, userId);
  assert.equal(fixture.chunks.get(version.id).length, fixture.expectedChunks);
  assert.equal(fixture.points.size, fixture.expectedChunks);
  assert.equal(doc.status, "ready");
  assert.equal(fixture.jobs.get(uploaded.job_id).status, "completed");
  assert.equal(fixture.extractionManifests.size, 0, "terminal publication purges temporary extracted text");
  assert.equal(fixture.events.filter((event) => event.path.startsWith("/storage/v1/object/") && event.method === "GET").length, 1, "the original is read only once across batches");
  assert.equal(acked.length, 2, "each batch is acknowledged after durable cursor advancement/completion");
  assert.ok(acked.every((state) => state === "ack"));

  const answerResponse = await handle(new Request("https://gateway.invalid/api/v1/chat", {
    method: "POST", headers: { authorization: "Bearer synthetic-oauth-token", "x-nexus-workspace-id": workspace, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ question: "What retention period does the policy specify?", non_sensitive_attested: true, document_ids: [doc.id], top_k: 8 }),
  }), fixture.env);
  assert.equal(answerResponse.status, 200);
  const answer = await answerResponse.json();
  assert.match(answer.answer, /30-day retention policy/);
  assert.equal(answer.metadata.claim_state, "REVIEW_REQUIRED", "citation does not imply semantic verification");
  assert.equal(answer.metadata.paid_fallback, false);
  assert.ok(answer.sources.length > 0);
  assert.ok(fixture.embeddingCalls > fixture.expectedChunks, "both indexing and retrieval embeddings are exercised");
  assert.equal(fixture.generationCalls, 1);
  assert.equal(fixture.messages.filter((message) => message.role === "assistant").length, 1);
  assert.ok(fixture.auditEvents.length >= 1);

  const deletionResponse = await handle(new Request(`https://gateway.invalid/api/v1/documents/${doc.id}/delete`, {
    method: "POST", headers: { authorization: "Bearer synthetic-oauth-token", "x-nexus-workspace-id": workspace },
  }), fixture.env);
  assert.equal(deletionResponse.status, 200);
  const deletion = await deletionResponse.json();
  assert.equal(deletion.success, true);
  assert.equal(fixture.deletionOperation.state, "verified");
  assert.equal(fixture.deletionReceipts.length, 2);
  assert.equal(fixture.objects.size, 0, "private original deletion is verified by a subsequent read");
  assert.equal(fixture.points.size, 0, "Qdrant deletion is verified by an exact count");
  assert.equal(fixture.docs.has(doc.id), false, "authoritative document row is removed only after receipts");
  assert.ok(fixture.auditEvents.length >= 2);
  assert.ok(fixture.events.every((event) => ["supabase.invalid", "qdrant.invalid", "generativelanguage.googleapis.com"].includes(event.host)));
});

test("upload without non-sensitive attestation is denied before storage and database writes", async (t) => {
  const fixture = localAppFixture();
  t.mock.method(globalThis, "fetch", fixture.fetch);
  const form = new FormData();
  form.set("file", new File(["synthetic"], "unclassified.txt", { type: "text/plain" }));
  const response = await handle(new Request("https://gateway.invalid/api/v1/documents/upload", {
    method: "POST", headers: { authorization: "Bearer synthetic-oauth-token", "x-nexus-workspace-id": workspace }, body: form,
  }), fixture.env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "RIGHTS_BLOCKED");
  assert.equal(fixture.objects.size, 0);
  assert.equal(fixture.docs.size, 0);
  assert.equal(fixture.queue.sent.length, 0);
  assert.equal(fixture.embeddingCalls, 0);
  assert.equal(fixture.generationCalls, 0);
});

test("chat without non-sensitive prompt attestation is denied before persistence", async (t) => {
  const fixture = localAppFixture();
  t.mock.method(globalThis, "fetch", fixture.fetch);
  const response = await handle(new Request("https://gateway.invalid/api/v1/chat", {
    method: "POST",
    headers: { authorization: "Bearer synthetic-oauth-token", "x-nexus-workspace-id": workspace, "content-type": "application/json" },
    body: JSON.stringify({ question: "synthetic sensitive question" }),
  }), fixture.env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "RIGHTS_BLOCKED");
  assert.equal(fixture.messages.length, 0);
  assert.equal(fixture.embeddingCalls, 0);
  assert.equal(fixture.generationCalls, 0);
});

test("the sixth account chat query is denied before any provider or message write", async (t) => {
  const fixture = localAppFixture();
  fixture.accountUsage.free_chat_queries = 5;
  t.mock.method(globalThis, "fetch", fixture.fetch);
  const response = await handle(new Request("https://gateway.invalid/api/v1/chat", {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-oauth-token",
      "x-nexus-workspace-id": workspace,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({ question: "Summarize this policy", non_sensitive_attested: true }),
  }), fixture.env);
  assert.equal(response.status, 402);
  assert.equal((await response.json()).error.code, "BYOK_REQUIRED");
  assert.equal(fixture.generationCalls, 0);
  assert.equal(fixture.embeddingCalls, 0);
  assert.equal(fixture.messages.length, 0);
});

test("a second document is denied before storage until account BYOK is configured", async (t) => {
  const fixture = localAppFixture();
  fixture.accountUsage.lifetime_documents = 1;
  t.mock.method(globalThis, "fetch", fixture.fetch);
  const form = new FormData();
  form.set("file", new File(["another document"], "second.txt", { type: "text/plain" }));
  form.set("data_classification", "non_sensitive");
  form.set("non_sensitive_attested", "true");
  const response = await handle(new Request("https://gateway.invalid/api/v1/documents/upload", {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-oauth-token",
      "x-nexus-workspace-id": workspace,
      "idempotency-key": crypto.randomUUID(),
    },
    body: form,
  }), fixture.env);
  assert.equal(response.status, 402);
  assert.equal((await response.json()).error.code, "BYOK_REQUIRED");
  assert.equal(fixture.objects.size, 0);
  assert.equal(fixture.queue.sent.length, 0);
});

test("a BYOK-authorized PDF uses the uploader's encrypted key for extraction and queued embeddings", async (t) => {
  const fixture = localAppFixture();
  fixture.accountUsage.lifetime_documents = 1;
  const rawKey = "AIzaSyntheticUploaderKey000000000000";
  const sealed = await encryptGeminiKey(fixture.env, rawKey);
  fixture.userKeys.set(userId, {
    user_id: userId, provider: "gemini", ...sealed, key_fingerprint: "…0000", is_active: true,
  });
  fixture.setExpectedGeminiApiKey(rawKey);
  t.mock.method(globalThis, "fetch", fixture.fetch);
  const form = new FormData();
  form.set("file", new File(["%PDF-1.4 synthetic"], "second.pdf", { type: "application/pdf" }));
  form.set("data_classification", "non_sensitive");
  form.set("non_sensitive_attested", "true");
  const response = await handle(new Request("https://gateway.invalid/api/v1/documents/upload", {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-oauth-token",
      "x-nexus-workspace-id": workspace,
      "idempotency-key": crypto.randomUUID(),
    },
    body: form,
  }), fixture.env);
  assert.equal(response.status, 202, await response.clone().text());
  const uploaded = await response.json();
  assert.equal(fixture.jobs.get(uploaded.job_id).payload.provider_mode, "user_byok");
  assert.equal(fixture.queue.sent.length, 1);
  const acknowledgements = [];
  await handleQueue({
    messages: [{
      body: fixture.queue.sent.shift(),
      ack() { acknowledgements.push("ack"); },
      retry() { acknowledgements.push("retry"); },
    }],
  }, fixture.env);
  assert.deepEqual(acknowledgements, ["ack"]);
  assert.equal(fixture.docs.get(uploaded.document.document_id).status, "ready");
  assert.equal(fixture.extractionManifests.size, 0);
  assert.ok(fixture.events.filter((event) => event.host === "generativelanguage.googleapis.com").length >= 2);
  assert.ok(fixture.events.filter((event) => event.host === "generativelanguage.googleapis.com").every((event) => event.userKeyHeader));
  assert.ok(fixture.events.filter((event) => event.host === "generativelanguage.googleapis.com").every((event) => !event.path.includes(rawKey)));
});
