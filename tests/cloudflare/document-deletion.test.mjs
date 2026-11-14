import test from "node:test";
import assert from "node:assert/strict";
import { finishDocumentDeletion, sweepDeletions } from "../../apps/gateway/src/document-deletion.js";
import { handle, scheduled } from "../../apps/gateway/src/preview-worker.js";

const workspace = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const user = "44444444-4444-4444-8444-444444444444";
const ids = { workspace, documentId, operationId };
const env = {
  SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-secret",
  QDRANT_URL: "https://qdrant.invalid", QDRANT_API_KEY: "synthetic-qdrant-secret", QDRANT_COLLECTION: "nexusrag-test",
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const target = (kind, id, objectKey = null) => ({ id, kind, object_key: objectKey, attempts: 0 });
const TARGETS = [target("original", "a0000000-0000-4000-8000-000000000001", `${workspace}/${documentId}/v1/policy.pdf`), target("version_index", "a0000000-0000-4000-8000-000000000002")];

// The service-role database as the deletion sees it. `rpc` holds what each database function answers.
function database({ rpc = {}, targets = TARGETS } = {}) {
  const calls = [];
  const state = { targets: targets.map((item) => ({ ...item, verified_at: null })), receipts: [], operation: "cleaning" };
  const db = async (_env, path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, method: init.method || "GET", body, headers: init.headers || {} });
    if (path.startsWith("rpc/")) {
      const answer = rpc[path.slice(4)];
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? answer(body, state) : answer;
    }
    if (path.startsWith("deletion_targets?") && (init.method || "GET") === "GET") return state.targets.filter((item) => !item.verified_at);
    if (path.startsWith("deletion_targets?id=eq.")) { Object.assign(state.targets.find((item) => path.includes(item.id)), body); return []; }
    if (path.startsWith("deletion_receipts")) { state.receipts.push(...body); return null; }
    if (path.startsWith("deletion_operations?")) { state.operation = body.state; return []; }
    throw new Error(`unexpected database call: ${path}`);
  };
  return { db, calls, state };
}

// The quota ledger and the search index. `qdrant` decides what the index answers.
function providers(qdrant = (url) => url.endsWith("/points/count") ? json({ result: { count: 0 } }) : json({ status: "ok" })) {
  const calls = [];
  const fetch = async (rawUrl, init = {}) => {
    const url = String(rawUrl);
    if (url.endsWith("/rpc/v6_reserve_many")) return json({ state: "READY", reservations: [{ id: operationId, amount: 2 }] });
    if (url.endsWith("/rpc/v6_settle_many")) return json({ state: "SETTLED" });
    if (url.startsWith("https://qdrant.invalid/")) { calls.push({ url, body: JSON.parse(init.body) }); return qdrant(url, init); }
    throw new Error(`unexpected request: ${url}`);
  };
  return { fetch, calls };
}
const READY = { nexus_begin_document_purge: { state: "READY" } };
const purged = (removed = { chunks: 3, answers_with_passages_removed: 0 }) => (_body, state) => {
  assert.ok(state.targets.every((item) => item.verified_at), "the database is asked only after the provider targets are verified");
  return { state: "VERIFIED", removed };
};

