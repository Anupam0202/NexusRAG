import test from "node:test";
import assert from "node:assert/strict";
import { processIngestionMessage } from "../../apps/gateway/src/worker-jobs.js";
import { chunkText } from "../../apps/gateway/src/worker-pipeline.js";
import { handle } from "../../apps/gateway/src/preview-worker.js";

const workspace = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";
const generation = "55555555-5555-4555-8555-555555555555";
const userId = "66666666-6666-4666-8666-666666666666";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const configured = {
  SUPABASE_URL: "https://supabase.invalid",
  SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-only",
  QDRANT_URL: "https://qdrant.invalid",
  QDRANT_API_KEY: "synthetic-qdrant-only",
  GOOGLE_API_KEY: "synthetic-gemini-only",
  GEMINI_EMBEDDING_MODEL: "gemini-embedding-001",
  INGESTION_QUEUE: { sent: [], async send(message) { this.sent.push(message); } },
};

function fakeIngestionFetch(sourceOrOptions = "Reviewed policy evidence. ".repeat(190)) {
  const options = typeof sourceOrOptions === "string" ? { source: sourceOrOptions } : sourceOrOptions;
  const source = options.source || "Reviewed policy evidence. ".repeat(190);
  const contentType = options.contentType || "text/plain";
  const extractedText = options.extractedText || source;
  const job = {
    id: jobId, workspace_id: workspace, document_id: documentId, version_id: versionId,
    lifecycle_epoch: 1, status: "queued", stage: "queued", progress: 0, attempts: 0,
    max_attempts: 3, lease_generation: 0, lease_owner: null, lease_expires_at: null,
    cancellation_requested_at: null, available_at: new Date(Date.now() - 60_000).toISOString(),
    kind: "ingestion", payload: { filename: "policy.txt", content_type: contentType, operation: "upload" },
  };
  const document = { id: documentId, workspace_id: workspace, filename: "policy.txt", content_type: contentType, lifecycle_epoch: 1, lifecycle_state: "active", active_version_id: null };
  const version = { id: versionId, workspace_id: workspace, document_id: documentId, original_bucket: "documents", original_key: `${workspace}/${documentId}/${versionId}/policy.txt`, index_generation: generation, publication_state: "staged" };
  const staged = new Map();
  const extraction = new Map();
  const points = new Map();
  const events = [];
  let extractionManifest = null;
  let extractionTotal = 0;
  let reservations = 0;
  let extractionCalls = 0;
  let failNextStage = false;
  const fetch = async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    const method = init.method || "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    events.push({ host: url.hostname, path: url.pathname, method });
    if (url.hostname === "supabase.invalid" && url.pathname.includes("/rest/v1/")) {
      const path = url.pathname.split("/rest/v1/")[1] + url.search;
      if (path.startsWith("ingestion_jobs?") && method === "GET") return json([structuredClone(job)]);
      if (path.startsWith("ingestion_jobs?") && method === "PATCH") { Object.assign(job, body); return json([structuredClone(job)]); }
      if (path.startsWith("documents?") && method === "GET") return json([structuredClone(document)]);
      if (path.startsWith("document_versions?") && method === "GET") return json([structuredClone(version)]);
      if (path.startsWith("rpc/v6_reserve_many")) {
        const values = Object.entries(body.p_dimensions).map(([dimension, amount]) => ({ id: crypto.randomUUID(), amount, dimension }));
        reservations += values.length;
        return json({ state: "READY", reservations: values });
      }
      if (path.startsWith("rpc/v6_settle_many")) return json({ state: body.p_provider_called ? "SETTLED" : "RELEASED" });
      if (path.startsWith("rpc/workbench_read_extracted_batch")) {
        if (!extractionManifest) return json({ found: false });
        return json({
          found: true, total_chunks: extractionTotal, manifest: extractionManifest,
          chunks: [...extraction.values()].filter((chunk) => chunk.ordinal >= body.p_offset).slice(0, body.p_limit),
        });
      }
      if (path.startsWith("rpc/workbench_store_extracted_chunks")) {
        assert.equal(body.p_chunks.length, body.p_total_chunks);
        extractionTotal = body.p_total_chunks;
        extractionManifest = body.p_manifest;
        for (const chunk of body.p_chunks) {
          const old = extraction.get(chunk.ordinal);
          if (old) assert.deepEqual(old, chunk, "extraction replay must be byte-identical");
          extraction.set(chunk.ordinal, chunk);
        }
        version.index_generation = body.p_index;
        version.publication_state = "processing";
        version.extraction_manifest = { ...body.p_manifest, expected_chunks: body.p_total_chunks };
        return json({ found: true, count: extraction.size, total_chunks: extractionTotal, manifest: extractionManifest });
      }
      if (path.startsWith("rpc/workbench_stage_chunk_batch")) {
        if (body.p_offset === 3 && failNextStage) {
          failNextStage = false;
          throw Object.assign(new Error("synthetic transient staging failure"), { retryable: true, code: "SYNTHETIC_TRANSIENT" });
        }
        assert.ok(body.p_chunks.length <= 3);
        for (const chunk of body.p_chunks) {
          const old = staged.get(chunk.ordinal);
          if (old) assert.equal(old.original_content_hash, chunk.original_content_hash, "replayed chunks must be identical");
          staged.set(chunk.ordinal, chunk);
        }
        return json({ count: staged.size, expected_chunks: body.p_total_chunks, manifest_hash: "a".repeat(64), next_offset: body.p_offset + body.p_chunks.length });
      }
      if (path.startsWith("rpc/workbench_finalize_chunk_stage")) return json({ count: staged.size, manifest_hash: "a".repeat(64), index_generation: generation });
      if (path.startsWith("rpc/workbench_publish_version")) {
        assert.equal(body.p_receipt.verified_vectors, staged.size);
        job.status = "completed";
        version.publication_state = "ready";
        extraction.clear();
        document.active_version_id = versionId;
        return json({ state: "ready", chunks: staged.size });
      }
      if (path.startsWith("document_chunks?") && method === "DELETE") { staged.clear(); return json([]); }
      throw new Error(`Unexpected Supabase request: ${method} ${path}`);
    }
    if (url.hostname === "supabase.invalid" && url.pathname.startsWith("/storage/v1/object/")) return new Response(source, { status: 200 });
    if (url.hostname === "generativelanguage.googleapis.com") {
      if (url.pathname.endsWith(":embedContent")) return json({ embedding: { values: Array(768).fill(0.01) } });
      if (url.pathname.endsWith(":generateContent")) {
        extractionCalls += 1;
        return json({ candidates: [{ content: { parts: [{ text: extractedText }] } }] });
      }
    }
    if (url.hostname === "qdrant.invalid") {
      if (url.pathname.endsWith("/points/delete")) {
        const must = body.filter.must;
        for (const [id, point] of points) if (must.every((filter) => point.payload[filter.key] === filter.match.value)) points.delete(id);
        return json({ result: { status: "completed" } });
      }
      if (url.pathname.endsWith("/points/count")) {
        const must = body.filter.must;
        const count = [...points.values()].filter((point) => must.every((filter) => point.payload[filter.key] === filter.match.value)).length;
        return json({ result: { count } });
      }
      if (url.pathname.includes("/collections/") && url.pathname.endsWith("/index")) return json({ result: true });
      if (url.pathname.includes("/collections/") && url.pathname.endsWith("/points")) {
        for (const point of body.points) points.set(point.id, point);
        return json({ result: { status: "completed" } });
      }
      if (url.pathname.includes("/collections/")) return json({ result: { status: "green" } });
    }
    throw new Error(`Unexpected external request: ${method} ${url.href}`);
  };
  return { fetch, job, document, version, staged, extraction, points, events, failNextStage() { failNextStage = true; }, get reservations() { return reservations; }, get extractionCalls() { return extractionCalls; } };
}

