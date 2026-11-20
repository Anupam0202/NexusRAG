import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";

// What the document page shows under "Ingestion status" comes from /api/v1/documents/{id}/status.
const workspace = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const user = "44444444-4444-4444-8444-444444444444";
const env = {
  SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-secret",
  QDRANT_URL: "https://qdrant.invalid", QDRANT_API_KEY: "synthetic-qdrant-secret", QDRANT_COLLECTION: "nexusrag-test",
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const TIMEOUT = "Gemini did not finish reading this document in time. Try again shortly.";

function backend(job) {
  return async (rawUrl) => {
    const url = new URL(String(rawUrl));
    if (url.pathname === "/auth/v1/user") return json({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return json([{ workspace_id: workspace, user_id: user, role: "editor" }]);
    if (url.pathname === "/rest/v1/documents") return json([{ id: documentId, workspace_id: workspace, filename: "cobalt-grove.webp", status: "ready", lifecycle_state: "active" }]);
    if (url.pathname === "/rest/v1/ingestion_jobs") return json([{ id: "33333333-3333-4333-8333-333333333333", document_id: documentId, created_at: "2026-11-20T16:55:00Z", updated_at: "2026-11-20T16:56:30Z", ...job }]);
    throw new Error(`unexpected request: ${url}`);
  };
}
const status = () => handle(new Request(`https://gateway.invalid/api/v1/documents/${documentId}/status`, {
  headers: { authorization: "Bearer synthetic-user-token", "x-nexus-workspace-id": workspace },
}), env);

test("a document that succeeded on a later attempt does not show the error of an earlier one", async (t) => {
  // The job row keeps the first attempt's error after the retry publishes the document (found live on the preview,
  // 20 November: a WebP image read on the second try showed "did not finish reading" in red on its ready page).
  t.mock.method(globalThis, "fetch", backend({ status: "completed", stage: "published", progress: 100, error_code: "GEMINI_TIMEOUT", error_message: TIMEOUT }));
  const done = await (await status()).json();
  assert.equal(done.status, "completed");
  assert.equal(done.error_message, null);
  assert.equal(done.message, "Ingestion completed");
});

test("a failed document, and one waiting to try again, still say why", async (t) => {
  t.mock.method(globalThis, "fetch", backend({ status: "failed", stage: "failed", progress: 40, error_code: "GEMINI_TIMEOUT", error_message: TIMEOUT }));
  const failed = await (await status()).json();
  assert.deepEqual([failed.status, failed.error_message, failed.message], ["failed", TIMEOUT, TIMEOUT]);

  t.mock.method(globalThis, "fetch", backend({ status: "retry_wait", stage: "retry_wait", progress: 40, error_code: "GEMINI_TIMEOUT", error_message: TIMEOUT }));
  const waiting = await (await status()).json();
  assert.deepEqual([waiting.status, waiting.error_message, waiting.message], ["queued", TIMEOUT, TIMEOUT]);

  // A new attempt that is running again shows its progress, not the last attempt's error.
  t.mock.method(globalThis, "fetch", backend({ status: "processing", stage: "extracting", progress: 20, error_code: "GEMINI_TIMEOUT", error_message: TIMEOUT }));
  const running = await (await status()).json();
  assert.deepEqual([running.status, running.error_message, running.message], ["processing", null, "Ingestion processing"]);
});
