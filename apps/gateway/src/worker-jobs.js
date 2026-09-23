import { chunkText, indexChunks, MAX_DOCUMENT_CHUNKS, MAX_INDEX_BATCH_CHUNKS, sha256 } from "./worker-pipeline.js";
import { deleteQdrantGeneration, extractFileText, verifyQdrantGeneration } from "./worker-lifecycle.js";

const iso = () => new Date().toISOString();
const err = (code, message, retryable = false) => Object.assign(new Error(message), { code, status: 503, retryable });
async function db(env, path, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw err("PERSISTENCE_UNAVAILABLE", "Authoritative storage rejected the background job.", true);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const rpc = (env, name, body) => db(env, `rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
function queueMessage(job, batchOffset = 0) {
  return {
    job_id: job.id,
    workspace_id: job.workspace_id,
    document_id: job.document_id,
    version_id: job.version_id,
    lifecycle_epoch: Number(job.lifecycle_epoch || 1),
    batch_offset: batchOffset,
  };
}

async function claim(env, message) {
  const rows = await db(env, `ingestion_jobs?id=eq.${message.job_id}&workspace_id=eq.${message.workspace_id}&select=*&limit=1`);
  const job = rows?.[0];
  if (!job || ["completed", "cancelled", "failed"].includes(job.status)) return null;
  if (job.document_id !== message.document_id || job.version_id !== message.version_id || Number(job.lifecycle_epoch) !== Number(message.lifecycle_epoch)) {
    throw err("STALE_MESSAGE", "Queue authority mismatch.");
  }
  const offset = Number(job.payload?.batch_offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || (message.batch_offset != null && Number(message.batch_offset) !== offset)) return null;
  if (job.cancellation_requested_at || (job.available_at && Date.parse(job.available_at) > Date.now())) return null;
  if (Number(job.attempts || 0) >= Number(job.max_attempts || 3)) {
    await db(env, `ingestion_jobs?id=eq.${job.id}&status=in.(queued,retry_wait,processing)`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", stage: "failed", error_code: "LEASE_EXHAUSTED", error_message: "Maximum batch attempts exhausted.", completed_at: iso(), lease_owner: null, lease_expires_at: null }),
    });
    await db(env, `document_versions?id=eq.${job.version_id}&publication_state=neq.ready`, {
      method: "PATCH", body: JSON.stringify({ publication_state: "failed", failure_code: "LEASE_EXHAUSTED" }),
    }).catch(() => null);
    return null;
  }
  if (job.status === "processing" && Date.parse(job.lease_expires_at) > Date.now()) return null;
  const owner = `cfq:${crypto.randomUUID()}`;
  const generation = Number(job.lease_generation || 0) + 1;
  const out = await db(env, `ingestion_jobs?id=eq.${job.id}&lease_generation=eq.${job.lease_generation || 0}&status=in.(queued,retry_wait,processing)&cancellation_requested_at=is.null`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "processing", stage: "extracting", progress: Math.max(1, Number(job.progress || 0)),
      attempts: Number(job.attempts || 0) + 1, lease_owner: owner, lease_generation: generation,
      lease_expires_at: new Date(Date.now() + 300000).toISOString(), heartbeat_at: iso(), started_at: job.started_at || iso(),
    }),
  });
  return out?.[0] ? { job: out[0], owner, generation, batchOffset: offset } : null;
}

async function beat(env, claimResult, patch) {
  const { job, owner, generation } = claimResult;
  const out = await db(env, `ingestion_jobs?id=eq.${job.id}&status=eq.processing&lease_owner=eq.${encodeURIComponent(owner)}&lease_generation=eq.${generation}&lifecycle_epoch=eq.${job.lifecycle_epoch}&cancellation_requested_at=is.null`, {
    method: "PATCH",
    body: JSON.stringify({ heartbeat_at: iso(), lease_expires_at: new Date(Date.now() + 300000).toISOString(), ...patch }),
  });
  if (!out?.[0]) throw err("STALE_WORKER", "Lease or lifecycle changed.");
}

async function checkpointBatch(env, claimResult, payload) {
  const { job, owner, generation } = claimResult;
  const out = await db(env, `ingestion_jobs?id=eq.${job.id}&status=eq.processing&lease_owner=eq.${encodeURIComponent(owner)}&lease_generation=eq.${generation}&lifecycle_epoch=eq.${job.lifecycle_epoch}&cancellation_requested_at=is.null`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "queued", stage: "batch_ready", progress: payload.progress, attempts: 0,
      payload: payload.nextPayload, available_at: iso(), lease_owner: null, lease_expires_at: null,
    }),
  });
  if (!out?.[0]) throw err("STALE_WORKER", "Batch checkpoint lost its lease.");
  try {
    await env.INGESTION_QUEUE.send(queueMessage(job, payload.nextOffset));
  } catch {
    // The scheduled outbox-like sweeper will republish the durable cursor.
    throw err("QUEUE_UNAVAILABLE", "Next ingestion batch could not be enqueued.", true);
  }
}

async function cleanupStagedGeneration(env, job, generation) {
  await deleteQdrantGeneration(env, job.workspace_id, job.document_id, job.version_id, generation).catch(() => null);
  await db(env, `document_chunks?workspace_id=eq.${job.workspace_id}&version_id=eq.${job.version_id}`, { method: "DELETE" }).catch(() => null);
}

async function processIngestionMessage(env, message) {
  const claimResult = await claim(env, message);
  if (!claimResult) return { skipped: true };
  const job = claimResult.job;
  const offset = claimResult.batchOffset;
  let version;
  let generation;
  try {
    const [documents, versions] = await Promise.all([
      db(env, `documents?id=eq.${job.document_id}&workspace_id=eq.${job.workspace_id}&lifecycle_state=eq.active&lifecycle_epoch=eq.${job.lifecycle_epoch}&select=*&limit=1`),
      db(env, `document_versions?id=eq.${job.version_id}&workspace_id=eq.${job.workspace_id}&select=*&limit=1`),
    ]);
    const document = documents?.[0];
    version = versions?.[0];
    if (!document || !version) throw err("STALE_WORKER", "Document authority changed.");
    if (offset === 0 && document.active_version_id && document.active_version_id !== job.version_id) {
      const old = await db(env, `document_versions?id=eq.${document.active_version_id}&workspace_id=eq.${job.workspace_id}&select=index_generation&limit=1`);
      version.supersedes_index_generation = old?.[0]?.index_generation || null;
    }
    generation = version.index_generation || crypto.randomUUID();
    if (offset === 0) await cleanupStagedGeneration(env, job, generation);

    const key = version.original_key.split("/").map(encodeURIComponent).join("/");
    const original = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${encodeURIComponent(version.original_bucket)}/${key}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!original.ok) throw err("PERSISTENCE_UNAVAILABLE", "Original unavailable.", true);
    const file = new File([await original.arrayBuffer()], document.filename, { type: document.content_type });
    const extracted = await extractFileText(env, file, { workspaceId: job.workspace_id, priority: "background" });
    const chunks = chunkText(extracted.text);
    if (!chunks.length) throw err("EMPTY_DOCUMENT", "The document contains no indexable text.");
    if (chunks.length > MAX_DOCUMENT_CHUNKS) throw err("CAPACITY_REACHED", "Document exceeds the 400-chunk bounded ingestion limit.");
    const repeatSafeTextTypes = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
    if (chunks.length > MAX_INDEX_BATCH_CHUNKS && !repeatSafeTextTypes.has(file.type)) {
      throw err("CAPACITY_REACHED", "Only directly decoded UTF-8 text formats can span Worker batches. Export larger binary or archive documents to text to avoid repeated extraction and expansion.");
    }
    if (offset >= chunks.length || offset % MAX_INDEX_BATCH_CHUNKS !== 0) throw err("STALE_MESSAGE", "Ingestion cursor is outside the source manifest.");
    if (offset > 0 && Number(job.payload?.batch_total) !== chunks.length) throw err("VERSION_CONFLICT", "Re-extracted content no longer matches the durable batch manifest.");
    const manifestBefore = job.payload?.extraction_manifest;
    if (offset > 0 && manifestBefore && JSON.stringify(manifestBefore) !== JSON.stringify(extracted.manifest || {})) {
      throw err("VERSION_CONFLICT", "Extraction manifest changed between batches.");
    }

    const batch = chunks.slice(offset, offset + MAX_INDEX_BATCH_CHUNKS);
    const points = await indexChunks(env, {
      workspaceId: job.workspace_id, documentId: job.document_id, versionId: job.version_id,
      generation, filename: document.filename, chunks: batch, initializeIndex: offset === 0,
    });
    const stagedChunks = await Promise.all(points.map(async (point, index) => {
      const chunk = batch[index];
      return {
        chunk_id: point.id, workspace_id: job.workspace_id, document_id: job.document_id,
        version_id: job.version_id, ordinal: chunk.chunk_index, original_text: chunk.content,
        original_content_hash: await sha256(chunk.content), retrieval_text: chunk.content,
        location: point.payload.location, extraction: { method: extracted.method, filename: document.filename },
      };
    }));
    const staged = await rpc(env, "workbench_stage_chunk_batch", {
      p_job: job.id, p_workspace: job.workspace_id, p_owner: claimResult.owner,
      p_generation: claimResult.generation, p_version: job.version_id, p_epoch: Number(job.lifecycle_epoch),
      p_space: env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001", p_index: generation,
      p_manifest: extracted.manifest || {}, p_total_chunks: chunks.length, p_offset: offset, p_chunks: stagedChunks,
    });
    if (Number(staged?.count) < offset + batch.length) throw err("INGESTION_FAILED", "Staged batch was not durably recorded.", true);

    const nextOffset = offset + batch.length;
    if (nextOffset < chunks.length) {
      const progress = Math.min(89, 10 + Math.floor(75 * nextOffset / chunks.length));
      const nextPayload = {
        ...job.payload,
        batch_offset: nextOffset,
        batch_total: chunks.length,
        extraction_manifest: extracted.manifest || {},
      };
      await checkpointBatch(env, claimResult, { nextOffset, nextPayload, progress });
      return { completed: false, next_batch_offset: nextOffset, total_chunks: chunks.length };
    }

    const vectorReceipt = await verifyQdrantGeneration(env, job.workspace_id, job.document_id, job.version_id, generation, chunks.length);
    if (!vectorReceipt.verified || vectorReceipt.count !== chunks.length) throw err("QDRANT_INDEX_UNVERIFIED", "Final vector count could not be verified.", true);
    const finalized = await rpc(env, "workbench_finalize_chunk_stage", {
      p_job: job.id, p_workspace: job.workspace_id, p_owner: claimResult.owner,
      p_generation: claimResult.generation, p_version: job.version_id, p_epoch: Number(job.lifecycle_epoch),
      p_total_chunks: chunks.length, p_index: generation,
    });
    await beat(env, claimResult, { stage: "activating", progress: 95 });
    await rpc(env, "workbench_publish_version", {
      p_job: job.id, p_workspace: job.workspace_id, p_owner: claimResult.owner,
      p_generation: claimResult.generation, p_version: job.version_id, p_epoch: Number(job.lifecycle_epoch),
      p_receipt: { manifest_hash: finalized.manifest_hash, verified_vectors: vectorReceipt.count, index_generation: generation, hashes_valid: true },
    });
    if (document.active_version_id && document.active_version_id !== job.version_id) {
      await db(env, `document_chunks?workspace_id=eq.${job.workspace_id}&version_id=eq.${document.active_version_id}`, { method: "DELETE" }).catch(() => null);
      if (version.supersedes_index_generation) {
        await deleteQdrantGeneration(env, job.workspace_id, job.document_id, document.active_version_id, version.supersedes_index_generation).catch(() => null);
      }
    }
    return { completed: true, total_chunks: chunks.length };
  } catch (error) {
    const maxAttempts = Number(job.max_attempts || 3);
    const retry = Boolean(error.retryable) && Number(job.attempts || 0) < maxAttempts;
    if (!retry && generation) await cleanupStagedGeneration(env, job, generation);
    await db(env, `ingestion_jobs?id=eq.${job.id}&status=eq.processing&lease_owner=eq.${encodeURIComponent(claimResult.owner)}&lease_generation=eq.${claimResult.generation}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: retry ? "retry_wait" : "failed", stage: retry ? "retry_wait" : "failed",
        error_code: error.code || "INGESTION_FAILED", error_message: String(error.message).slice(0, 1000),
        available_at: new Date(Number.isFinite(error.retryAt) && error.retryAt > Date.now() ? error.retryAt : Date.now() + 15000).toISOString(), completed_at: retry ? null : iso(),
        lease_owner: null, lease_expires_at: null,
      }),
    }).catch(() => null);
    if (!retry) await db(env, `document_versions?id=eq.${job.version_id}&publication_state=neq.ready`, {
      method: "PATCH", body: JSON.stringify({ publication_state: "failed", failure_code: error.code || "INGESTION_FAILED" }),
    }).catch(() => null);
    error.retryable = retry;
    throw error;
  }
}