test("a deletion removes the index entries, then the original, then the rows, each receipt after its check", async (t) => {
  const index = providers();
  t.mock.method(globalThis, "fetch", index.fetch);
  const store = database({ rpc: { ...READY, nexus_purge_document: purged() } });
  const removedOriginals = [];
  const outcome = await finishDocumentDeletion(env, ids, {
    db: store.db,
    removeOriginal: async (_env, key) => {
      assert.ok(store.state.targets.find((item) => item.kind === "version_index").verified_at, "the index is cleared before the original is removed");
      removedOriginals.push(key);
    },
  });
  assert.deepEqual(outcome, { state: "VERIFIED", removed: { chunks: 3, answers_with_passages_removed: 0 }, receipts: 5 });
  assert.deepEqual(store.calls.filter((call) => call.path.startsWith("rpc/")).map((call) => call.path), ["rpc/nexus_begin_document_purge", "rpc/nexus_purge_document"]);
  assert.deepEqual(store.calls[0].body, { p_workspace: workspace, p_document: documentId, p_operation: operationId });
  // The index is cleared by document inside this workspace, and the result is counted exactly.
  assert.deepEqual(index.calls.map((call) => new URL(call.url).pathname), ["/collections/nexusrag-test/points/delete", "/collections/nexusrag-test/points/count"]);
  for (const call of index.calls) assert.deepEqual(call.body.filter.must.slice(0, 2), [{ key: "workspace_id", match: { value: workspace } }, { key: "document_id", match: { value: documentId } }]);
  assert.equal(index.calls[1].body.exact, true);
  assert.deepEqual(removedOriginals, [`${workspace}/${documentId}/v1/policy.pdf`]);
  // The gateway vouches only for the two providers it checked itself.
  assert.deepEqual(store.state.receipts.map((item) => item.provider).sort(), ["qdrant", "supabase_storage"]);
  assert.ok(store.state.receipts.every((item) => /^[0-9a-f]{64}$/.test(item.receipt_hash) && item.workspace_id === workspace && item.operation_id === operationId));
  const receiptCall = store.calls.find((call) => call.path.startsWith("deletion_receipts"));
  assert.equal(receiptCall.path, "deletion_receipts?on_conflict=workspace_id,target_id,provider");
  assert.match(receiptCall.headers.prefer, /resolution=ignore-duplicates/);
});

test("nothing is removed while a processing step may still be writing", async (t) => {
  const index = providers();
  t.mock.method(globalThis, "fetch", index.fetch);
  const waiting = { state: "WAITING", reason: "JOB_RUNNING", retry_at: "2026-11-13T10:02:00.000Z" };
  const store = database({ rpc: { nexus_begin_document_purge: waiting } });
  const outcome = await finishDocumentDeletion(env, ids, { db: store.db, removeOriginal: async () => assert.fail("the original must stay") });
  assert.deepEqual(outcome, waiting);
  assert.equal(store.calls.length, 1);
  assert.equal(index.calls.length, 0);

  for (const answer of [{ state: "BLOCKED", reason: "RADAR_SNAPSHOT" }, { state: "VERIFIED" }, { state: "NOT_FOUND" }]) {
    const other = database({ rpc: { nexus_begin_document_purge: answer } });
    assert.deepEqual(await finishDocumentDeletion(env, ids, { db: other.db, removeOriginal: async () => assert.fail("must not run") }), answer);
    assert.equal(other.calls.length, 1);
  }
  const silent = database({ rpc: { nexus_begin_document_purge: null } });
  assert.deepEqual(await finishDocumentDeletion(env, ids, { db: silent.db, removeOriginal: async () => {} }), { state: "NOT_FOUND" });
});

test("a provider failure leaves the deletion open, without receipts for what was not verified", async (t) => {
  t.mock.method(globalThis, "fetch", providers(() => new Response("no healthy upstream", { status: 503 })).fetch);
  const store = database({ rpc: { ...READY, nexus_purge_document: () => assert.fail("rows must stay while the index is not cleared") } });
  await assert.rejects(finishDocumentDeletion(env, ids, { db: store.db, removeOriginal: async () => assert.fail("the original must stay") }),
    (error) => error.code === "QDRANT_DELETE_FAILED" && error.retryable === true);
  assert.equal(store.state.receipts.length, 0);
  assert.equal(store.state.operation, "blocked");
  assert.equal(store.calls.at(-1).path, `deletion_operations?id=eq.${operationId}&state=neq.verified`);

  // Entries that remain after the delete are not accepted as gone either.
  t.mock.method(globalThis, "fetch", providers((url) => url.endsWith("/points/count") ? json({ result: { count: 2 } }) : json({ status: "ok" })).fetch);
  const remaining = database({ rpc: { ...READY, nexus_purge_document: () => assert.fail("rows must stay") } });
  await assert.rejects(finishDocumentDeletion(env, ids, { db: remaining.db, removeOriginal: async () => {} }), (error) => error.code === "QDRANT_DELETE_UNVERIFIED");
  assert.equal(remaining.state.receipts.length, 0);
});

