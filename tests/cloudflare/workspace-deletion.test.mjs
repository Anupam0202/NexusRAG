import test from "node:test";
import assert from "node:assert/strict";
import { handle, scheduled } from "../../apps/gateway/src/preview-worker.js";
import { finishWorkspaceDeletion, removeWorkspaceIndexEntries, removeWorkspaceOriginals, sweepWorkspaceDeletions,
  workspaceDeletionReceipt } from "../../apps/gateway/src/workspace-deletion.js";

const workspace = "11111111-1111-4111-8111-111111111111";
const other = "44444444-4444-4444-8444-444444444444";
const user = "22222222-2222-4222-8222-222222222222";
const operation = "0e000000-0000-4000-8000-000000000001";
const env = {
  SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-secret",
  QDRANT_URL: "https://qdrant.invalid", QDRANT_API_KEY: "synthetic-qdrant-secret", QDRANT_COLLECTION: "nexusrag-test",
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const COLLECTION = "https://qdrant.invalid/collections/nexusrag-test";
const STORAGE = "https://supabase.invalid/storage/v1/object";
const filter = { must: [{ key: "workspace_id", match: { value: workspace } }] };

// A search index holding `points` entries of the workspace, which a delete removes (unless told to keep them).
function index({ points = 3, missing = false, keep = false, countFails = false } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    if (missing) return json({ status: { error: "Not found: Collection doesn't exist" } }, 404);
    if (String(url) === `${COLLECTION}/points/count`) return countFails ? json({}, 500) : json({ result: { count: points } });
    if (String(url) === `${COLLECTION}/points/delete?wait=true`) { if (!keep) points = 0; return json({ result: { status: "completed" } }); }
    throw new Error(`unexpected index request ${url}`);
  };
  return { fetch, calls };
}

test("the index entries of the workspace are counted, removed by the workspace filter, and checked gone", async () => {
  const qdrant = index({ points: 7 });
  assert.deepEqual(await removeWorkspaceIndexEntries(env, workspace, qdrant.fetch), { points_removed: 7 });
  assert.deepEqual(qdrant.calls.map((call) => call.url), [`${COLLECTION}/points/count`, `${COLLECTION}/points/delete?wait=true`, `${COLLECTION}/points/count`]);
  assert.deepEqual(qdrant.calls[1].body, { filter });
  assert.deepEqual(qdrant.calls[0].body, { exact: true, filter });
});

test("an empty or missing index needs no delete", async () => {
  const empty = index({ points: 0 });
  assert.deepEqual(await removeWorkspaceIndexEntries(env, workspace, empty.fetch), { points_removed: 0 });
  assert.equal(empty.calls.length, 1);
  const missing = index({ missing: true });
  assert.deepEqual(await removeWorkspaceIndexEntries(env, workspace, missing.fetch), { points_removed: 0 });
});

test("an index that keeps entries or cannot count them is not reported as cleaned", async () => {
  await assert.rejects(removeWorkspaceIndexEntries(env, workspace, index({ keep: true }).fetch), { code: "QDRANT_DELETE_UNVERIFIED" });
  await assert.rejects(removeWorkspaceIndexEntries(env, workspace, index({ countFails: true }).fetch), { code: "QDRANT_DELETE_UNVERIFIED" });
  await assert.rejects(removeWorkspaceIndexEntries({ ...env, QDRANT_URL: "" }, workspace, index().fetch), { code: "CONFIGURATION_ERROR" });
});

// File storage holding `files` (full keys); lists folders the way Supabase Storage does.
function storage(files, { deleteFails = false } = {}) {
  const held = new Set(files);
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, url: String(url), body });
    assert.equal(init.headers.apikey, "synthetic-service-secret");
    if (init.method === "DELETE" && String(url) === `${STORAGE}/documents`) {
      if (deleteFails) return json({ error: "boom" }, 500);
      const deleted = body.prefixes.filter((key) => held.delete(key));
      return json(deleted.map((name) => ({ name })));
    }
    if (init.method === "POST" && String(url) === `${STORAGE}/list/documents`) {
      const prefix = `${body.prefix}/`;
      const names = new Map();
      for (const key of held) if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const [head, ...tail] = rest.split("/");
        names.set(head, tail.length ? null : `id-${head}`);
      }
      return json([...names].map(([name, id]) => ({ name, id })));
    }
    throw new Error(`unexpected storage request ${init.method} ${url}`);
  };
  return { fetch, calls, held };
}

test("originals known to the database go in one batch, and an empty folder proves it", async () => {
  const keys = [`${workspace}/d1/v1/a.pdf`, `${workspace}/d2/v1/b.txt`];
  const files = storage([...keys, `${other}/d9/v1/kept.pdf`]);
  // A key from another workspace, even if the database named it, is never touched.
  assert.deepEqual(await removeWorkspaceOriginals(env, workspace, [...keys, `${other}/d9/v1/kept.pdf`], files.fetch), { objects_removed: 2 });
  assert.deepEqual([...files.held], [`${other}/d9/v1/kept.pdf`]);
  assert.deepEqual(files.calls.map((call) => `${call.method} ${call.url.replace(STORAGE, "")}`), ["DELETE /documents", "POST /list/documents"]);
  assert.deepEqual(files.calls[0].body, { prefixes: keys });
});

