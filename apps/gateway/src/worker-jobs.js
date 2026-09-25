import { chunkText, indexChunks, sha256 } from "./worker-pipeline.js";
import { deleteQdrantGeneration, extractFileText } from "./worker-lifecycle.js";

const iso = () => new Date().toISOString();
const err = (code, message, retryable = false) => Object.assign(new Error(message), { code, status: 503, retryable });
async function db(env, path, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) } });
  if (!response.ok) throw err("PERSISTENCE_UNAVAILABLE", "Authoritative storage rejected the background job.", true);
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
const rpc = (env, name, body) => db(env, `rpc/${name}`, { method: "POST", body: JSON.stringify(body) });

async function claim(env, message) {
  const rows = await db(env, `ingestion_jobs?id=eq.${message.job_id}&workspace_id=eq.${message.workspace_id}&select=*&limit=1`), job = rows?.[0];
  if (!job || ["completed", "cancelled", "failed"].includes(job.status)) return null;
  if (job.document_id !== message.document_id || job.version_id !== message.version_id || Number(job.lifecycle_epoch) !== Number(message.lifecycle_epoch)) throw err("STALE_MESSAGE", "Queue authority mismatch.");
  if (job.cancellation_requested_at || (job.available_at && Date.parse(job.available_at) > Date.now())) return null;
  if (Number(job.attempts || 0) >= Number(job.max_attempts || 3)) {
    await db(env, `ingestion_jobs?id=eq.${job.id}&status=in.(queued,retry_wait,processing)`, { method: "PATCH", body: JSON.stringify({ status: "failed", stage: "failed", error_code: "LEASE_EXHAUSTED", error_message: "Maximum ingestion attempts exhausted.", completed_at: iso(), lease_owner: null, lease_expires_at: null }) }); return null;
  }
  if (job.status === "processing" && Date.parse(job.lease_expires_at) > Date.now()) return null;
  const owner = `cfq:${crypto.randomUUID()}`, generation = Number(job.lease_generation || 0) + 1;
  const out = await db(env, `ingestion_jobs?id=eq.${job.id}&lease_generation=eq.${job.lease_generation || 0}&status=in.(queued,retry_wait,processing)&cancellation_requested_at=is.null`, { method: "PATCH", body: JSON.stringify({ status: "processing", stage: "extracting", progress: 10, attempts: Number(job.attempts || 0) + 1, lease_owner: owner, lease_generation: generation, lease_expires_at: new Date(Date.now() + 300000).toISOString(), heartbeat_at: iso(), started_at: job.started_at || iso() }) });
  return out?.[0] ? { job: out[0], owner, generation } : null;
}
async function beat(env, claimResult, patch) {
  const { job, owner, generation } = claimResult;
  const out = await db(env, `ingestion_jobs?id=eq.${job.id}&status=eq.processing&lease_owner=eq.${encodeURIComponent(owner)}&lease_generation=eq.${generation}&lifecycle_epoch=eq.${job.lifecycle_epoch}&cancellation_requested_at=is.null`, { method: "PATCH", body: JSON.stringify({ heartbeat_at: iso(), lease_expires_at: new Date(Date.now() + 300000).toISOString(), ...patch }) });
  if (!out?.[0]) throw err("STALE_WORKER", "Lease or lifecycle changed.");
}
async function cleanupStagedGeneration(env, job, generation) {
  await deleteQdrantGeneration(env, job.workspace_id, job.document_id, job.version_id, generation).catch(() => null);
  await db(env, `document_chunks?workspace_id=eq.${job.workspace_id}&version_id=eq.${job.version_id}`, { method: "DELETE" }).catch(() => null);
}
async function processIngestionMessage(env, message) {
  const claimResult = await claim(env, message); if (!claimResult) return { skipped: true };
  const job = claimResult.job; let version, generation;
  try {
    const [documents, versions] = await Promise.all([db(env, `documents?id=eq.${job.document_id}&workspace_id=eq.${job.workspace_id}&lifecycle_state=eq.active&lifecycle_epoch=eq.${job.lifecycle_epoch}&select=*&limit=1`), db(env, `document_versions?id=eq.${job.version_id}&workspace_id=eq.${job.workspace_id}&select=*&limit=1`)]);
    const document = documents?.[0]; version = versions?.[0]; if (!document || !version) throw err("STALE_WORKER", "Document authority changed.");
    const oldVersionId = document.active_version_id, oldVersions = oldVersionId ? await db(env, `document_versions?id=eq.${oldVersionId}&workspace_id=eq.${job.workspace_id}&select=index_generation&limit=1`) : [];
    generation = version.index_generation || crypto.randomUUID(); await cleanupStagedGeneration(env, job, generation);
    const key = version.original_key.split("/").map(encodeURIComponent).join("/");
    const original = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${encodeURIComponent(version.original_bucket)}/${key}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
    if (!original.ok) throw err("PERSISTENCE_UNAVAILABLE", "Original unavailable.", true);
    const extracted = await extractFileText(env, new File([await original.arrayBuffer()], document.filename, { type: document.content_type })), chunks = chunkText(extracted.text);
    if (!chunks.length) throw err("EMPTY_DOCUMENT", "The document contains no indexable text.");
    await beat(env, claimResult, { stage: "embedding", progress: 30 });
    const points = await indexChunks(env, { workspaceId: job.workspace_id, documentId: job.document_id, versionId: job.version_id, generation, filename: document.filename, chunks });
    await beat(env, claimResult, { stage: "persisting", progress: 70 });
    const stagedChunks = await Promise.all(points.map(async (point, index) => ({ chunk_id: point.id, workspace_id: job.workspace_id, document_id: job.document_id, version_id: job.version_id, ordinal: index, original_text: chunks[index].content, original_content_hash: await sha256(chunks[index].content), retrieval_text: chunks[index].content, location: point.payload.location, extraction: { method: extracted.method, filename: document.filename } })));
    const staged = await rpc(env, "workbench_stage_chunks", { p_job: job.id, p_workspace: job.workspace_id, p_owner: claimResult.owner, p_generation: claimResult.generation, p_version: job.version_id, p_epoch: Number(job.lifecycle_epoch), p_space: env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001", p_index: generation, p_manifest: extracted.manifest || {}, p_chunks: stagedChunks });
    await beat(env, claimResult, { stage: "activating", progress: 90 });
    await rpc(env, "workbench_publish_version", { p_job: job.id, p_workspace: job.workspace_id, p_owner: claimResult.owner, p_generation: claimResult.generation, p_version: job.version_id, p_epoch: Number(job.lifecycle_epoch), p_receipt: { manifest_hash: staged.manifest_hash, verified_vectors: points.length, index_generation: generation, hashes_valid: true } });
    if (oldVersionId && oldVersionId !== job.version_id) {
      await db(env, `document_chunks?workspace_id=eq.${job.workspace_id}&version_id=eq.${oldVersionId}`, { method: "DELETE" }).catch(() => null);
      if (oldVersions?.[0]?.index_generation) await deleteQdrantGeneration(env, job.workspace_id, job.document_id, oldVersionId, oldVersions[0].index_generation).catch(() => null);
    }
    return { completed: true };
  } catch (error) {
    if (generation) await cleanupStagedGeneration(env, job, generation);
    const retry = Boolean(error.retryable) && Number(job.attempts || 0) < Number(job.max_attempts || 3);
    await db(env, `ingestion_jobs?id=eq.${job.id}&status=eq.processing&lease_owner=eq.${encodeURIComponent(claimResult.owner)}&lease_generation=eq.${claimResult.generation}`, { method: "PATCH", body: JSON.stringify({ status: retry ? "retry_wait" : "failed", stage: "failed", error_code: error.code || "INGESTION_FAILED", error_message: String(error.message).slice(0, 1000), available_at: new Date(Date.now() + 15000).toISOString(), completed_at: retry ? null : iso(), lease_owner: null, lease_expires_at: null }) }).catch(() => null);
    if (!retry) await db(env, `document_versions?id=eq.${job.version_id}&publication_state=neq.ready`, { method: "PATCH", body: JSON.stringify({ publication_state: "failed", failure_code: error.code || "INGESTION_FAILED" }) }).catch(() => null);
    error.retryable = retry; throw error;
  }
}
async function handleQueue(batch, env) { for (const message of batch.messages) try { await processIngestionMessage(env, message.body); message.ack(); } catch (error) { error.retryable ? message.retry({ delaySeconds: 15 }) : message.ack(); } }
async function sweepJobs(env) {
  const due = encodeURIComponent(iso()), jobs = await db(env, `ingestion_jobs?kind=eq.ingestion&status=in.(queued,retry_wait)&available_at=lte.${due}&cancellation_requested_at=is.null&select=id,workspace_id,document_id,version_id,lifecycle_epoch,attempts,max_attempts&order=available_at.asc&limit=25`); let enqueued = 0;
  for (const job of jobs || []) { if (Number(job.attempts || 0) >= Number(job.max_attempts || 3)) continue; await env.INGESTION_QUEUE.send({ job_id: job.id, workspace_id: job.workspace_id, document_id: job.document_id, version_id: job.version_id, lifecycle_epoch: Number(job.lifecycle_epoch || 1) }); enqueued += 1; }
  return { enqueued };
}
export { handleQueue, processIngestionMessage, sweepJobs };
