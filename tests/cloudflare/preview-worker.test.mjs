import test from "node:test";
import assert from "node:assert/strict";
import worker, { allowRequest, handle, storageDelete } from "../../apps/gateway/src/preview-worker.js";

const request = (path = "/health", init = {}) => new Request(`https://preview.invalid${path}`, init);
const configured = {
  SUPABASE_URL: "https://supabase.invalid",
  SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-secret",
  FRONTEND_ORIGIN: "https://frontend.invalid",
  QDRANT_URL: "https://qdrant.invalid",
  QDRANT_API_KEY: "synthetic-qdrant-secret",
  GOOGLE_API_KEY: "synthetic-google-secret",
  RUNTIME_SERVICE_NAME: "nexusrag-test-gateway",
};

test("preview health is honest, authenticated-api ready, and zero-cost", async () => {
  const response = await handle(request(), configured);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.service, "nexusrag-test-gateway");
  assert.equal(body.profile, "ZERO_COST_LOW_TRAFFIC");
  assert.equal(body.status, "READY");
  assert.equal(body.authenticated_api, true);
  assert.equal(body.production_verified, false);
  assert.equal(body.paid_fallback, false);
  assert.deepEqual(body.authorities, { business_records: "supabase", vectors: "qdrant" });
  assert.deepEqual(body.providers, { qdrant: "CONFIGURED", gemini: "CONFIGURED" });
  assert.doesNotMatch(JSON.stringify(body), /synthetic/);
});

test("unconfigured preview remains degraded", async () => {
  const body = await (await handle(request())).json();
  assert.equal(body.status, "DEGRADED");
  assert.equal(body.authenticated_api, false);
});

test("private API fails closed without an access token", async () => {
  const response = await worker.fetch(request("/api/v2/capabilities"), configured);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "AUTH_REQUIRED");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.ok(response.headers.get("x-request-id"));
});

test("document lifecycle and chat-history routes fail closed", async () => {
  const routes = [["GET","/api/v1/status"],["GET","/api/v1/documents/11111111-1111-4111-8111-111111111111/status"],["GET","/api/v1/documents/11111111-1111-4111-8111-111111111111/chunks"],["POST","/api/v1/documents/11111111-1111-4111-8111-111111111111/reindex"],["POST","/api/v1/documents/11111111-1111-4111-8111-111111111111/delete"],["GET","/api/v1/documents/jobs/11111111-1111-4111-8111-111111111111"],["POST","/api/v1/documents/jobs/11111111-1111-4111-8111-111111111111/cancel"],["GET","/api/v1/chat/sessions/11111111-1111-4111-8111-111111111111/messages"]];
  for (const [method,path] of routes) { const response=await handle(request(path,{method}),configured); assert.equal(response.status,401,`${method} ${path}`); assert.equal((await response.json()).error.code,"AUTH_REQUIRED"); }
});