test("files the database never recorded are found under the workspace folder and removed too", async () => {
  const files = storage([`${workspace}/d1/v1/a.pdf`, `${workspace}/orphan/v9/left-behind.txt`]);
  await removeWorkspaceOriginals(env, workspace, [`${workspace}/d1/v1/a.pdf`], files.fetch);
  assert.equal(files.held.size, 0);
});

test("a folder too large for one request is cleaned in part and left for the cron", async () => {
  const many = Array.from({ length: 30 }, (_, i) => `${workspace}/d${i}/v/file.txt`);
  const files = storage(many);
  await assert.rejects(removeWorkspaceOriginals(env, workspace, [], files.fetch), { code: "STORAGE_DELETE_UNVERIFIED" });
  assert.ok(files.held.size < 30 && files.held.size > 0, "some files went, the rest wait");
  await assert.rejects(removeWorkspaceOriginals(env, workspace, [], storage([`${workspace}/a/v/x`], { deleteFails: true }).fetch), { code: "STORAGE_DELETE_FAILED" });
});

// The database half, as finishWorkspaceDeletion sees it.
function database({ begin = { state: "READY", originals: [`${workspace}/d1/v1/a.pdf`], targets: [
  { id: "t-index", kind: "workspace_index", attempts: 0 }, { id: "t-files", kind: "workspace_originals", attempts: 0 }] },
purge = { state: "VERIFIED", removed: { documents: 4, chunks: 40, chat_sessions: 2, members: 3 }, receipts: 3 } } = {}) {
  const calls = [];
  const db = async (_env, path, init = {}) => {
    calls.push({ path, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if (path === "rpc/nexus_begin_workspace_purge") return begin;
    if (path === "rpc/nexus_purge_workspace") return purge;
    return null;
  };
  return { db, calls };
}

test("a deletion removes index entries and originals, records a receipt for each, then the rows", async () => {
  const store = database();
  const removed = [];
  const outcome = await finishWorkspaceDeletion(env, { workspace, operationId: operation }, {
    db: store.db,
    removeIndexEntries: async (_env, w) => { removed.push(`index ${w}`); return { points_removed: 40 }; },
    removeOriginals: async (_env, w, keys) => { removed.push(`files ${w} ${keys.length}`); return { objects_removed: 1 }; },
  });
  assert.deepEqual(removed, [`index ${workspace}`, `files ${workspace} 1`]);
  assert.deepEqual(outcome, { state: "VERIFIED", receipts: 3,
    removed: { points_removed: 40, objects_removed: 1, documents: 4, chunks: 40, chat_sessions: 2, members: 3 } });
  const receipts = store.calls.filter((call) => call.path.startsWith("deletion_receipts"));
  assert.deepEqual(receipts.map((call) => call.body[0].provider), ["qdrant", "supabase_storage"]);
  assert.ok(receipts.every((call) => /^[0-9a-f]{64}$/.test(call.body[0].receipt_hash)));
  assert.equal(store.calls.at(-1).path, "rpc/nexus_purge_workspace", "rows go last");
  assert.deepEqual(workspaceDeletionReceipt(outcome, operation), { workspace_deleted: true, state: "DELETED", operation_id: operation,
    documents_deleted: 4, chat_sessions_deleted: 2, local_chunks_deleted: 40, qdrant_chunks_deleted: 40, receipts: 3, failures: [],
    message: "The workspace and everything in it were deleted." });
});

test("nothing is removed while a job may still be writing, and a failure leaves the deletion for the cron", async () => {
  const waiting = database({ begin: { state: "WAITING", reason: "JOB_RUNNING", retry_at: "2026-11-13T20:00:00Z" } });
  const never = async () => { throw new Error("must not run"); };
  assert.equal((await finishWorkspaceDeletion(env, { workspace, operationId: operation }, { db: waiting.db, removeIndexEntries: never, removeOriginals: never })).state, "WAITING");

  const failing = database();
  await assert.rejects(finishWorkspaceDeletion(env, { workspace, operationId: operation }, { db: failing.db,
    removeIndexEntries: async () => { throw Object.assign(new Error("down"), { code: "INDEX_NOT_ANSWERING" }); }, removeOriginals: never }),
  { code: "INDEX_NOT_ANSWERING" });
  assert.deepEqual(failing.calls.at(-1), { path: `deletion_operations?id=eq.${operation}&state=neq.verified`, method: "PATCH", body: { state: "blocked" } });
  assert.equal(failing.calls.some((call) => call.path === "rpc/nexus_purge_workspace"), false);
  assert.deepEqual(workspaceDeletionReceipt({ state: "WAITING" }, operation).state, "PENDING");
});

// The route, through the gateway, for a member with `role`.
function gateway(role, { qdrantDown = false } = {}) {
  const seen = [];
  const fetch = async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    seen.push({ method, path: url.pathname, body });
    if (url.pathname === "/auth/v1/user") return json({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return json([{ workspace_id: workspace, user_id: user, role }]);
    if (url.pathname === "/rest/v1/rpc/nexus_begin_workspace_deletion") return json({ state: "STARTED", operation_id: operation });
    if (url.pathname === "/rest/v1/rpc/nexus_begin_workspace_purge")
      return json({ state: "READY", originals: [], targets: [{ id: "t-index", kind: "workspace_index", attempts: 0 }, { id: "t-files", kind: "workspace_originals", attempts: 0 }] });
    if (url.pathname === "/rest/v1/rpc/nexus_purge_workspace") return json({ state: "VERIFIED", removed: { documents: 1, chunks: 2, chat_sessions: 0 }, receipts: 3 });
    if (url.pathname.startsWith("/rest/v1/deletion_")) return json(null);
    if (url.hostname === "qdrant.invalid") return qdrantDown ? json({}, 503) : json({ result: { count: 0 } });
    if (url.pathname === "/storage/v1/object/list/documents") return json([]);
    throw new Error(`unexpected request ${method} ${url}`);
  };
  return { fetch, seen };
}
const headers = { authorization: "Bearer synthetic-user-token", "x-nexus-workspace-id": workspace, "content-type": "application/json" };
const remove = (body = { confirmation: "DELETE WORKSPACE" }) =>
  handle(new Request("https://gateway.invalid/api/v1/workspaces/current/delete", { method: "POST", headers, body: JSON.stringify(body) }), env);

test("only the owner deletes the workspace, and only with the typed confirmation", async (t) => {
  for (const role of ["admin", "editor", "viewer"]) {
    const backend = gateway(role);
    t.mock.method(globalThis, "fetch", backend.fetch);
    const response = await remove();
    assert.equal(response.status, 403, role);
    assert.equal(backend.seen.some((call) => call.path.startsWith("/rest/v1/rpc/")), false);
  }
  const backend = gateway("owner");
  t.mock.method(globalThis, "fetch", backend.fetch);
  for (const body of [{}, { confirmation: "delete workspace" }, { confirmation: "DELETE" }]) assert.equal((await remove(body)).status, 422);
  assert.equal(backend.seen.some((call) => call.path.startsWith("/rest/v1/rpc/")), false);
});

test("the owner's deletion answers with what was removed, or that the erasure continues", async (t) => {
  t.mock.method(globalThis, "fetch", gateway("owner").fetch);
  const done = await remove();
  assert.equal(done.status, 200);
  const body = await done.json();
  assert.deepEqual([body.workspace_deleted, body.state, body.documents_deleted, body.local_chunks_deleted, body.failures], [true, "DELETED", 1, 2, []]);

  // The index does not answer: the workspace is already gone for everyone, and the cron finishes the erasure.
  const down = gateway("owner", { qdrantDown: true });
  t.mock.method(globalThis, "fetch", down.fetch);
  const pending = await remove();
  assert.equal(pending.status, 202);
  assert.equal((await pending.json()).state, "PENDING");
  assert.ok(down.seen.some((call) => call.method === "PATCH" && call.path === "/rest/v1/deletion_operations"));
  assert.equal(down.seen.some((call) => call.path === "/rest/v1/rpc/nexus_purge_workspace"), false);
});

test("the privacy page is told the workspace can be deleted", async (t) => {
  t.mock.method(globalThis, "fetch", async (rawUrl) => {
    const url = new URL(String(rawUrl));
    if (url.pathname === "/auth/v1/user") return json({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return json([{ workspace_id: workspace, user_id: user, role: "owner" }]);
    return json([]);
  });
  const body = await (await handle(new Request("https://gateway.invalid/api/v1/privacy/settings", { headers }), env)).json();
  assert.equal(body.workspace_deletion_supported, true);
});

test("the cron finishes unfinished workspace deletions and reports the ones still open", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    if (url.pathname === "/rest/v1/rpc/nexus_claim_workspace_purges") { asked.push(JSON.parse(init.body)); return json([]); }
    return json([]);
  });
  t.mock.method(console, "warn", () => {});
  const waited = [];
  scheduled({ scheduledTime: Date.UTC(2026, 10, 13, 9, 35) }, env, { waitUntil: (promise) => waited.push(Promise.resolve(promise).catch(() => undefined)) });
  await Promise.all(waited);
  assert.deepEqual(asked, [{ p_limit: 1 }]);

  const warned = [];
  t.mock.method(console, "warn", (line) => warned.push(JSON.parse(line)));
  const result = await sweepWorkspaceDeletions(env, {
    db: async (_env, path) => path === "rpc/nexus_claim_workspace_purges" ? [{ workspace_id: workspace, operation_id: operation }]
      : path === "rpc/nexus_begin_workspace_purge" ? { state: "WAITING", reason: "JOB_RUNNING" } : null,
  });
  assert.deepEqual(result, { state: "CHECKED", finished: 0, open: [{ operation_id: operation, state: "WAITING", reason: "JOB_RUNNING" }] });
  assert.equal(warned[0].event, "workspace_deletion_open");
});
