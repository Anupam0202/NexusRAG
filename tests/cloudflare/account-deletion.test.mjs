import test from "node:test";
import assert from "node:assert/strict";
import { handle, scheduled } from "../../apps/gateway/src/preview-worker.js";
import { deleteAccount, finishAccountDeletion, removeSignIn, sweepAccountDeletions } from "../../apps/gateway/src/account-deletion.js";

const user = "22222222-2222-4222-8222-222222222222";
const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-secret" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("the sign-in is removed through Supabase Auth's admin API, and an account already gone counts as removed", async () => {
  const calls = [];
  const auth = (status) => async (url, init) => { calls.push({ url: String(url), method: init.method, headers: init.headers }); return new Response(null, { status }); };
  await removeSignIn(env, user, auth(200));
  assert.deepEqual(calls[0], { url: `https://supabase.invalid/auth/v1/admin/users/${user}`, method: "DELETE",
    headers: { apikey: "synthetic-service-secret", authorization: "Bearer synthetic-service-secret" } });
  await removeSignIn(env, user, auth(404));
  await assert.rejects(removeSignIn(env, user, auth(500)), { code: "AUTH_DELETE_FAILED" });
  await assert.rejects(removeSignIn(env, user, async () => { throw new TypeError("network"); }), { code: "AUTH_DELETE_FAILED" });
});

// The database and Supabase Auth as the account deletion sees them.
function services({ status = { state: "READY" }, owned = 1, purge = { state: "VERIFIED", removed: {}, receipts: 3 } } = {}) {
  const calls = [];
  const db = async (_env, path, init = {}) => {
    calls.push(path.split("?")[0]);
    if (path === "rpc/nexus_begin_account_deletion")
      return { state: "STARTED", removed: { messages: 4 }, workspaces: Array.from({ length: owned }, (_, i) => ({ workspace_id: `w${i}`, operation_id: `op${i}` })) };
    if (path === "rpc/nexus_begin_workspace_purge") return { state: "READY", originals: [], targets: [{ id: "t", kind: "workspace_index", attempts: 0 }] };
    if (path === "rpc/nexus_purge_workspace") return purge;
    if (path === "rpc/nexus_account_deletion_status") return typeof status === "function" ? status() : status;
    if (path === "rpc/nexus_finish_account_deletion") return { state: "VERIFIED" };
    return null;
  };
  const removed = [];
  return {
    calls, removed,
    tools: { db, removeIndexEntries: async () => ({ points_removed: 0 }), removeOriginals: async () => ({ objects_removed: 0 }),
      removeSignIn: async (_env, id) => { removed.push(id); } },
  };
}

test("an account whose workspaces are erased in the request is deleted at once", async () => {
  const backend = services();
  const receipt = await deleteAccount(env, user, backend.tools);
  assert.deepEqual(receipt, { account_deleted: true, state: "DELETED", workspaces_deleted: 1, removed: { messages: 4 },
    message: "Your account and everything it owned were deleted." });
  assert.deepEqual(backend.removed, [user]);
  // The sign-in goes last, after the workspace's rows.
  assert.ok(backend.calls.indexOf("rpc/nexus_purge_workspace") < backend.calls.indexOf("rpc/nexus_account_deletion_status"));
  assert.equal(backend.calls.at(-1), "rpc/nexus_finish_account_deletion");
});

test("while owned workspaces are still being erased, the sign-in stays and the cron goes on", async () => {
  const backend = services({ status: { state: "WAITING", workspaces_remaining: 2 }, owned: 3 });
  const receipt = await deleteAccount(env, user, backend.tools);
  assert.equal(receipt.state, "PENDING");
  assert.match(receipt.message, /can no longer be used/);
  assert.deepEqual(backend.removed, []);
  // Two workspaces are erased in the request; the third is left to the cron.
  assert.equal(backend.calls.filter((path) => path === "rpc/nexus_begin_workspace_purge").length, 2);
  // A workspace that fails to erase does not fail the request.
  const failing = services({ status: { state: "WAITING" } });
  failing.tools.removeIndexEntries = async () => { throw Object.assign(new Error("down"), { code: "INDEX_NOT_ANSWERING" }); };
  assert.equal((await deleteAccount(env, user, failing.tools)).state, "PENDING");
});