test("a retry continues where the last attempt stopped", async (t) => {
  t.mock.method(globalThis, "fetch", providers().fetch);
  const store = database({ rpc: { ...READY, nexus_purge_document: purged() } });
  let storageUp = false;
  const tools = { db: store.db, removeOriginal: async () => { if (!storageUp) throw Object.assign(new Error("Private original deletion failed."), { code: "STORAGE_DELETE_FAILED", status: 503, retryable: true }); } };
  await assert.rejects(finishDocumentDeletion(env, ids, tools), (error) => error.code === "STORAGE_DELETE_FAILED");
  assert.deepEqual(store.state.receipts.map((item) => item.provider), ["qdrant"], "the index receipt stands; the original has none");
  assert.equal(store.state.operation, "blocked");
  assert.equal(store.calls.some((call) => call.path === "rpc/nexus_purge_document"), false);

  storageUp = true;
  const outcome = await finishDocumentDeletion(env, ids, tools);
  assert.equal(outcome.state, "VERIFIED");
  assert.deepEqual(store.state.receipts.map((item) => item.provider), ["qdrant", "supabase_storage"]);

  // The count of receipts is the database's: every receipt on record, whichever attempt wrote it.
  const counted = database({ rpc: { ...READY, nexus_purge_document: { state: "VERIFIED", removed: {}, receipts: 5 } }, targets: [] });
  assert.equal((await finishDocumentDeletion(env, ids, { db: counted.db, removeOriginal: async () => {} })).receipts, 5);
});

test("a database that does not confirm the purge is not reported as a finished deletion", async (t) => {
  t.mock.method(globalThis, "fetch", providers().fetch);
  const refused = database({ rpc: { ...READY, nexus_purge_document: { state: "WAITING", reason: "JOB_RUNNING", retry_at: "2026-11-13T10:02:00.000Z" } } });
  assert.equal((await finishDocumentDeletion(env, ids, { db: refused.db, removeOriginal: async () => {} })).state, "WAITING");
  const silent = database({ rpc: { ...READY, nexus_purge_document: null } });
  assert.deepEqual(await finishDocumentDeletion(env, ids, { db: silent.db, removeOriginal: async () => {} }), { state: "BLOCKED", reason: "PURGE_UNCONFIRMED" });
  const failing = database({ rpc: { ...READY, nexus_purge_document: Object.assign(new Error("Authoritative storage rejected the request."), { code: "PERSISTENCE_UNAVAILABLE", status: 503 }) } });
  await assert.rejects(finishDocumentDeletion(env, ids, { db: failing.db, removeOriginal: async () => {} }), (error) => error.code === "PERSISTENCE_UNAVAILABLE");
  assert.equal(failing.state.operation, "blocked");
});

