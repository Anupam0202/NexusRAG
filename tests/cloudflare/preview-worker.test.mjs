import test from "node:test";
import assert from "node:assert/strict";
import worker, { allowRequest, handle, storageDelete } from "../../apps/gateway/src/preview-worker.js";

const request = (path = "/health", init = {}) => new Request(`{{https://preview.invalid${path}}}`, init);
const configured = {
  SUPABASE_URL: "https://supabase.invalid",
  SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-secret",
  FRONTEND_ORIGIN: "https://frontend.invalid",
  QDRANT_URL: "https://qdrant.invalid",
  QDRANT_API_KEY: "synthetic-qdrant-secret",
  GOOGLE_API_KEY: "synthetic-google-secret",
};

test("preview health is honest, authenticated-api ready, and zero-cost", async () => {
  const response = await handle(request(), configured);
  const body = await response.json();
  assert.equal(response.status, 200);
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
  const routes = [["GET","/api/v1/documents/11111111-1111-4111-8111-111111111111/status"],["GET","/api/v1/documents/11111111-1111-4111-8111-111111111111/chunks"],["POST","/api/v1/documents/11111111-1111-4111-8111-111111111111/reindex"],["POST","/api/v1/documents/11111111-1111-4111-8111-111111111111/delete"],["GET","/api/v1/documents/jobs/11111111-1111-4111-8111-111111111111"],["POST","/api/v1/documents/jobs/11111111-1111-4111-8111-111111111111/cancel"],["GET","/api/v1/chat/sessions/11111111-1111-4111-8111-111111111111/messages"]];
  for (const [method,path] of routes) { const response=await handle(request(path,{method}),configured); assert.equal(response.status,401,`${method} ${path}`); assert.equal((await response.json()).error.code,"AUTH_REQUIRED"); }
});

test("CORS is exact-origin and preflight is bounded", async () => {
  const allowed = await handle(request("/api/v2/capabilities", { method: "OPTIONS", headers: { Origin: configured.FRONTEND_ORIGIN } }), configured);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), configured.FRONTEND_ORIGIN);
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
