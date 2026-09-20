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
async function handle(request, env = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return json(request, env, null, 204, { "access-control-allow-methods": "GET,HEAD,POST,OPTIONS", "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Nexus-Workspace-Id,X-Workspace-ID", "access-control-max-age": "600" });
  }
  if (url.pathname === "/" || url.pathname === "/health") {
    return json(request, env, { service: "nexusrag-v6-preview-gateway", profile: "ZERO_COST_LOW_TRAFFIC", status: configured(env) ? "READY" : "DEGRADED", authenticated_api: configured(env), production_verified: false, authorities: { business_records: "supabase", vectors: "qdrant" }, providers: { qdrant: env.QDRANT_URL && env.QDRANT_API_KEY ? "CONFIGURED" : "BLOCKED", gemini: env.GOOGLE_API_KEY ? "CONFIGURED" : "BLOCKED" }, paid_fallback: false });
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
export { allowRequest, handle };
export default { fetch: handle };