test("synthetic text ingestion resumes in <=3-chunk batches and publishes only after exact vector count", async (t) => {
  const fixture = fakeIngestionFetch();
  t.mock.method(globalThis, "fetch", fixture.fetch);
  const start = fixture.events.length;
  const first = await processIngestionMessage(configured, { job_id: jobId, workspace_id: workspace, document_id: documentId, version_id: versionId, lifecycle_epoch: 1, batch_offset: 0 });
  const firstSubrequests = fixture.events.length - start;
  assert.equal(first.completed, false);
  assert.equal(first.next_batch_offset, 3);
  assert.ok(firstSubrequests < 50, `first Worker invocation used ${firstSubrequests} subrequests`);
  assert.equal(fixture.staged.size, 3);
  assert.equal(configured.INGESTION_QUEUE.sent.length, 1);

  const nextMessage = configured.INGESTION_QUEUE.sent.shift();
  fixture.failNextStage();
  const failureStart = fixture.events.length;
  await assert.rejects(processIngestionMessage(configured, nextMessage), error => error.retryable === true && error.code === "SYNTHETIC_TRANSIENT");
  const failedBatchSubrequests = fixture.events.length - failureStart;
  assert.ok(failedBatchSubrequests < 50, `failed batch Worker invocation used ${failedBatchSubrequests} subrequests`);
  const pointIdsBeforeRetry = [...fixture.points.keys()].sort();
  assert.equal(fixture.points.size, 4, "the transient batch indexed one point before its database stage failed");
  assert.equal(fixture.staged.size, 3, "the failed staging transaction must not expose a partial fourth chunk");

  fixture.job.available_at = new Date(Date.now() - 1000).toISOString();
  const retryStart = fixture.events.length;
  const second = await processIngestionMessage(configured, nextMessage);
  const retrySubrequests = fixture.events.length - retryStart;
  assert.deepEqual(second, { completed: true, total_chunks: 4 });
  assert.ok(retrySubrequests < 50, `retried batch Worker invocation used ${retrySubrequests} subrequests`);
  assert.equal(fixture.staged.size, 4);
  assert.equal(fixture.points.size, 4, "stable point IDs prevent duplicate vectors across a retried batch");
  assert.deepEqual([...fixture.points.keys()].sort(), pointIdsBeforeRetry);
  assert.equal(fixture.job.status, "completed");
  assert.equal(fixture.version.publication_state, "ready");
  assert.equal(fixture.extraction.size, 0, "terminal publication removes temporary extracted text");
  assert.equal(fixture.events.filter((event) => event.path.includes("/storage/v1/object/")).length, 1, "retry reuses staged extraction instead of rereading the source");
  assert.ok(fixture.reservations >= 18, "each Gemini/Qdrant index, cleanup, retry, and final verification must pass quota admission");
  assert.equal(fixture.events.filter((event) => event.host === "generativelanguage.googleapis.com").length, 5);
});