test("the cron finishes what it is handed, reports what stays open and never throws", async (t) => {
  t.mock.method(globalThis, "fetch", providers().fetch);
  const warnings = [];
  t.mock.method(console, "warn", (line) => warnings.push(JSON.parse(line)));
  const second = "55555555-5555-4555-8555-555555555555";
  const third = "66666666-6666-4666-8666-666666666666";
  const claim = [operationId, second, third].map((operation) => ({ workspace_id: workspace, document_id: documentId, operation_id: operation }));
  const store = database({
    targets: [],
    rpc: {
      nexus_claim_document_purges: (body) => { assert.deepEqual(body, { p_limit: 2 }); return claim; },
      nexus_begin_document_purge: (body) => {
        if (body.p_operation === second) return { state: "WAITING", reason: "JOB_RUNNING", retry_at: "2026-11-13T10:02:00.000Z" };
        if (body.p_operation === third) throw Object.assign(new Error("Authoritative storage rejected the request."), { code: "PERSISTENCE_UNAVAILABLE" });
        return { state: "READY" };
      },
      nexus_purge_document: () => ({ state: "VERIFIED", removed: {} }),
    },
  });
  const tools = { db: store.db, removeOriginal: async () => {} };
  assert.deepEqual(await sweepDeletions(env, tools), { state: "CHECKED", finished: 1, open: [
    { operation_id: second, state: "WAITING", reason: "JOB_RUNNING" },
    { operation_id: third, state: "FAILED", reason: "PERSISTENCE_UNAVAILABLE" },
  ] });
  assert.deepEqual(warnings, [{ event: "document_deletion_open", open: [
    { operation_id: second, state: "WAITING", reason: "JOB_RUNNING" },
    { operation_id: third, state: "FAILED", reason: "PERSISTENCE_UNAVAILABLE" },
  ] }]);

  // A database that does not have the functions yet (before its migration) is not an error for the cron.
  const old = database({ rpc: { nexus_claim_document_purges: Object.assign(new Error("Record not found."), { code: "NOT_FOUND" }) } });
  assert.deepEqual(await sweepDeletions(env, { db: old.db, removeOriginal: async () => {} }), { state: "UNAVAILABLE", finished: 0, open: [] });
  const none = database({ rpc: { nexus_claim_document_purges: [] } });
  assert.deepEqual(await sweepDeletions(env, { db: none.db, removeOriginal: async () => {} }), { state: "CHECKED", finished: 0, open: [] });
  assert.equal(warnings.length, 1, "nothing open is not news");
});

// The whole route, with the database and the providers behind it.
function gatewayBackend({ document = { id: documentId, workspace_id: workspace, filename: "policy.pdf", lifecycle_state: "active" }, tombstone, begin = { state: "READY" },
  purge = { state: "VERIFIED", receipts: 5, removed: { chunks: 3, versions: 1, answers_with_passages_removed: 2, kept: { findings: 0, research_runs: 0 } } }, qdrant } = {}) {
  const seen = [];
  const index = providers(qdrant);
  const fetch = async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    seen.push(`${init.method || "GET"} ${url.pathname}`);
    if (url.pathname === "/auth/v1/user") return json({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return json([{ workspace_id: workspace, user_id: user, role: "editor" }]);
    if (url.pathname === "/rest/v1/documents") return json(document ? [document] : []);
    if (url.pathname === "/rest/v1/rpc/tombstone_document") return tombstone ? tombstone() : json(operationId);
    if (url.pathname === "/rest/v1/deletion_operations") return json([{ id: operationId }]);
    if (url.pathname === "/rest/v1/rpc/nexus_begin_document_purge") return json(begin);
    if (url.pathname === "/rest/v1/deletion_targets") return json((init.method || "GET") === "GET" ? TARGETS.filter((item) => item.kind === "version_index") : []);
    if (url.pathname === "/rest/v1/deletion_receipts") return new Response(null, { status: 201 });
    if (url.pathname === "/rest/v1/rpc/nexus_purge_document") return json(purge);
    if (url.pathname === "/rest/v1/audit_events") return json([]);
    return index.fetch(rawUrl, init);
  };
  return { fetch, seen };
}
const remove = () => handle(new Request(`https://gateway.invalid/api/v1/documents/${documentId}/delete`, {
  method: "POST", headers: { authorization: "Bearer synthetic-user-token", "x-nexus-workspace-id": workspace },
}), env);

test("deleting a document answers with what happened, in words a person can act on", async (t) => {
  const done = gatewayBackend();
  t.mock.method(globalThis, "fetch", done.fetch);
  const deleted = await remove();
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), {
    success: true, state: "DELETED", operation_id: operationId, receipts: 5,
    removed: { chunks: 3, versions: 1, answers_with_passages_removed: 2, kept: { findings: 0, research_runs: 0 } },
    message: "policy.pdf was deleted. The passages it supplied to 2 earlier answers were removed as well.",
  });
  assert.ok(done.seen.includes("POST /rest/v1/audit_events"));

  // Saved findings are the person's own work; the answer says they are still there.
  t.mock.method(globalThis, "fetch", gatewayBackend({ purge: { state: "VERIFIED", receipts: 5, removed: { chunks: 1, kept: { findings: 2, research_runs: 1 } } } }).fetch);
  assert.equal((await (await remove()).json()).message,
    "policy.pdf was deleted. 2 saved findings that used it are kept as they are; delete them separately if they should go too.");
  t.mock.method(globalThis, "fetch", gatewayBackend({ purge: { state: "VERIFIED", receipts: 5, removed: { kept: { findings: 1 } } } }).fetch);
  assert.equal((await (await remove()).json()).message,
    "policy.pdf was deleted. 1 saved finding that used it is kept as it is; delete it separately if it should go too.");

  // A step is still processing the document: it is hidden now and the rest follows.
  t.mock.method(globalThis, "fetch", gatewayBackend({ begin: { state: "WAITING", reason: "JOB_RUNNING", retry_at: "2026-11-13T10:02:00.000Z" } }).fetch);
  const waiting = await remove();
  assert.equal(waiting.status, 202);
  const pending = await waiting.json();
  assert.deepEqual([pending.success, pending.state, pending.reason, pending.retry_at], [true, "PENDING", "JOB_RUNNING", "2026-11-13T10:02:00.000Z"]);
  assert.match(pending.message, /^policy\.pdf is no longer available\. Its stored copies are still being erased/);

  // The search index does not answer: the same, and the reason is on record for the operator.
  t.mock.method(globalThis, "fetch", gatewayBackend({ qdrant: () => { throw new TypeError("fetch failed"); } }).fetch);
  const unreachable = await remove();
  assert.equal(unreachable.status, 202);
  assert.deepEqual([(await unreachable.clone().json()).state, (await unreachable.json()).reason], ["PENDING", "INDEX_NOT_ANSWERING"]);
});