test("billing usage is workspace-authorized and does not flatten unknown cost to zero", async () => {
  const originalFetch = globalThis.fetch;
  const workspace = "77777777-7777-4777-8777-777777777777";
  const user = "88888888-8888-4888-8888-888888888888";
  let usageQueryCount = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: user }), { status: 200 });
    if (target.includes(`/rest/v1/workspace_members?workspace_id=eq.${workspace}&user_id=eq.${user}`)) {
      return new Response(JSON.stringify([{ workspace_id: workspace, user_id: user, role: "owner" }]), { status: 200 });
    }
    if (target.includes(`/rest/v1/workspace_usage_daily?workspace_id=eq.${workspace}`)) {
      usageQueryCount += 1;
      return new Response(JSON.stringify([
        { usage_date: "2026-09-25", query_count: 2, input_tokens: 10, output_tokens: 8, total_tokens: 18, successful_calls: 2, failed_calls: 0, estimated_cost_microusd: null, reconciled_at: "2026-09-25T12:00:00Z" },
        { usage_date: "2026-09-24", query_count: 1, input_tokens: 4, output_tokens: 5, total_tokens: 9, successful_calls: 1, failed_calls: 0, estimated_cost_microusd: 12, reconciled_at: "2026-09-24T12:00:00Z" },
      ]), { status: 200 });
    }
    throw new Error(`Unexpected usage query: ${target}`);
  };
  try {
    const response = await handle(request("/api/v1/billing/usage", {
      headers: { authorization: "Bearer synthetic-user-token", "X-Nexus-Workspace-Id": workspace },
    }), configured);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.storage, "supabase");
    assert.equal(body.daily.length, 2);
    assert.equal(body.totals.query_count, 3);
    assert.equal(body.totals.total_tokens, 27);
    assert.equal(body.totals.estimated_cost_microusd, null);
    assert.equal(usageQueryCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("billing usage denies non-admin workspace members before reading ledger rows", async () => {
  const originalFetch = globalThis.fetch;
  const workspace = "99999999-9999-4999-8999-999999999999";
  const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let usageQueryCount = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: user }), { status: 200 });
    if (target.includes(`/rest/v1/workspace_members?workspace_id=eq.${workspace}&user_id=eq.${user}`)) {
      return new Response(JSON.stringify([{ workspace_id: workspace, user_id: user, role: "viewer" }]), { status: 200 });
    }
    if (target.includes("/rest/v1/workspace_usage_daily?")) usageQueryCount += 1;
    throw new Error(`Unexpected viewer usage query: ${target}`);
  };
  try {
    const response = await handle(request("/api/v1/billing/usage", {
      headers: { authorization: "Bearer synthetic-user-token", "X-Nexus-Workspace-Id": workspace },
    }), configured);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "FORBIDDEN");
    assert.equal(usageQueryCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workspace settings are authenticated, tenant-scoped, secret-free, and use safe Worker defaults", async () => {
  const originalFetch = globalThis.fetch;
  const workspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const user = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: user }), { status: 200 });
    if (target.includes(`/rest/v1/workspace_members?workspace_id=eq.${workspace}&user_id=eq.${user}`)) {
      return new Response(JSON.stringify([{ workspace_id: workspace, user_id: user, role: "editor" }]), { status: 200 });
    }
    if (target.includes(`/rest/v1/workspace_settings?workspace_id=eq.${workspace}`)) return new Response("[]", { status: 200 });
    throw new Error(`Unexpected settings request: ${target}`);
  };
  try {
    const response = await handle(request("/api/v1/settings", {
      headers: { authorization: "Bearer synthetic-user-token", "X-Nexus-Workspace-Id": workspace },
    }), configured);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.llm_model_name, "gemini-2.5-flash");
    assert.equal(body.embedding_model, "gemini-embedding-001");
    assert.equal(body.retrieval_top_k, 10);
    assert.equal(body.hybrid_search_alpha, 0.6);
    assert.equal(body.llm_temperature, 0.1);
    assert.equal(body.context_window_messages, 1);
    assert.equal(body.enable_reranking, false);
    assert.equal(body.enable_semantic_chunking, false);
    assert.equal(body.enable_contextual_enrichment, false);
    assert.equal(body.chunk_size, 1600);
    assert.equal(body.chunk_overlap, 240);
    assert.equal(JSON.stringify(body).includes("synthetic-service-secret"), false);
    assert.equal(calls.some((target) => target.includes("/rest/v1/workspace_settings?workspace_id=eq.")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workspace settings fall back to safe defaults when persisted values are malformed or out of range", async () => {
  const originalFetch = globalThis.fetch;
  const workspace = "abababab-abab-4bab-8bab-abababababab";
  const user = "cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd";
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: user }), { status: 200 });
    if (target.includes(`/rest/v1/workspace_members?workspace_id=eq.${workspace}&user_id=eq.${user}`)) {
      return new Response(JSON.stringify([{ workspace_id: workspace, user_id: user, role: "editor" }]), { status: 200 });
    }
    if (target.includes(`/rest/v1/workspace_settings?workspace_id=eq.${workspace}`)) {
      return new Response(JSON.stringify([{
        workspace_id: workspace,
        retrieval_top_k: 99,
        hybrid_search_alpha: "not-a-number",
        llm_temperature: -0.1,
      }]), { status: 200 });
    }
    throw new Error(`Unexpected settings request: ${target}`);
  };
  try {
    const response = await handle(request("/api/v1/settings", {
      headers: { authorization: "Bearer synthetic-user-token", "X-Nexus-Workspace-Id": workspace },
    }), configured);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.retrieval_top_k, 10);
    assert.equal(body.hybrid_search_alpha, 0.6);
    assert.equal(body.llm_temperature, 0.1);
    assert.ok(Number.isFinite(body.retrieval_top_k));
    assert.ok(Number.isFinite(body.hybrid_search_alpha));
    assert.ok(Number.isFinite(body.llm_temperature));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workspace owners can update bounded settings with a workspace-scoped upsert", async () => {
  const originalFetch = globalThis.fetch;
  const workspace = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const user = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  let settings = null;
  let upsert = null;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: user }), { status: 200 });
    if (target.includes(`/rest/v1/workspace_members?workspace_id=eq.${workspace}&user_id=eq.${user}`)) {
      return new Response(JSON.stringify([{ workspace_id: workspace, user_id: user, role: "owner" }]), { status: 200 });
    }
    if (target.includes(`/rest/v1/workspace_settings?on_conflict=workspace_id`) && init.method === "POST") {
      upsert = { headers: new Headers(init.headers), body: JSON.parse(init.body) };
      settings = { ...settings, ...upsert.body[0] };
      return new Response(JSON.stringify([settings]), { status: 200 });
    }
    if (target.includes(`/rest/v1/workspace_settings?workspace_id=eq.${workspace}`)) {
      return new Response(JSON.stringify(settings ? [settings] : []), { status: 200 });
    }
    if (target.includes("/rest/v1/audit_events") && init.method === "POST") return new Response("[]", { status: 201 });
    throw new Error(`Unexpected settings request: ${target}`);
  };
  try {
    const response = await handle(request("/api/v1/settings", {
      method: "PATCH",
      headers: { authorization: "Bearer synthetic-user-token", "X-Nexus-Workspace-Id": workspace, "content-type": "application/json" },
      body: JSON.stringify({ llm_temperature: 0.35, retrieval_top_k: 7, hybrid_search_alpha: 0.25 }),
    }), configured);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.llm_temperature, 0.35);
    assert.equal(body.retrieval_top_k, 7);
    assert.equal(body.hybrid_search_alpha, 0.25);
    assert.equal(upsert.body[0].workspace_id, workspace);
    assert.equal(upsert.headers.get("prefer"), "resolution=merge-duplicates,return=representation");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workspace settings reject viewers and unsupported or out-of-range patches", async () => {
  const originalFetch = globalThis.fetch;
  const workspace = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const user = "11111111-1111-4111-8111-111111111112";
  let settingsWrites = 0;
  let role = "viewer";
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: user }), { status: 200 });
    if (target.includes(`/rest/v1/workspace_members?workspace_id=eq.${workspace}&user_id=eq.${user}`)) {
      return new Response(JSON.stringify([{ workspace_id: workspace, user_id: user, role }]), { status: 200 });
    }
    if (target.includes("/rest/v1/workspace_settings") && init.method === "POST") {
      settingsWrites += 1;
      return new Response("[]", { status: 200 });
    }
    if (target.includes("/rest/v1/audit_events")) return new Response("[]", { status: 201 });
    throw new Error(`Unexpected settings request: ${target}`);
  };
  const makePatch = (body) => request("/api/v1/settings", {
    method: "PATCH",
    headers: { authorization: "Bearer synthetic-user-token", "X-Nexus-Workspace-Id": workspace, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    const forbidden = await handle(makePatch({ llm_temperature: 0.2 }), configured);
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error.code, "FORBIDDEN");
    role = "owner";
    const unsupported = await handle(makePatch({ enable_contextual_enrichment: true }), configured);
    assert.equal(unsupported.status, 422);
    assert.equal((await unsupported.json()).error.code, "UNSUPPORTED_SETTING");
    const invalid = await handle(makePatch({ retrieval_top_k: 13 }), configured);
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).error.code, "INVALID_SETTINGS");
    assert.equal(settingsWrites, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CORS is exact-origin and preflight is bounded", async () => {
  const allowed = await handle(request("/api/v2/capabilities", { method: "OPTIONS", headers: { Origin: configured.FRONTEND_ORIGIN } }), configured);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), configured.FRONTEND_ORIGIN);
  const settingsPreflight = await handle(request("/api/v1/settings", { method: "OPTIONS", headers: { Origin: configured.FRONTEND_ORIGIN } }), configured);
  assert.match(settingsPreflight.headers.get("access-control-allow-methods"), /PATCH/);
  const denied = await handle(request("/api/v2/capabilities", { method: "OPTIONS", headers: { Origin: "https://evil.invalid" } }), configured);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("per-user fallback limiter rejects the sixty-first request", () => {
  const key = `test-${crypto.randomUUID()}`;
  for (let index = 0; index < 60; index += 1) assert.equal(allowRequest(key, 1_000 + index), true);
  assert.equal(allowRequest(key, 1_100), false);
});

