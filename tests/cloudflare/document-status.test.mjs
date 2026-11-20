import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";

const workspace = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-secret" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const row = (id, patch = {}) => ({ id, workspace_id: workspace, filename: `${id.slice(0, 4)}.pdf`, status: "ready", lifecycle_state: "active",
  active_version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", chunk_count: 3, ...patch });
const headers = { authorization: "Bearer synthetic-user-token", "x-nexus-workspace-id": workspace };

// The database behind the gateway; `documents` answers document reads.
function backend(documents) {
  const seen = [];
  const fetch = async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    seen.push({ method: init.method || "GET", path: url.pathname, query: url.search });
    if (url.pathname === "/auth/v1/user") return json({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return json([{ workspace_id: workspace, user_id: user, role: "editor" }]);
    if (url.pathname === "/rest/v1/documents" && (init.method || "GET") === "GET") return json(documents(url));
    if (url.pathname === "/rest/v1/rpc/nexus_processing_gate") return json({ state: "RIGHTS_BLOCKED", reason: "WORKSPACE_APPROVAL_REQUIRED" });
    throw new Error(`unexpected request: ${init.method || "GET"} ${url.pathname}`);
  };
  return { fetch, seen };
}

test("a document is listed as ready only when it can be answered from", async (t) => {
  const rows = [
    row("10000000-0000-4000-8000-000000000001"),
    row("10000000-0000-4000-8000-000000000002", { status: "queued", active_version_id: null }),
    row("10000000-0000-4000-8000-000000000003", { status: "processing", active_version_id: null }),
    row("10000000-0000-4000-8000-000000000004", { status: "failed", active_version_id: null }),
    // From before versions existed: chunks, but nothing the gateway can search.
    row("10000000-0000-4000-8000-000000000005", { active_version_id: null }),
  ];
  t.mock.method(globalThis, "fetch", backend(() => rows).fetch);
  const body = await (await handle(new Request("https://gateway.invalid/api/v1/documents", { headers }), env)).json();
  assert.deepEqual(body.documents.map((item) => item.status), ["ready", "pending", "processing", "error", "needs_upload"]);
});

// What an upload of a file the workspace already holds does, by the state of the earlier copy.
const upload = () => {
  const form = new FormData();
  form.set("file", new File(["The same file as before."], "policy.txt", { type: "text/plain" }));
  form.set("data_classification", "non_sensitive");
  form.set("non_sensitive_attested", "true");
  return handle(new Request("https://gateway.invalid/api/v1/documents/upload", { method: "POST", headers: { ...headers, "idempotency-key": "40000000-0000-4000-8000-000000000001" }, body: form }), env);
};

test("uploading a file the workspace already has returns the earlier copy when it is usable", async (t) => {
  for (const earlier of [row("20000000-0000-4000-8000-000000000001"), row("20000000-0000-4000-8000-000000000002", { status: "processing", active_version_id: null }),
    // Uploaded by another member of the workspace: still the same document, which this person can see.
    row("20000000-0000-4000-8000-000000000003", { uploaded_by: "33333333-3333-4333-8333-333333333333" })]) {
    const db = backend((url) => {
      // One document per file per workspace: the check covers every uploader and every stage of deletion.
      assert.equal(url.searchParams.get("workspace_id"), `eq.${workspace}`);
      assert.equal(url.searchParams.get("status"), "neq.deleted");
      assert.equal(url.searchParams.has("uploaded_by"), false);
      assert.equal(url.searchParams.has("lifecycle_state"), false);
      return [earlier];
    });
    t.mock.method(globalThis, "fetch", db.fetch);
    const response = await upload();
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.deepEqual([body.success, body.duplicate, body.document.document_id], [true, true, earlier.id]);
    assert.ok(db.seen.every((call) => !call.path.startsWith("/storage") && !call.path.includes("nexus_admit_account_operation")), "nothing stored, nothing counted");
  }
});

test("uploading a file whose earlier copy cannot be used says what to do, before storing or counting anything", async (t) => {
  for (const [earlier, code, message] of [
    [row("30000000-0000-4000-8000-000000000001", { status: "failed", active_version_id: null }), "DUPLICATE_FAILED", /processing failed\. Retry it from its page in Documents, or delete it and upload it again\./],
    [row("30000000-0000-4000-8000-000000000002", { active_version_id: null }), "DUPLICATE_NEEDS_UPLOAD", /cannot be searched\. Delete it, then upload the file again\./],
    [row("30000000-0000-4000-8000-000000000003", { lifecycle_state: "deleting" }), "DOCUMENT_BEING_ERASED", /still being erased\. Try again in a few minutes\./],
  ]) {
    const db = backend(() => [earlier]);
    t.mock.method(globalThis, "fetch", db.fetch);
    const response = await upload();
    const body = await response.json();
    assert.equal(response.status, 409, code);
    assert.equal(body.error.code, code);
    assert.match(body.error.message, message);
    assert.ok(db.seen.every((call) => !call.path.startsWith("/storage") && !call.path.startsWith("/rest/v1/rpc/")), `${code}: nothing stored, nothing counted`);
  }
});

test("a new file goes on to the processing checks", async (t) => {
  const db = backend(() => []);
  t.mock.method(globalThis, "fetch", db.fetch);
  const response = await upload();
  assert.equal((await response.json()).error.code, "WORKSPACE_APPROVAL_REQUIRED");
  assert.ok(db.seen.some((call) => call.path === "/rest/v1/rpc/nexus_processing_gate"));
});
