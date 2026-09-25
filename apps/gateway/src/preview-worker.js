import {
  chunkText,
  generateAnswer,
  groundedPrompt,
  indexChunks,
  safeFilename,
  searchChunks,
  sha256,
  validateWorkerFile,
} from "./worker-pipeline.js";
import { deleteQdrantDocument, hybridFuse } from "./worker-lifecycle.js";
import { handleQueue, sweepJobs } from "./worker-jobs.js";

// Supabase service-role access is kept in a Cloudflare secret binding; OAuth and MCP gates are exact-head validated.
const BASE_HEADERS = Object.freeze({
  "cache-control": "private, no-store, max-age=0",
  "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "content-type": "application/json; charset=utf-8",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

const READ_ROUTES = Object.freeze({
  "/api/v2/evidence/search": { table: "evidence_items", capability: "evidence:read" },
  "/api/v2/claims": { table: "findings", capability: "finding:read" },
  "/api/v2/citations": { table: "evidence_items", capability: "evidence:read" },
  "/api/v2/entities": { table: "graph_entities", capability: "counterparty:read" },
  "/api/v2/relationships": { table: "graph_relationships", capability: "counterparty:read" },
  "/api/v2/obligations": { table: "findings", capability: "obligation:read" },
  "/api/v2/procurement": { table: "findings", capability: "procurement:read" },
  "/api/v2/passports": { table: "evidence_exports", capability: "passport:read" },
  "/api/v2/findings": { table: "findings", capability: "finding:read" },
  "/api/v2/monitors": { table: "monitors", capability: "monitor:read" },
});

const MCP_OPERATIONS = Object.freeze({
  evidence_search: READ_ROUTES["/api/v2/evidence/search"],
  claim_retrieval: READ_ROUTES["/api/v2/claims"],
  citation_retrieval: READ_ROUTES["/api/v2/citations"],
  entity_lookup: READ_ROUTES["/api/v2/entities"],
  relationship_lookup: READ_ROUTES["/api/v2/relationships"],
  obligation_lookup: READ_ROUTES["/api/v2/obligations"],
  procurement_lookup: READ_ROUTES["/api/v2/procurement"],
  passport_retrieval: READ_ROUTES["/api/v2/passports"],
  finding_retrieval: READ_ROUTES["/api/v2/findings"],
  monitor_status: READ_ROUTES["/api/v2/monitors"],
});

const ROLE_CAPABILITIES = Object.freeze({
  viewer: ["evidence:read", "finding:read", "monitor:read", "obligation:read", "procurement:read", "counterparty:read", "passport:read"],
  editor: ["evidence:read", "research:run", "finding:read", "finding:write", "monitor:read", "monitor:write", "obligation:read", "procurement:read", "counterparty:read", "passport:read", "passport:write", "export:create"],
  admin: ["evidence:read", "research:run", "finding:read", "finding:write", "monitor:read", "monitor:write", "obligation:read", "obligation:review", "procurement:read", "counterparty:read", "passport:read", "passport:write", "export:create", "admin:usage"],
  owner: ["evidence:read", "research:run", "finding:read", "finding:write", "monitor:read", "monitor:write", "obligation:read", "obligation:review", "procurement:read", "counterparty:read", "passport:read", "passport:write", "export:create", "admin:usage"],
});

const buckets = new Map();
function allowRequest(key, now = Date.now()) {
  const windowStart = now - 60_000;
  const recent = (buckets.get(key) || []).filter((value) => value >= windowStart);
  if (recent.length >= 60) return false;
  recent.push(now); buckets.set(key, recent); return true;
}

function headers(request, env) {
  const output = new Headers(BASE_HEADERS);
  output.set("x-request-id", request.headers.get("cf-ray") || crypto.randomUUID());
  const origin = request.headers.get("origin");
  if (origin && origin === env.FRONTEND_ORIGIN) {
    output.set("access-control-allow-origin", origin);
    output.set("access-control-allow-credentials", "true");
    output.set("vary", "Origin");
  }
  return output;
}
function json(request, env, body, status = 200, extra = {}) {
  const output = headers(request, env);
  for (const [key, value] of Object.entries(extra)) output.set(key, value);
  return new Response(request.method === "HEAD" || status === 204 ? null : JSON.stringify(body), { status, headers: output });
}
function fail(request, env, code, message, status, retryable = false) {
  return json(request, env, { error: { code, message, retryable, request_id: headers(request, env).get("x-request-id") } }, status);
}
function configured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_SERVICE_ROLE_KEY);
}
async function apiFetch(url, init = {}, timeout = 8_000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
}
async function authenticate(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Authentication is required."), { status: 401, code: "AUTH_REQUIRED" });
  const response = await apiFetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization } });
  if (!response.ok) throw Object.assign(new Error("The access token is invalid or expired."), { status: 401, code: "AUTH_REQUIRED" });
  const user = await response.json();
  if (!user?.id) throw Object.assign(new Error("The authenticated user is unavailable."), { status: 401, code: "AUTH_REQUIRED" });
  return user;
}
async function serviceRequest(env, tablePath, init = {}) {
  const response = await apiFetch(`${env.SUPABASE_URL}/rest/v1/${tablePath}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw Object.assign(new Error("Authoritative storage rejected the request."), { status: 503, code: "PERSISTENCE_UNAVAILABLE", detail });
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function membership(env, userId, workspaceId) {
  const rows = await serviceRequest(env, `workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&select=workspace_id,user_id,role&limit=1`);
  if (!rows?.[0]) throw Object.assign(new Error("The workspace is unavailable to this user."), { status: 403, code: "FORBIDDEN" });
  return rows[0];
}
const SETTINGS_SELECT = "retrieval_top_k,hybrid_search_alpha,llm_temperature,updated_at";
const SETTINGS_DEFAULTS = Object.freeze({
  retrieval_top_k: 10,
  hybrid_search_alpha: 0.6,
  llm_temperature: 0.1,
});
const SETTINGS_PATCH_FIELDS = new Set(Object.keys(SETTINGS_DEFAULTS));
function persistedSetting(row, key, { min, max, integer = false }) {
  const value = row?.[key];
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < min
    || value > max
    || (integer && !Number.isInteger(value))
  ) {
    return SETTINGS_DEFAULTS[key];
  }
  return value;
}
async function readWorkspaceSettings(env, workspaceId) {
  const rows = await serviceRequest(
    env,
    `workspace_settings?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=${SETTINGS_SELECT}&limit=1`,
  );
  const row = rows?.[0] || SETTINGS_DEFAULTS;
  return {
    // These values describe the actual Worker runtime; provider secrets are never returned.
    llm_model_name: env.GEMINI_MODEL || "gemini-2.5-flash",
    llm_temperature: persistedSetting(row, "llm_temperature", { min: 0, max: 1 }),
    retrieval_top_k: persistedSetting(row, "retrieval_top_k", { min: 1, max: 12, integer: true }),
    enable_reranking: false,
    hybrid_search_alpha: persistedSetting(row, "hybrid_search_alpha", { min: 0, max: 1 }),
    // This Worker intentionally sends only the current question, not prior chat history.
    context_window_messages: 1,
    chunk_size: 1600,
    chunk_overlap: 240,
    enable_semantic_chunking: false,
    enable_contextual_enrichment: false,
    embedding_model: env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
    updated_at: row.updated_at || null,
  };
}
function validateSettingsPatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("Settings must be a JSON object."), { status: 400, code: "INVALID_SETTINGS" });
  }
  const entries = Object.entries(body);
  if (!entries.length || entries.some(([key]) => !SETTINGS_PATCH_FIELDS.has(key))) {
    throw Object.assign(new Error("Only temperature, retrieval top K, and hybrid search alpha can be changed on this Worker profile."), { status: 422, code: "UNSUPPORTED_SETTING" });
  }
  const patch = {};
  for (const [key, value] of entries) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw Object.assign(new Error(`Setting ${key} must be a finite number.`), { status: 422, code: "INVALID_SETTINGS" });
    }
    const valid = key === "llm_temperature"
      ? value >= 0 && value <= 1
      : key === "retrieval_top_k"
        ? Number.isInteger(value) && value >= 1 && value <= 12
        : value >= 0 && value <= 1;
    if (!valid) {
      throw Object.assign(new Error(`Setting ${key} is outside the supported zero-cost Worker range.`), { status: 422, code: "INVALID_SETTINGS" });
    }
    patch[key] = value;
  }
  return patch;
}
function workspaceId(request) {
  const value = request.headers.get("x-nexus-workspace-id") || request.headers.get("x-workspace-id") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) throw Object.assign(new Error("A valid workspace binding is required."), { status: 400, code: "WORKSPACE_UNAVAILABLE" });
  return value;
}
async function audit(env, request, userId, workspace, action, resourceType) {
  try {
    await serviceRequest(env, "audit_events", { method: "POST", body: JSON.stringify([{ workspace_id: workspace, user_id: userId, action, resource_type: resourceType, ip_address: request.headers.get("cf-connecting-ip"), user_agent: (request.headers.get("user-agent") || "").slice(0, 300), metadata: { gateway: "cloudflare", profile: "ZERO_COST_LOW_TRAFFIC" } }]) });
  } catch { /* Audit failure never widens access; the read result remains no-store. */ }
}
async function createWorkspace(request, env, user) {
  const key = request.headers.get("idempotency-key");
  if (!key || key.length > 200) throw Object.assign(new Error("Idempotency-Key is required."), { status: 400, code: "INVALID_SCOPE" });
  const body = await request.json();
  const name = String(body?.name || "").trim();
  const slug = String(body?.slug || "").trim().toLowerCase();
  if (name.length < 2 || name.length > 100 || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) throw Object.assign(new Error("Workspace name or slug is invalid."), { status: 422, code: "INVALID_SCOPE" });
  const id = crypto.randomUUID();
  await serviceRequest(env, "workspaces", { method: "POST", body: JSON.stringify([{ id, name, slug, owner_id: user.id, plan: "free" }]) });
  try {
    await serviceRequest(env, "workspace_members", { method: "POST", body: JSON.stringify([{ workspace_id: id, user_id: user.id, role: "owner" }]) });
    await serviceRequest(env, "workspace_settings", { method: "POST", body: JSON.stringify([{ workspace_id: id }]) });
  } catch (error) {
    await serviceRequest(env, `workspaces?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
  await audit(env, request, user.id, id, "workspace.create", "workspace");
  return { id, workspace_id: id, name, slug, role: "owner", plan: "free" };
}

function requireCapability(member, capability) {
  if (!(ROLE_CAPABILITIES[member.role] || []).includes(capability)) {
    throw Object.assign(new Error("The required capability is not granted."), { status: 403, code: "FORBIDDEN" });
  }
}

function storagePath(value) {
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function storageWrite(env, key, file) {
  const response = await apiFetch(`${env.SUPABASE_URL}/storage/v1/object/documents/${storagePath(key)}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": file.type,
      "x-upsert": "false",
    },
    body: file,
  }, 20_000);
  if (!response.ok) throw Object.assign(new Error("Private original storage rejected the upload."), { status: 503, code: "PERSISTENCE_UNAVAILABLE" });
}

async function storageDelete(env, key) {
  const url = `${env.SUPABASE_URL}/storage/v1/object/documents/${storagePath(key)}`;
  const response = await apiFetch(url, { method: "DELETE", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!response.ok && response.status !== 404) throw Object.assign(new Error("Private original deletion failed."), { status: 503, code: "STORAGE_DELETE_FAILED", retryable: true });
  const verification = await apiFetch(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  let missing = verification.status === 404;
  if (!missing && verification.status === 400) {
    const detail = await verification.json().catch(() => ({}));
    missing = detail?.code === "NoSuchKey" || detail?.error === "not_found";
  }
  if (!missing) throw Object.assign(new Error("Private original deletion could not be verified."), { status: 503, code: "STORAGE_DELETE_UNVERIFIED", retryable: true });
}

function documentView(row) {
  return {
    document_id: row.id,
    filename: row.filename,
    file_type: row.content_type || "unknown",
    file_size_bytes: Number(row.file_size_bytes || 0),
    page_count: Number(row.page_count || 0),
    chunk_count: Number(row.chunk_count || 0),
    status: row.status === "queued" ? "pending" : row.status,
    created_at: row.created_at,
    processing_time_seconds: 0,
    extraction_method: "cloudflare-worker-text-v1",
    extra: { version_id: row.active_version_id },
  };
}

function jobView(job, document = null) {
  return { job_id: job.id, document_id: job.document_id, filename: document?.filename || job.payload?.filename || "document", status: job.status === "retry_wait" ? "queued" : job.status, stage: job.stage || job.status, progress: Number(job.progress || 0), message: job.error_message || `Ingestion ${job.status}`, error_message: job.error_message || null, created_at: job.created_at, updated_at: job.updated_at, started_at: job.started_at, completed_at: job.completed_at, document: document ? documentView(document) : null };
}

async function loadBoundDocument(env, workspace, documentId) {
  const rows = await serviceRequest(env, `documents?workspace_id=eq.${workspace}&id=eq.${documentId}&select=*&limit=1`);
  if (!rows?.[0]) throw Object.assign(new Error("Document not found."), { status: 404, code: "DOCUMENT_NOT_FOUND" });
  return rows[0];
}

async function enqueueJob(env,job){if(!env.INGESTION_QUEUE?.send)throw Object.assign(new Error("The durable ingestion queue is unavailable."),{status:503,code:"QUEUE_UNAVAILABLE",retryable:true});await env.INGESTION_QUEUE.send({job_id:job.id,workspace_id:job.workspace_id,document_id:job.document_id,version_id:job.version_id,lifecycle_epoch:Number(job.lifecycle_epoch||1)});}
async function uploadDocument(request,env,user,workspace,member){requireCapability(member,"research:run");const form=await request.formData(),file=form.get("file");validateWorkerFile(file);const filename=safeFilename(file.name),bytes=new Uint8Array(await file.arrayBuffer()),hash=await sha256(bytes);const dup=await serviceRequest(env,`documents?workspace_id=eq.${workspace}&uploaded_by=eq.${user.id}&sha256=eq.${hash}&lifecycle_state=eq.active&select=*&limit=1`);if(dup?.[0])return{success:true,message:`${dup[0].filename} already uploaded`,document:documentView(dup[0]),duplicate:true};const documentId=crypto.randomUUID(),versionId=crypto.randomUUID(),generation=crypto.randomUUID(),jobId=crypto.randomUUID(),key=`${workspace}/${documentId}/${versionId}/${filename}`;await storageWrite(env,key,file);await serviceRequest(env,"documents",{method:"POST",body:JSON.stringify([{id:documentId,workspace_id:workspace,uploaded_by:user.id,filename,original_filename:filename,content_type:file.type,file_size_bytes:bytes.length,storage_bucket:"documents",storage_path:key,sha256:hash,status:"queued"}])});await serviceRequest(env,"document_versions",{method:"POST",body:JSON.stringify([{id:versionId,workspace_id:workspace,document_id:documentId,original_bucket:"documents",original_key:key,original_hash:hash,original_bytes:bytes.length,original_verified_at:new Date().toISOString(),parser_version:"pending",chunker_version:"worker-char-v1",embedding_space_id:env.GEMINI_EMBEDDING_MODEL||"gemini-embedding-001",index_generation:generation,extraction_manifest:{},lifecycle_epoch:1,publication_state:"staged"}])});const jobs=await serviceRequest(env,"ingestion_jobs",{method:"POST",body:JSON.stringify([{id:jobId,workspace_id:workspace,document_id:documentId,version_id:versionId,status:"queued",progress:0,stage:"queued",attempts:0,available_at:new Date().toISOString(),lifecycle_epoch:1,payload:{filename,content_type:file.type,operation:"upload"},kind:"ingestion"}])});await enqueueJob(env,jobs[0]);const document=await loadBoundDocument(env,workspace,documentId);return{success:true,message:`${filename} accepted for durable processing`,document:documentView(document),job_id:jobId,job:jobView(jobs[0],document)};}

async function getJob(env, workspace, jobId) {
  const jobs = await serviceRequest(env, `ingestion_jobs?workspace_id=eq.${workspace}&id=eq.${jobId}&select=*&limit=1`);
  if (!jobs?.[0]) throw Object.assign(new Error("Ingestion job not found."), { status: 404, code: "JOB_NOT_FOUND" });
  const docs = jobs[0].document_id ? await serviceRequest(env, `documents?workspace_id=eq.${workspace}&id=eq.${jobs[0].document_id}&select=*&limit=1`) : [];
  return jobView(jobs[0], docs?.[0] || null);
}

async function retryExistingJob(env, workspace, jobId, member) {
  requireCapability(member, "research:run"); const jobs=await serviceRequest(env,`ingestion_jobs?workspace_id=eq.${workspace}&id=eq.${jobId}&select=*&limit=1`),job=jobs?.[0];
  if(!job)throw Object.assign(new Error("Ingestion job not found."),{status:404,code:"JOB_NOT_FOUND"}); if(!["failed","cancelled"].includes(job.status))return getJob(env,workspace,jobId);
  const versions=await serviceRequest(env,`document_versions?workspace_id=eq.${workspace}&id=eq.${job.version_id}&select=publication_state&limit=1`); if(!versions?.[0]||versions[0].publication_state==="ready")throw Object.assign(new Error("Completed versions cannot be retried."),{status:409,code:"JOB_NOT_RETRYABLE"});
  await serviceRequest(env,`document_versions?workspace_id=eq.${workspace}&id=eq.${job.version_id}`,{method:"PATCH",body:JSON.stringify({publication_state:"staged",failure_code:null})});
  const updated=await serviceRequest(env,`ingestion_jobs?workspace_id=eq.${workspace}&id=eq.${jobId}&status=in.(failed,cancelled)`,{method:"PATCH",body:JSON.stringify({status:"queued",stage:"queued",progress:0,attempts:0,available_at:new Date().toISOString(),cancellation_requested_at:null,completed_at:null,error_code:null,error_message:null,lease_generation:Number(job.lease_generation||0)+1,lease_owner:null,lease_expires_at:null})});
  if(!updated?.[0])throw Object.assign(new Error("Ingestion job changed before retry."),{status:409,code:"JOB_NOT_RETRYABLE"}); await enqueueJob(env,updated[0]); const docs=await serviceRequest(env,`documents?workspace_id=eq.${workspace}&id=eq.${job.document_id}&select=*&limit=1`); return jobView(updated[0],docs?.[0]||null);
}
async function cancelExistingJob(env,workspace,jobId,member){requireCapability(member,"research:run");const jobs=await serviceRequest(env,`ingestion_jobs?workspace_id=eq.${workspace}&id=eq.${jobId}&select=*&limit=1`),job=jobs?.[0];if(!job||!["queued","processing","retry_wait"].includes(job.status))throw Object.assign(new Error("Cancelable ingestion job not found."),{status:409,code:"JOB_NOT_CANCELABLE"});const updated=await serviceRequest(env,`ingestion_jobs?workspace_id=eq.${workspace}&id=eq.${jobId}&status=in.(queued,processing,retry_wait)`,{method:"PATCH",body:JSON.stringify({status:"cancelled",stage:"cancelled",cancellation_requested_at:new Date().toISOString(),lease_generation:Number(job.lease_generation||0)+1,lease_owner:null,lease_expires_at:null,completed_at:new Date().toISOString(),error_code:"CANCELLED"})});if(!updated?.[0])throw Object.assign(new Error("Cancelable ingestion job not found."),{status:409,code:"JOB_NOT_CANCELABLE"});await serviceRequest(env,`document_versions?workspace_id=eq.${workspace}&id=eq.${job.version_id}&publication_state=neq.ready`,{method:"PATCH",body:JSON.stringify({publication_state:"cancelled",failure_code:"CANCELLED"})});return jobView(updated[0]);}

async function reindexDocument(request,env,user,workspace,member,documentId){requireCapability(member,"research:run");const document=await loadBoundDocument(env,workspace,documentId),v=await serviceRequest(env,`document_versions?workspace_id=eq.${workspace}&id=eq.${document.active_version_id}&select=*&limit=1`);if(!v?.[0])throw Object.assign(new Error("Active version unavailable."),{status:409,code:"VERSION_UNAVAILABLE"});const source=v[0],versionId=crypto.randomUUID(),generation=crypto.randomUUID(),jobId=crypto.randomUUID();await serviceRequest(env,"document_versions",{method:"POST",body:JSON.stringify([{id:versionId,workspace_id:workspace,document_id:documentId,original_bucket:source.original_bucket,original_key:source.original_key,original_hash:source.original_hash,original_bytes:source.original_bytes,original_verified_at:source.original_verified_at,parser_version:"pending",chunker_version:"worker-char-v1",embedding_space_id:env.GEMINI_EMBEDDING_MODEL||"gemini-embedding-001",index_generation:generation,extraction_manifest:{},lifecycle_epoch:Number(document.lifecycle_epoch||1),publication_state:"staged"}])});const jobs=await serviceRequest(env,"ingestion_jobs",{method:"POST",body:JSON.stringify([{id:jobId,workspace_id:workspace,document_id:documentId,version_id:versionId,status:"queued",progress:0,stage:"queued",attempts:0,available_at:new Date().toISOString(),lifecycle_epoch:Number(document.lifecycle_epoch||1),payload:{filename:document.filename,operation:"reindex",supersedes_version_id:source.id},kind:"ingestion"}])});await enqueueJob(env,jobs[0]);return jobView(jobs[0],document);}

async function deleteDocument(request, env, user, workspace, member, documentId) {
  requireCapability(member,"research:run"); const document=await loadBoundDocument(env,workspace,documentId); let operationId;
  if(document.lifecycle_state==="active"){
    const rpc=await apiFetch(`${env.SUPABASE_URL}/rest/v1/rpc/tombstone_document`,{method:"POST",headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,"content-type":"application/json"},body:JSON.stringify({p_workspace:workspace,p_document:documentId,p_actor:user.id})});
    if(!rpc.ok) throw Object.assign(new Error("Document tombstone could not be created."),{status:409,code:"DELETE_CONFLICT"}); operationId=await rpc.json();
  }else if(document.lifecycle_state==="deleting"){
    const operations=await serviceRequest(env,`deletion_operations?workspace_id=eq.${workspace}&resource_id=eq.${documentId}&state=in.(pending,cleaning,blocked)&select=*&order=created_at.desc&limit=1`);
    if(!operations?.[0])throw Object.assign(new Error("The existing deletion operation is unavailable."),{status:409,code:"DELETE_CONFLICT"}); operationId=operations[0].id;
  }else throw Object.assign(new Error("Document not found."),{status:404,code:"DOCUMENT_NOT_FOUND"});
  await serviceRequest(env,`deletion_operations?id=eq.${operationId}`,{method:"PATCH",body:JSON.stringify({state:"cleaning"})}); const targets=await serviceRequest(env,`deletion_targets?workspace_id=eq.${workspace}&operation_id=eq.${operationId}&select=*&order=kind.asc`); const pendingTargets=targets.filter(target=>!target.verified_at);
  const receipt=async(target,provider)=>{const verifiedAt=new Date().toISOString();const receiptHash=await sha256(JSON.stringify({workspace,operation_id:operationId,target_id:target.id,provider,verified_at:verifiedAt}));await serviceRequest(env,"deletion_receipts",{method:"POST",body:JSON.stringify([{workspace_id:workspace,operation_id:operationId,target_id:target.id,provider,receipt_hash:receiptHash,verified_at:verifiedAt}])});await serviceRequest(env,`deletion_targets?id=eq.${target.id}`,{method:"PATCH",body:JSON.stringify({attempts:Number(target.attempts||0)+1,verified_at:verifiedAt,failure_code:null})});};
  try {
    const indexes=pendingTargets.filter(t=>t.kind==="version_index"); if(indexes.length){await deleteQdrantDocument(env,workspace,documentId);for(const target of indexes)await receipt(target,"qdrant");}
    for(const target of pendingTargets.filter(t=>t.kind==="original")){await storageDelete(env,target.object_key);await receipt(target,"supabase_storage");}
    for(const target of pendingTargets.filter(t=>!["original","version_index"].includes(t.kind)))await receipt(target,"supabase");
    await serviceRequest(env,`documents?workspace_id=eq.${workspace}&id=eq.${documentId}`,{method:"DELETE"}); const remaining=await serviceRequest(env,`documents?workspace_id=eq.${workspace}&id=eq.${documentId}&select=id`); if(remaining.length)throw Object.assign(new Error("Supabase document deletion could not be verified."),{status:503,code:"SUPABASE_DELETE_UNVERIFIED"});
    await serviceRequest(env,`deletion_operations?id=eq.${operationId}`,{method:"PATCH",body:JSON.stringify({state:"verified",verified_at:new Date().toISOString()})}); await audit(env,request,user.id,workspace,"document.delete","document"); return{success:true,message:`${document.filename} deleted with verified provider receipts`,operation_id:operationId,receipts:targets.length};
  }catch(error){await serviceRequest(env,`deletion_operations?id=eq.${operationId}`,{method:"PATCH",body:JSON.stringify({state:"blocked"})}).catch(()=>null);throw Object.assign(error,{status:error.status||503,code:error.code||"DELETE_PARTIAL_FAILURE"});}
}

async function chat(request, env, user, workspace, member) {
  requireCapability(member,"research:run"); const started=Date.now(); const body=await request.json(); const question=String(body?.question||"").trim(); if(!question||question.length>10000)throw Object.assign(new Error("Question must contain 1 to 10,000 characters."),{status:422,code:"INVALID_SCOPE"});
  const documentIds=Array.isArray(body?.document_ids)?body.document_ids.filter(v=>/^[0-9a-f-]{36}$/i.test(v)).slice(0,25):[]; const sessionId=/^[0-9a-f-]{36}$/i.test(String(body?.session_id||""))?body.session_id:crypto.randomUUID();
  let sessions=await serviceRequest(env,`chat_sessions?workspace_id=eq.${workspace}&id=eq.${sessionId}&user_id=eq.${user.id}&deleted_at=is.null&select=*&limit=1`); if(!sessions?.[0])sessions=await serviceRequest(env,"chat_sessions",{method:"POST",body:JSON.stringify([{id:sessionId,workspace_id:workspace,user_id:user.id,title:question.slice(0,120),visibility:"private"}])});
  await serviceRequest(env,"chat_messages",{method:"POST",body:JSON.stringify([{workspace_id:workspace,session_id:sessionId,role:"user",content:question,sources:[],metadata:{query_type:"general"}}])});
  const requestedFilter=documentIds.length?`&id=in.(${documentIds.join(",")})`:"";const activeDocuments=await serviceRequest(env,`documents?workspace_id=eq.${workspace}&lifecycle_state=eq.active&active_version_id=not.is.null${requestedFilter}&select=id,active_version_id&limit=100`);const activeDocumentIds=activeDocuments.map(item=>item.id),activeVersionIds=activeDocuments.map(item=>item.active_version_id);const vectorHits=activeVersionIds.length?await searchChunks(env,{workspaceId:workspace,question,documentIds:activeDocumentIds,versionIds:activeVersionIds,limit:Math.min(Number(body?.top_k||12),12)}):[];const lexical=activeVersionIds.length?await serviceRequest(env,`document_chunks?workspace_id=eq.${workspace}&version_id=in.(${activeVersionIds.join(",")})&select=id,document_id,version_id,chunk_index,page_number,content,metadata&limit=200`):[];const hits=hybridFuse(question,vectorHits,lexical,Math.min(Number(body?.top_k||8),12));
  const sources=hits.map(hit=>({content:String(hit.payload?.content||""),filename:String(hit.payload?.filename||"document"),page_number:Number(hit.payload?.page_number||0),chunk_index:Number(hit.payload?.chunk_index||0),relevance_score:Number(hit.score||hit.lexical_score||0),document_type:"text",metadata:{document_id:hit.payload?.document_id,version_id:hit.payload?.version_id,chunk_id:hit.payload?.chunk_id,hybrid_rrf:hit.rrf}}));let response;
  if(!sources.length)response={answer:"I could not find sufficient evidence in the selected workspace, so I cannot answer reliably.",sources:[],query_type:"general",confidence:0,response_time_seconds:(Date.now()-started)/1000,metadata:{claim_state:"UNSUPPORTED",abstained:true,session_id:sessionId}};else{const generated=await generateAnswer(env,groundedPrompt(question,hits));response={answer:generated.answer,sources,query_type:"hybrid",confidence:Math.min(1,Math.max(0,sources[0]?.relevance_score||0)),response_time_seconds:(Date.now()-started)/1000,metadata:{claim_state:"SUPPORTED",citation_required:true,model:generated.model,paid_fallback:false,retrieval:"rrf_dense_lexical",session_id:sessionId}};await serviceRequest(env,"llm_usage_events",{method:"POST",body:JSON.stringify([{workspace_id:workspace,user_id:user.id,provider:"gemini",model:generated.model,operation:"grounded_chat",input_tokens:generated.usage.promptTokenCount||null,output_tokens:generated.usage.candidatesTokenCount||null,success:true,cost_microusd:0}])}).catch(()=>null);}
  await serviceRequest(env,"chat_messages",{method:"POST",body:JSON.stringify([{workspace_id:workspace,session_id:sessionId,role:"assistant",content:response.answer,sources:response.sources,metadata:{...response.metadata,query_type:response.query_type,confidence:response.confidence,response_time_seconds:response.response_time_seconds}}])}); await serviceRequest(env,`chat_sessions?id=eq.${sessionId}`,{method:"PATCH",body:JSON.stringify({updated_at:new Date().toISOString(),revision:Number(sessions[0].revision||1)+1})}); await audit(env,request,user.id,workspace,"research.run","query"); return response;
}
async function handle(request, env = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return json(request, env, null, 204, { "access-control-allow-methods": "GET,HEAD,POST,PATCH,OPTIONS", "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Nexus-Workspace-Id,X-Workspace-ID", "access-control-max-age": "600" });
  }
  if (url.pathname === "/" || url.pathname === "/health") {
    return json(request, env, { service: env.RUNTIME_SERVICE_NAME || "nexusrag-v6-preview-gateway", profile: "ZERO_COST_LOW_TRAFFIC", status: configured(env) ? "READY" : "DEGRADED", authenticated_api: configured(env), production_verified: false, authorities: { business_records: "supabase", vectors: "qdrant" }, providers: { qdrant: env.QDRANT_URL && env.QDRANT_API_KEY ? "CONFIGURED" : "BLOCKED", gemini: env.GOOGLE_API_KEY ? "CONFIGURED" : "BLOCKED" }, paid_fallback: false });
  }
  if (!configured(env)) return fail(request, env, "CONFIGURATION_ERROR", "The authenticated gateway is not configured.", 503);
  try {
    const user = await authenticate(request, env);
    if (!allowRequest(user.id)) return fail(request, env, "TENANT_QUOTA_EXCEEDED", "Per-user request limit reached.", 429, true);

    if (url.pathname === "/api/v2/capabilities" && (request.method === "GET" || request.method === "HEAD")) {
      const bound = request.headers.get("x-nexus-workspace-id") || request.headers.get("x-workspace-id");
      if (!bound) return json(request, env, { status: "READY", authenticated: true, workspace_bound: false, capabilities: [] });
      const member = await membership(env, user.id, workspaceId(request));
      return json(request, env, { status: "READY", authenticated: true, workspace_bound: true, workspace_id: member.workspace_id, role: member.role, capabilities: ROLE_CAPABILITIES[member.role] || [] });
    }

    if (url.pathname === "/api/v2/mcp/operations" && (request.method === "GET" || request.method === "HEAD")) {
      const id = workspaceId(request); const member = await membership(env, user.id, id);
      const granted = new Set(ROLE_CAPABILITIES[member.role] || []);
      return json(request, env, { protocol: "nexusrag-evidence-mcp/1", destructive_operations: false, operations: Object.entries(MCP_OPERATIONS).filter(([, spec]) => granted.has(spec.capability)).map(([name, spec]) => ({ name, capability: spec.capability, result_limit: 50, deadline_ms: 8000, read_only: true })) });
    }
    if (url.pathname === "/api/v2/mcp/execute" && request.method === "POST") {
      const id = workspaceId(request); const member = await membership(env, user.id, id);
      const body = await request.json(); const operation = String(body?.operation || ""); const spec = MCP_OPERATIONS[operation];
      if (!spec) throw Object.assign(new Error("The MCP operation is not available."), { status: 404, code: "INVALID_SCOPE" });
      if (!(ROLE_CAPABILITIES[member.role] || []).includes(spec.capability)) throw Object.assign(new Error("The required capability is not granted."), { status: 403, code: "FORBIDDEN" });
      const limit = Math.min(Math.max(Number.parseInt(String(body?.limit || 20), 10) || 20, 1), 50);
      const rows = await serviceRequest(env, `${spec.table}?workspace_id=eq.${id}&select=*&limit=${limit}`);
      await audit(env, request, user.id, id, `mcp.${operation}`, spec.table);
      return json(request, env, { protocol: "nexusrag-evidence-mcp/1", operation, items: rows, limit, workspace_id: id });
    }

    if (url.pathname === "/api/v1/workspaces" && request.method === "POST") return json(request, env, await createWorkspace(request, env, user), 201);
    if (url.pathname === "/api/v1/workspaces" && (request.method === "GET" || request.method === "HEAD")) {
      const members = await serviceRequest(env, `workspace_members?user_id=eq.${encodeURIComponent(user.id)}&select=workspace_id,role&limit=50`);
      const ids = members.map((item) => item.workspace_id);
      const workspaces = ids.length ? await serviceRequest(env, `workspaces?id=in.(${ids.join(",")})&select=id,name,slug,plan,lifecycle_state,created_at&limit=50`) : [];
      const roles = Object.fromEntries(members.map((item) => [item.workspace_id, item.role]));
      return json(request, env, { workspaces: workspaces.map((item) => ({ ...item, workspace_id: item.id, role: roles[item.id] })) });
    }
    if (url.pathname === "/api/v1/workspaces/current" && (request.method === "GET" || request.method === "HEAD")) {
      const id = workspaceId(request); const member = await membership(env, user.id, id);
      const rows = await serviceRequest(env, `workspaces?id=eq.${id}&select=id,name,slug,plan,lifecycle_state,created_at&limit=1`);
      return json(request, env, { ...(rows[0] || {}), workspace_id: id, role: member.role });
    }

    if (url.pathname === "/api/v1/settings" && (request.method === "GET" || request.method === "HEAD")) {
      const id = workspaceId(request);
      await membership(env, user.id, id);
      return json(request, env, await readWorkspaceSettings(env, id));
    }
    if (url.pathname === "/api/v1/settings" && request.method === "PATCH") {
      const id = workspaceId(request);
      const member = await membership(env, user.id, id);
      if (!["owner", "admin"].includes(member.role)) {
        throw Object.assign(new Error("Only workspace admins and owners can change runtime settings."), { status: 403, code: "FORBIDDEN" });
      }
      const patch = validateSettingsPatch(await request.json());
      await serviceRequest(env, "workspace_settings?on_conflict=workspace_id", {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify([{ workspace_id: id, ...patch }]),
      });
      await audit(env, request, user.id, id, "settings.update", "workspace_settings");
      return json(request, env, await readWorkspaceSettings(env, id));
    }

    if (url.pathname === "/api/v1/documents/upload" && request.method === "POST") {
      const id = workspaceId(request); const member = await membership(env, user.id, id);
      return json(request, env, await uploadDocument(request, env, user, id, member), 202);
    }
    if (url.pathname === "/api/v1/documents" && (request.method === "GET" || request.method === "HEAD")) {
      const id = workspaceId(request); await membership(env, user.id, id);
      const rows = await serviceRequest(env, `documents?workspace_id=eq.${id}&lifecycle_state=eq.active&select=*&order=created_at.desc&limit=100`);
      return json(request, env, { documents: rows.map(documentView), total: rows.length });
    }
    const jobRoute = url.pathname.match(/^\/api\/v1\/documents\/jobs\/([0-9a-f-]{36})(?:\/(retry|cancel))?$/i);
    if (jobRoute) {
      const id=workspaceId(request);const member=await membership(env,user.id,id);
      if(!jobRoute[2]&&(request.method==="GET"||request.method==="HEAD"))return json(request,env,await getJob(env,id,jobRoute[1]));
      if(jobRoute[2]==="retry"&&request.method==="POST")return json(request,env,await retryExistingJob(env,id,jobRoute[1],member),202);
      if(jobRoute[2]==="cancel"&&request.method==="POST")return json(request,env,await cancelExistingJob(env,id,jobRoute[1],member),202);
    }
    const documentRoute=url.pathname.match(/^\/api\/v1\/documents\/([0-9a-f-]{36})\/(status|chunks|reindex|delete)$/i);
    if(documentRoute){const id=workspaceId(request);const member=await membership(env,user.id,id);const documentId=documentRoute[1];const action=documentRoute[2];
      if(action==="status"&&(request.method==="GET"||request.method==="HEAD")){const document=await loadBoundDocument(env,id,documentId);const jobs=await serviceRequest(env,`ingestion_jobs?workspace_id=eq.${id}&document_id=eq.${documentId}&select=*&order=created_at.desc&limit=1`);return json(request,env,jobs?.[0]?jobView(jobs[0],document):{job_id:"",document_id:documentId,filename:document.filename,status:document.status==="ready"?"completed":document.status==="error"?"failed":document.status,stage:document.status,progress:document.status==="ready"?100:0,message:`Document ${document.status}`,error_message:document.error_message,created_at:document.created_at,updated_at:document.updated_at,document:documentView(document)});}
      if(action==="chunks"&&(request.method==="GET"||request.method==="HEAD")){const document=await loadBoundDocument(env,id,documentId);const limit=Math.min(Math.max(Number.parseInt(url.searchParams.get("limit")||"100",10)||100,1),200);const query=String(url.searchParams.get("search")||"").trim().toLowerCase();let chunks=document.active_version_id?await serviceRequest(env,`document_chunks?workspace_id=eq.${id}&document_id=eq.${documentId}&version_id=eq.${document.active_version_id}&select=chunk_index,content,page_number,section_title,token_count,metadata&order=chunk_index.asc&limit=${limit}`):[];if(query)chunks=chunks.filter(c=>String(c.content||"").toLowerCase().includes(query));return json(request,env,{document_id:documentId,filename:document.filename,chunks,total:chunks.length,query:query||null});}
      if(action==="reindex"&&request.method==="POST")return json(request,env,await reindexDocument(request,env,user,id,member,documentId),202);
      if(action==="delete"&&request.method==="POST")return json(request,env,await deleteDocument(request,env,user,id,member,documentId));
    }
    const sessionRoute=url.pathname.match(/^\/api\/v1\/chat\/sessions\/([0-9a-f-]{36})\/(messages|clear)$/i);
    if(sessionRoute){const id=workspaceId(request);await membership(env,user.id,id);const sessionId=sessionRoute[1];const sessions=await serviceRequest(env,`chat_sessions?workspace_id=eq.${id}&id=eq.${sessionId}&user_id=eq.${user.id}&deleted_at=is.null&select=*&limit=1`);if(!sessions?.[0]&&sessionRoute[2]==="messages")return json(request,env,{session_id:sessionId,messages:[],total:0});if(!sessions?.[0])throw Object.assign(new Error("Chat session not found."),{status:404,code:"SESSION_NOT_FOUND"});if(sessionRoute[2]==="messages"&&(request.method==="GET"||request.method==="HEAD")){const messages=await serviceRequest(env,`chat_messages?workspace_id=eq.${id}&session_id=eq.${sessionId}&select=role,content,sources,metadata,created_at&order=created_at.asc&limit=500`);return json(request,env,{session_id:sessionId,messages,total:messages.length});}if(sessionRoute[2]==="clear"&&request.method==="POST"){const messages=await serviceRequest(env,`chat_messages?workspace_id=eq.${id}&session_id=eq.${sessionId}&select=id`);await serviceRequest(env,`chat_messages?workspace_id=eq.${id}&session_id=eq.${sessionId}`,{method:"DELETE"});await serviceRequest(env,`chat_sessions?id=eq.${sessionId}`,{method:"PATCH",body:JSON.stringify({updated_at:new Date().toISOString(),revision:Number(sessions[0].revision||1)+1})});return json(request,env,{success:true,durable_messages_deleted:messages.length});}}
    if (url.pathname === "/api/v1/chat" && request.method === "POST") {
      const id=workspaceId(request);const member=await membership(env,user.id,id);const result=await chat(request,env,user,id,member);
      if((request.headers.get("accept")||"").includes("text/event-stream")){const encoder=new TextEncoder();const stream=new ReadableStream({start(controller){for(const token of result.answer.match(/.{1,96}/gs)||[])controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({content:token})}\n\n`));controller.enqueue(encoder.encode(`event: sources\ndata: ${JSON.stringify({sources:result.sources})}\n\nevent: done\ndata: ${JSON.stringify({metadata:result.metadata})}\n\n`));controller.close();}});const output=headers(request,env);output.set("content-type","text/event-stream; charset=utf-8");output.set("connection","keep-alive");return new Response(stream,{status:200,headers:output});}
      return json(request,env,result);
    }

    const route = READ_ROUTES[url.pathname];
    if (route && (request.method === "GET" || request.method === "HEAD")) {
      const id = workspaceId(request); const member = await membership(env, user.id, id);
      if (!(ROLE_CAPABILITIES[member.role] || []).includes(route.capability)) throw Object.assign(new Error("The required capability is not granted."), { status: 403, code: "FORBIDDEN" });
      const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 50);
      const rows = await serviceRequest(env, `${route.table}?workspace_id=eq.${id}&select=*&limit=${limit}`);
      await audit(env, request, user.id, id, `${route.capability}.list`, route.table);
      return json(request, env, { items: rows, limit, workspace_id: id, capability: route.capability });
    }

    return fail(request, env, "INVALID_SCOPE", "Route is not available.", 404);
  } catch (error) {
    return fail(request, env, error.code || "INTERNAL_ERROR", error.message || "The request could not be completed.", error.status || 500, Boolean(error.status === 429 || error.status === 503));
  }
}
async function queue(batch,env){return handleQueue(batch,env)}
async function scheduled(_event,env,ctx){ctx.waitUntil(sweepJobs(env))}
export { allowRequest, handle, queue, scheduled, storageDelete };
export default { fetch: handle, queue, scheduled };