test("HEAD emits no response body", async () => {
  const response = await handle(request("/health", { method: "HEAD" }), configured);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});


test("storage deletion accepts Supabase NoSuchKey absence verification", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    if (calls.length === 1) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify({ code: "NoSuchKey", error: "not_found", message: "Object not found" }), { status: 400, headers: { "content-type": "application/json" } });
  };
  try {
    await storageDelete(configured, "workspace/document/version/file.txt");
    assert.deepEqual(calls.map((call) => call.method), ["DELETE", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("storage deletion rejects an unrelated 400 verification response", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify({ code: "InvalidRequest", message: "Malformed request" }), { status: 400, headers: { "content-type": "application/json" } });
  };
  try {
    await assert.rejects(storageDelete(configured, "workspace/document/version/file.txt"), (error) => error.code === "STORAGE_DELETE_UNVERIFIED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("authenticated system status reports real data-API reachability without leaking provider secrets", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/auth/v1/user")) {
      assert.equal(init.headers.authorization, "Bearer synthetic-user-token");
      return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/rest/v1/workspaces?select=id&limit=1")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected status probe: ${target}`);
  };
  try {
    const response = await handle(request("/api/v1/status", { headers: { authorization: "Bearer synthetic-user-token" } }), configured);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "READY");
    assert.equal(body.settings.supabase_configured, true);
    assert.equal(body.settings.supabase_auth_configured, true);
    assert.equal(body.settings.supabase_data_api_reachable, true);
    assert.equal(body.settings.memory_constrained, true);
    assert.equal("use_lightweight_embeddings" in body.settings, false, "Gemini embeddings must not be mislabeled lightweight");
    assert.equal(body.settings.enable_qdrant, false, "configured provider must not be represented as policy-approved");
    assert.equal(body.metered_operations, "REVIEW_REQUIRED");
    assert.equal(body.paid_fallback, false);
    assert.equal(body.product_readiness, "NOT_VERIFIED");
    assert.equal(body.total_documents, 0);
    assert.equal(body.total_chunks, 0);
    assert.doesNotMatch(JSON.stringify(body), /synthetic-(?:service|qdrant|google)-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authenticated system status degrades when Supabase data API is unreachable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "22222222-2222-4222-8222-222222222222" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("unavailable", { status: 503 });
  };
  try {
    const response = await handle(request("/api/v1/status", { headers: { authorization: "Bearer synthetic-user-token" } }), configured);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "DEGRADED");
    assert.equal(body.settings.supabase_data_api_reachable, false);
    assert.equal(body.settings.supabase_data_api_status, "unavailable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("system status counts only a workspace the authenticated user belongs to", async () => {
  const originalFetch = globalThis.fetch;
  const workspace = "33333333-3333-4333-8333-333333333333";
  const user = "44444444-4444-4444-8444-444444444444";
  const observed = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    observed.push({ target, method: init.method || "GET" });
    if (target.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: user }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/rest/v1/workspaces?select=id&limit=1")) return new Response("[]", { status: 200 });
    if (target.includes(`/rest/v1/workspace_members?workspace_id=eq.${workspace}&user_id=eq.${user}`)) {
      return new Response(JSON.stringify([{ workspace_id: workspace, user_id: user, role: "owner" }]), { status: 200 });
    }
    if (target.includes(`/rest/v1/documents?workspace_id=eq.${workspace}`)) {
      return new Response(null, { status: 200, headers: { "content-range": "0-6/7" } });
    }
    if (target.includes(`/rest/v1/document_chunks?workspace_id=eq.${workspace}`)) {
      return new Response(null, { status: 200, headers: { "content-range": "0-10/11" } });
    }
    throw new Error(`Unexpected workspace status request: ${target}`);
  };
  try {
    const response = await handle(request("/api/v1/status", {
      headers: { authorization: "Bearer synthetic-user-token", "X-Nexus-Workspace-Id": workspace },
    }), configured);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.total_documents, 7);
    assert.equal(body.total_chunks, 11);
    const countQueries = observed.filter(({ method }) => method === "HEAD");
    assert.equal(countQueries.length, 2);
    assert.ok(countQueries.every(({ target }) => target.includes(`workspace_id=eq.${workspace}`)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("system status denies an unowned workspace before issuing tenant count queries", async () => {
  const originalFetch = globalThis.fetch;
  const workspace = "55555555-5555-4555-8555-555555555555";
  const user = "66666666-6666-4666-8666-666666666666";
  const observed = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    observed.push(target);
    if (target.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: user }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/rest/v1/workspaces?select=id&limit=1")) return new Response("[]", { status: 200 });
    if (target.includes(`/rest/v1/workspace_members?workspace_id=eq.${workspace}&user_id=eq.${user}`)) return new Response("[]", { status: 200 });
    throw new Error(`Unexpected foreign-workspace query: ${target}`);
  };
  try {
    const response = await handle(request("/api/v1/status", {
      headers: { authorization: "Bearer synthetic-user-token", "X-Nexus-Workspace-Id": workspace },
    }), configured);
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, "FORBIDDEN");
    assert.equal(observed.some((target) => target.includes("/rest/v1/documents?") || target.includes("/rest/v1/document_chunks?")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