async function handleQueue(batch, env) {
  for (const message of batch.messages) {
    try {
      await processIngestionMessage(env, message.body);
      message.ack();
    } catch (error) {
      if (error.retryable) message.retry({ delaySeconds: 15 });
      else message.ack();
    }
  }
}

async function sweepJobs(env) {
  const due = encodeURIComponent(iso());
  const [queued, expired] = await Promise.all([
    db(env, `ingestion_jobs?kind=eq.ingestion&status=in.(queued,retry_wait)&available_at=lte.${due}&cancellation_requested_at=is.null&select=id,workspace_id,document_id,version_id,lifecycle_epoch,attempts,max_attempts,payload&order=available_at.asc&limit=25`),
    db(env, `ingestion_jobs?kind=eq.ingestion&status=eq.processing&lease_expires_at=lte.${due}&cancellation_requested_at=is.null&select=id,workspace_id,document_id,version_id,lifecycle_epoch,attempts,max_attempts,payload&order=lease_expires_at.asc&limit=25`),
  ]);
  const unique = new Map([...(queued || []), ...(expired || [])].map((job) => [job.id, job]));
  let enqueued = 0;
  for (const job of unique.values()) {
    if (Number(job.attempts || 0) >= Number(job.max_attempts || 3)) {
      await db(env, `ingestion_jobs?id=eq.${job.id}&status=in.(queued,retry_wait,processing)`, {
        method: "PATCH", body: JSON.stringify({ status: "failed", stage: "failed", error_code: "LEASE_EXHAUSTED", error_message: "Maximum batch attempts exhausted.", completed_at: iso(), lease_owner: null, lease_expires_at: null }),
      });
      await db(env, `document_versions?id=eq.${job.version_id}&publication_state=neq.ready`, {
        method: "PATCH", body: JSON.stringify({ publication_state: "failed", failure_code: "LEASE_EXHAUSTED" }),
      }).catch(() => null);
      continue;
    }
    const offset = Number(job.payload?.batch_offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) continue;
    await env.INGESTION_QUEUE.send(queueMessage(job, offset));
    enqueued += 1;
  }
  return { enqueued };
}
export { handleQueue, processIngestionMessage, sweepJobs };
