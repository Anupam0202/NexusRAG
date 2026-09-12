import test from "node:test";
import assert from "node:assert/strict";
import worker, { handle } from "../../apps/gateway/src/preview-worker.js";

const request = (path = "/health", init = {}) =>
  new Request(`https://preview.invalid${path}`, init);

test("preview health is honest and zero-cost", async () => {
  const response = await handle(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.profile, "ZERO_COST_LOW_TRAFFIC");
  assert.equal(body.status, "DEGRADED");
  assert.equal(body.production_verified, false);
  assert.equal(body.paid_fallback, false);
  assert.deepEqual(body.authorities, { business_records: "supabase", vectors: "qdrant" });
});

test("preview responses use defensive headers", async () => {
  const response = await worker.fetch(request("/api/v2/capabilities"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.ok(response.headers.get("x-request-id"));
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("preview rejects mutation and unknown routes", async () => {
  const mutation = await handle(request("/api/v2/capabilities", { method: "POST" }));
  assert.equal(mutation.status, 405);
  assert.equal((await mutation.json()).code, "MIGRATION_REQUIRED");
  const missing = await handle(request("/unknown"));
  assert.equal(missing.status, 404);
});

test("HEAD emits no response body", async () => {
  const response = await handle(request("/health", { method: "HEAD" }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});