test("finishing removes nothing until nothing owned is left, and is done once done", async () => {
  const waiting = services({ status: { state: "WAITING" } });
  assert.deepEqual(await finishAccountDeletion(env, user, waiting.tools), { state: "PENDING", reason: "WORKSPACES_BEING_ERASED" });
  assert.deepEqual(waiting.removed, []);
  const done = services({ status: { state: "VERIFIED" } });
  assert.deepEqual(await finishAccountDeletion(env, user, done.tools), { state: "DELETED" });
  assert.deepEqual(done.removed, []);
});

test("the cron finishes waiting deletions without writing account ids to the log", async (t) => {
  const warned = [];
  t.mock.method(console, "warn", (line) => warned.push(line));
  const backend = services({ status: { state: "WAITING" } });
  const db = backend.tools.db;
  backend.tools.db = async (e, path, init) => path === "rpc/nexus_claim_account_deletions" ? [user] : db(e, path, init);
  assert.deepEqual(await sweepAccountDeletions(env, backend.tools), { state: "CHECKED", finished: 0, open: [{ state: "PENDING", reason: "WORKSPACES_BEING_ERASED" }] });
  assert.equal(warned.length, 1);
  assert.equal(warned[0].includes(user), false);
});

// The route, through the gateway.
function gateway({ status = { state: "READY" } } = {}) {
  const seen = [];
  const fetch = async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    const method = init.method || "GET";
    seen.push({ method, path: url.pathname });
    if (url.pathname === "/auth/v1/user") return json({ id: user });
    if (url.pathname === `/auth/v1/admin/users/${user}` && method === "DELETE") return json({});
    if (url.pathname === "/rest/v1/rpc/nexus_begin_account_deletion") return json({ state: "STARTED", workspaces: [], removed: {} });
    if (url.pathname === "/rest/v1/rpc/nexus_account_deletion_status") return json(status);
    if (url.pathname === "/rest/v1/rpc/nexus_finish_account_deletion") return json({ state: "VERIFIED" });
    throw new Error(`unexpected request ${method} ${url.pathname}`);
  };
  return { fetch, seen };
}
const headers = { authorization: "Bearer synthetic-user-token", "content-type": "application/json" };
const remove = (body) => handle(new Request("https://gateway.invalid/api/v1/account/delete", { method: "POST", headers, body: JSON.stringify(body) }), env);

test("an account is deleted only with the typed confirmation", async (t) => {
  const backend = gateway();
  t.mock.method(globalThis, "fetch", backend.fetch);
  for (const body of [{}, { confirmation: "delete my account" }, { confirmation: "DELETE WORKSPACE" }]) assert.equal((await remove(body)).status, 422);
  assert.equal(backend.seen.some((call) => call.path.startsWith("/rest/v1/rpc/")), false);
  const done = await remove({ confirmation: "DELETE MY ACCOUNT" });
  assert.equal(done.status, 200);
  assert.equal((await done.json()).state, "DELETED");
  assert.ok(backend.seen.some((call) => call.method === "DELETE" && call.path === `/auth/v1/admin/users/${user}`));

  t.mock.method(globalThis, "fetch", gateway({ status: { state: "WAITING" } }).fetch);
  const pending = await remove({ confirmation: "DELETE MY ACCOUNT" });
  assert.equal(pending.status, 202);
  assert.equal((await pending.json()).state, "PENDING");
});

test("every cron run asks whether an account deletion is waiting", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    if (url.pathname === "/rest/v1/rpc/nexus_claim_account_deletions") asked.push(JSON.parse(init.body));
    return json([]);
  });
  t.mock.method(console, "warn", () => {});
  const waited = [];
  scheduled({ scheduledTime: Date.UTC(2026, 10, 13, 9, 35) }, { ...env, QDRANT_URL: "", QDRANT_API_KEY: "" },
    { waitUntil: (promise) => waited.push(Promise.resolve(promise).catch(() => undefined)) });
  await Promise.all(waited);
  assert.deepEqual(asked, [{ p_limit: 1 }]);
});
