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

    const extractionIdentity = {
      p_job: job.id, p_workspace: job.workspace_id, p_owner: claimResult.owner,
      p_generation: claimResult.generation, p_version: job.version_id, p_epoch: Number(job.lifecycle_epoch),
    };
    const savedBatch = await rpc(env, "workbench_read_extracted_batch", {
      ...extractionIdentity, p_offset: offset, p_limit: MAX_INDEX_BATCH_CHUNKS,
    });
    let extractionManifest;
    let totalChunks;
    let batch;
    if (savedBatch?.found) {
      extractionManifest = savedBatch.manifest || {};
      totalChunks = Number(savedBatch.total_chunks);
      batch = (savedBatch.chunks || []).map((chunk) => ({
        chunk_index: Number(chunk.ordinal),
        content: chunk.original_text,
        start: Number(chunk.location?.char_start),
        end: Number(chunk.location?.char_end),
      }));
    } else {
      if (offset !== 0) throw err("VERSION_CONFLICT", "Durable extraction staging is missing for a resumed batch.");
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
      extractionManifest = { ...(extracted.manifest || {}), method: extracted.method };
      totalChunks = chunks.length;
      const extractionRows = await Promise.all(chunks.map(async (chunk) => ({
        ordinal: chunk.chunk_index,
        original_text: chunk.content,
        original_content_hash: await sha256(chunk.content),
        location: { char_start: chunk.start, char_end: chunk.end },
      })));
      const stored = await rpc(env, "workbench_store_extracted_chunks", {
        ...extractionIdentity,
        p_space: env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
        p_index: generation,
        p_manifest: extractionManifest,
        p_total_chunks: totalChunks,
        p_chunks: extractionRows,
      });
      if (!stored?.found || Number(stored.count) !== totalChunks) throw err("INGESTION_FAILED", "Extracted content was not durably staged.", true);
      version.index_generation = generation;
      batch = chunks.slice(0, MAX_INDEX_BATCH_CHUNKS);
    }
    if (!Number.isSafeInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_DOCUMENT_CHUNKS
        || offset >= totalChunks || offset % MAX_INDEX_BATCH_CHUNKS !== 0
        || batch.length !== Math.min(MAX_INDEX_BATCH_CHUNKS, totalChunks - offset)) {
      throw err("STALE_MESSAGE", "Ingestion cursor or durable extraction manifest is invalid.");
    }
    if (Number(job.payload?.batch_total || totalChunks) !== totalChunks) {
      throw err("VERSION_CONFLICT", "Durable extraction chunk count differs from the job cursor.");
    }
    const manifestBefore = job.payload?.extraction_manifest;
    if (manifestBefore && JSON.stringify(manifestBefore) !== JSON.stringify(extractionManifest)) {
      throw err("VERSION_CONFLICT", "Durable extraction manifest differs from the job cursor.");
    }

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
        location: point.payload.location, extraction: { method: extractionManifest.method || "worker-extracted", filename: document.filename },
      };
    }));
    const staged = await rpc(env, "workbench_stage_chunk_batch", {
      p_job: job.id, p_workspace: job.workspace_id, p_owner: claimResult.owner,
      p_generation: claimResult.generation, p_version: job.version_id, p_epoch: Number(job.lifecycle_epoch),
      p_space: env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001", p_index: generation,
      p_manifest: extractionManifest, p_total_chunks: totalChunks, p_offset: offset, p_chunks: stagedChunks,
    });
    if (Number(staged?.count) < offset + batch.length) throw err("INGESTION_FAILED", "Staged batch was not durably recorded.", true);

    const nextOffset = offset + batch.length;
    if (nextOffset < totalChunks) {
      const progress = Math.min(89, 10 + Math.floor(75 * nextOffset / totalChunks));
      const nextPayload = {
        ...job.payload,
        batch_offset: nextOffset,
        batch_total: totalChunks,
        extraction_manifest: extractionManifest,
      };
      await checkpointBatch(env, claimResult, { nextOffset, nextPayload, progress });
      return { completed: false, next_batch_offset: nextOffset, total_chunks: totalChunks };
    }

    const vectorReceipt = await verifyQdrantGeneration(env, job.workspace_id, job.document_id, job.version_id, generation, totalChunks);
    if (!vectorReceipt.verified || vectorReceipt.count !== totalChunks) throw err("QDRANT_INDEX_UNVERIFIED", "Final vector count could not be verified.", true);
    const finalized = await rpc(env, "workbench_finalize_chunk_stage", {
      p_job: job.id, p_workspace: job.workspace_id, p_owner: claimResult.owner,
      p_generation: claimResult.generation, p_version: job.version_id, p_epoch: Number(job.lifecycle_epoch),
      p_total_chunks: totalChunks, p_index: generation,
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
    return { completed: true, total_chunks: totalChunks };
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
  await rpc(env, "workbench_cleanup_expired_extractions", { p_limit: 100 });
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