test("a document that cannot be deleted says why, and nothing is marked", async (t) => {
  const radar = gatewayBackend({ tombstone: () => json({ code: "P0001", message: "NR:DOCUMENT_IN_USE" }, 400) });
  t.mock.method(globalThis, "fetch", radar.fetch);
  const refused = await remove();
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.equal(body.error.code, "DOCUMENT_IN_USE");
  assert.match(body.error.message, /Radar snapshot/);
  assert.equal(radar.seen.some((call) => call.includes("nexus_begin_document_purge") || call.includes("audit_events")), false);

  // A deletion begun before Radar pages were refused reports the same reason.
  t.mock.method(globalThis, "fetch", gatewayBackend({ document: { id: documentId, workspace_id: workspace, filename: "page.txt", lifecycle_state: "deleting" }, begin: { state: "BLOCKED", reason: "RADAR_SNAPSHOT" } }).fetch);
  assert.equal((await (await remove()).json()).error.code, "DOCUMENT_IN_USE");

  t.mock.method(globalThis, "fetch", gatewayBackend({ tombstone: () => json({ code: "40001", message: "Document unavailable or deletion already begun" }, 409) }).fetch);
  const conflict = await remove();
  assert.deepEqual([conflict.status, (await conflict.json()).error.code], [409, "DELETE_CONFLICT"]);

  t.mock.method(globalThis, "fetch", gatewayBackend({ document: null }).fetch);
  assert.equal((await remove()).status, 404);
  t.mock.method(globalThis, "fetch", gatewayBackend({ begin: { state: "NOT_FOUND" } }).fetch);
  assert.equal((await remove()).status, 404);
});

test("every cron run asks for unfinished deletions", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    if (url.pathname === "/rest/v1/rpc/nexus_claim_document_purges") { asked.push(JSON.parse(init.body)); return json([]); }
    return json([]);
  });
  t.mock.method(console, "warn", () => {});
  for (const scheduledTime of [Date.UTC(2026, 10, 13, 0, 0), Date.UTC(2026, 10, 13, 9, 35)]) {
    const waited = [];
    scheduled({ scheduledTime }, { ...env, QDRANT_URL: "", QDRANT_API_KEY: "" }, { waitUntil: (promise) => waited.push(Promise.resolve(promise).catch(() => undefined)) });
    await Promise.all(waited);
  }
  assert.deepEqual(asked, [{ p_limit: 2 }, { p_limit: 2 }]);
});