test("synthetic near-capacity text document completes over bounded queued batches", async (t) => {
  const source = "Reviewed policy evidence. ".repeat(20_000);
  const expectedChunks = chunkText(source).length;
  assert.ok(expectedChunks > 380 && expectedChunks <= 400, `fixture has ${expectedChunks} chunks`);
  const fixture = fakeIngestionFetch(source);
  t.mock.method(globalThis, "fetch", fixture.fetch);

  let message = { job_id: jobId, workspace_id: workspace, document_id: documentId, version_id: versionId, lifecycle_epoch: 1, batch_offset: 0 };
  let batches = 0;
  let maxSubrequests = 0;
  while (true) {
    const start = fixture.events.length;
    const result = await processIngestionMessage(configured, message);
    const subrequests = fixture.events.length - start;
    maxSubrequests = Math.max(maxSubrequests, subrequests);
    assert.ok(subrequests < 50, `batch ${batches} used ${subrequests} subrequests`);
    batches += 1;
    if (result.completed) {
      assert.equal(result.total_chunks, expectedChunks);
      break;
    }
    assert.equal(result.next_batch_offset, Math.min(batches * 3, expectedChunks));
    message = configured.INGESTION_QUEUE.sent.shift();
    assert.ok(message, `durable queue continuation missing after batch ${batches}`);
  }

  assert.equal(batches, Math.ceil(expectedChunks / 3));
  assert.equal(fixture.staged.size, expectedChunks);
  assert.equal(fixture.points.size, expectedChunks);
  assert.equal(fixture.job.status, "completed");
  assert.equal(fixture.version.publication_state, "ready");
  assert.equal(fixture.events.filter((event) => event.host === "generativelanguage.googleapis.com").length, expectedChunks);
  assert.equal(fixture.events.filter((event) => event.path.includes("/storage/v1/object/")).length, 1, "large text source is fetched once for all queued batches");
  assert.equal(fixture.extraction.size, 0, "temporary extraction rows are removed after publication");
  assert.ok(maxSubrequests < 50);
});

test("binary OCR extraction is durably cached and charged once across queued batches", async (t) => {
  const extractedText = "Scanned agreement clause with an auditable retention term. ".repeat(240);
  const expectedChunks = chunkText(extractedText).length;
  assert.ok(expectedChunks > 3 && expectedChunks <= 400);
  const fixture = fakeIngestionFetch({ source: "%PDF-1.7 synthetic bytes", contentType: "application/pdf", extractedText });
  t.mock.method(globalThis, "fetch", fixture.fetch);

  let message = { job_id: jobId, workspace_id: workspace, document_id: documentId, version_id: versionId, lifecycle_epoch: 1, batch_offset: 0 };
  let maxSubrequests = 0;
  let batches = 0;
  while (true) {
    const start = fixture.events.length;
    const result = await processIngestionMessage(configured, message);
    maxSubrequests = Math.max(maxSubrequests, fixture.events.length - start);
    batches += 1;
    if (result.completed) {
      assert.equal(result.total_chunks, expectedChunks);
      break;
    }
    message = configured.INGESTION_QUEUE.sent.shift();
    assert.ok(message);
  }
  assert.equal(batches, Math.ceil(expectedChunks / 3));
  assert.equal(fixture.extractionCalls, 1, "OCR is not repeated on later queue batches");
  assert.equal(fixture.events.filter((event) => event.path.includes("/storage/v1/object/")).length, 1, "binary source is read only once");
  assert.equal(fixture.points.size, expectedChunks);
  assert.equal(fixture.extraction.size, 0, "OCR text is purged after terminal publication");
  assert.ok(maxSubrequests < 50);
});

test("synthetic cross-workspace upload is denied before storage, queue, or providers", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const parsed = new URL(String(url));
    calls.push({ host: parsed.hostname, path: parsed.pathname });
    if (parsed.pathname === "/auth/v1/user") return json({ id: "77777777-7777-4777-8777-777777777777" });
    if (parsed.pathname === "/rest/v1/workspace_members") return json([]);
    throw new Error(`Unexpected request after authorization denial: ${parsed.href}`);
  });
  const form = new FormData();
  form.set("file", new File(["private synthetic content"], "private.txt", { type: "text/plain" }));
  const response = await handle(new Request("https://gateway.invalid/api/v1/documents/upload", {
    method: "POST", headers: { authorization: "Bearer synthetic-user-token", "x-nexus-workspace-id": workspace }, body: form,
  }), configured);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "FORBIDDEN");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.host === "supabase.invalid"));
  assert.equal(configured.INGESTION_QUEUE.sent.length, 0);
});
