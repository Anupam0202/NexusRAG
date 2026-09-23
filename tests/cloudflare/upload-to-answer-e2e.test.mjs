import test from "node:test";
import assert from "node:assert/strict";
import { handleQueue } from "../../apps/gateway/src/worker-jobs.js";
import { handle } from "../../apps/gateway/src/preview-worker.js";
import { chunkText } from "../../apps/gateway/src/worker-pipeline.js";

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
  const objects = new Map();
  const points = new Map();
  const sessions = new Map();
  const messages = [];
  const outbound = [];
  const auditEvents = [];
  const deletionReceipts = [];
  const deletionTargets = new Map();
  let deletionOperation = null;
  const events = [];
  const queue = { sent: [], async send(body) { this.sent.push(body); } };
  const env = {
    SUPABASE_URL: "https://supabase.invalid",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-only",
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
    events.push({ host: url.hostname, path: url.pathname, method });

    if (url.hostname === "supabase.invalid" && url.pathname === "/auth/v1/user") return json(user);
    if (url.hostname === "supabase.invalid" && url.pathname.startsWith("/storage/v1/object/")) {
      const key = decodeURIComponent(url.pathname.split("/documents/")[1] || "");
      if (method === "POST") { objects.set(key, new Uint8Array(await init.body.arrayBuffer())); return json({ Key: key }); }
      if (method === "DELETE") { objects.delete(key); return new Response(null, { status: 204 }); }
      if (method === "GET") return objects.has(key) ? new Response(objects.get(key), { status: 200 }) : json({ code: "NoSuchKey" }, 404);
    }
    if (url.hostname === "supabase.invalid" && url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/rest/v1/")[1];
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
        if (method === "GET") { const id = url.searchParams.get("id")?.replace(/^eq\./, ""); return json(versions.has(id) ? [structuredClone(versions.get(id))] : []); }
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
          return json({ state: "ready", chunks: doc.chunk_count });
        }
        throw new Error(`Unexpected RPC: ${rpc}`);
      }
      throw new Error(`Unexpected local Supabase request: ${method} ${table}${url.search}`);
    }
    if (url.hostname === "generativelanguage.googleapis.com") {
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
  return { env, user, source, expectedChunks, docs, versions, jobs, chunks, objects, points, sessions, messages, outbound, auditEvents, deletionReceipts, deletionTargets, events, queue, fetch, get deletionOperation() { return deletionOperation; }, get embeddingCalls() { return embeddingCalls; }, get generationCalls() { return generationCalls; } };
}

test("synthetic upload → queued ingestion → indexed evidence → grounded chat completes without external calls", async (t) => {
  const fixture = localAppFixture();
  t.mock.method(globalThis, "fetch", fixture.fetch);
  const file = new File([fixture.source], "retention-policy.txt", { type: "text/plain" });
  const form = new FormData(); form.set("file", file);
  const upload = await handle(new Request("https://gateway.invalid/api/v1/documents/upload", {
    method: "POST", headers: { authorization: "Bearer synthetic-oauth-token", "x-nexus-workspace-id": workspace }, body: form,
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
  assert.equal(fixture.chunks.get(version.id).length, fixture.expectedChunks);
  assert.equal(fixture.points.size, fixture.expectedChunks);
  assert.equal(doc.status, "ready");
  assert.equal(fixture.jobs.get(uploaded.job_id).status, "completed");
  assert.equal(acked.length, 2, "each batch is acknowledged after durable cursor advancement/completion");
  assert.ok(acked.every((state) => state === "ack"));

  const answerResponse = await handle(new Request("https://gateway.invalid/api/v1/chat", {
    method: "POST", headers: { authorization: "Bearer synthetic-oauth-token", "x-nexus-workspace-id": workspace, "content-type": "application/json" },
    body: JSON.stringify({ question: "What retention period does the policy specify?", document_ids: [doc.id], top_k: 8 }),
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
