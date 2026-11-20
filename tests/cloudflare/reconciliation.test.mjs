import test from "node:test";
import assert from "node:assert/strict";
import { reconcileStores } from "../../apps/gateway/src/reconciliation.js";
import { resetIndexProbeMemory } from "../../apps/gateway/src/search-index.js";
import { scheduled } from "../../apps/gateway/src/preview-worker.js";

const env = { QDRANT_URL: "https://qdrant.invalid/", QDRANT_API_KEY: "synthetic-qdrant-secret", QDRANT_COLLECTION: "nexusrag-test",
  SUPABASE_URL: "https://supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-secret" };
const FACET_URL = "https://qdrant.invalid/collections/nexusrag-test/facet";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const ready = { state: "READY", points: 12 };
const versionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", versionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const storageReport = (files = 0, bytes = 0, missing = 0) => ({ format: "nexusrag-storage-reconciliation/1",
  unreferenced_objects: { count: files, bytes, objects: [] }, missing_originals: { count: missing, rows: [] } });
const indexReport = (versions = 0, entries = 0, unindexed = 0) => ({ format: "nexusrag-index-reconciliation/1",
  orphaned_entries: { versions, entries, version_ids: [] }, unindexed_versions: unindexed === null ? null : { count: unindexed, rows: [] } });

// The database's two reports and the index's list of versions, with every request kept.
function stores({ storage = storageReport(), index = indexReport(), hits = [{ value: versionA, count: 3 }], facetStatus = 200 } = {}) {
  const calls = { db: [], index: [] };
  const db = async (_env, path, init) => {
    calls.db.push({ path, body: JSON.parse(init.body) });
    const answer = path === "rpc/nexus_storage_reconciliation" ? storage : index;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const fetchImpl = async (url, init) => {
    calls.index.push({ url: String(url), method: init.method, body: JSON.parse(init.body), key: init.headers["api-key"] });
    return facetStatus === 200 ? json({ result: { hits }, status: "ok" }) : json({ status: { error: "synthetic refusal naming secret-file.pdf" } }, facetStatus);
  };
  return { db, fetchImpl, calls };
}
function logs(t) {
  const lines = { log: [], warn: [] };
  t.mock.method(console, "log", (line) => lines.log.push(line));
  t.mock.method(console, "warn", (line) => lines.warn.push(line));
  return lines;
}

test("stores in step with the database are logged as an ordinary line of counts", async (t) => {
  const lines = logs(t), world = stores();
  const report = await reconcileStores(env, { db: world.db, probe: ready, fetchImpl: world.fetchImpl });
  assert.deepEqual(report, { event: "store_reconciliation", storage: "CHECKED", unreferenced_files: 0, unreferenced_bytes: 0,
    missing_originals: 0, index: "CHECKED", orphaned_versions: 0, orphaned_entries: 0, unindexed_documents: 0 });
  assert.deepEqual(lines, { log: [JSON.stringify(report)], warn: [] });
  // The database is asked for counts only, and compares the versions the index holds.
  assert.deepEqual(world.calls.db, [
    { path: "rpc/nexus_storage_reconciliation", body: { p_limit: 0 } },
    { path: "rpc/nexus_index_reconciliation", body: { p_indexed: [{ value: versionA, count: 3 }], p_complete: true, p_limit: 0 } },
  ]);
  assert.deepEqual(world.calls.index, [{ url: FACET_URL, method: "POST", body: { key: "version_id", limit: 1000, exact: false }, key: "synthetic-qdrant-secret" }]);
});

test("anything out of step is a warning that carries counts and nothing else", async (t) => {
  for (const [storage, index, expected] of [
    [storageReport(2, 4096, 0), indexReport(), { unreferenced_files: 2, unreferenced_bytes: 4096 }],
    [storageReport(0, 0, 1), indexReport(), { missing_originals: 1 }],
    [storageReport(), indexReport(3, 40, 0), { orphaned_versions: 3, orphaned_entries: 40 }],
    [storageReport(), indexReport(0, 0, 5), { unindexed_documents: 5 }],
  ]) {
    const lines = logs(t), world = stores({ storage, index });
    const report = await reconcileStores(env, { db: world.db, probe: ready, fetchImpl: world.fetchImpl });
    assert.deepEqual(lines.log, [], JSON.stringify(expected));
    assert.equal(lines.warn.length, 1);
    assert.deepEqual(JSON.parse(lines.warn[0]), report);
    for (const [name, count] of Object.entries(expected)) assert.equal(report[name], count, name);
    assert.doesNotMatch(lines.warn[0], /synthetic|secret|aaaaaaaa|\.pdf/);
    t.mock.restoreAll();
  }
});

test("an index that was reset is compared as an empty one, without asking it again", async (t) => {
  logs(t);
  const world = stores({ index: indexReport(0, 0, 4) });
  const report = await reconcileStores(env, { db: world.db, probe: { state: "EMPTY" }, fetchImpl: world.fetchImpl });
  assert.deepEqual(world.calls.index, []);
  assert.deepEqual(world.calls.db[1].body, { p_indexed: [], p_complete: true, p_limit: 0 });
  assert.deepEqual([report.index, report.unindexed_documents], ["CHECKED", 4]);
});

test("a list that may not be the whole index says nothing about what is missing from it", async (t) => {
  const lines = logs(t);
  const hits = Array.from({ length: 1000 }, (_, n) => ({ value: `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`, count: 1 }));
  const world = stores({ hits, index: indexReport(2, 2, null) });
  const report = await reconcileStores(env, { db: world.db, probe: ready, fetchImpl: world.fetchImpl });
  assert.equal(world.calls.db[1].body.p_complete, false);
  assert.equal(world.calls.db[1].body.p_indexed.length, 1000);
  assert.deepEqual([report.index, report.orphaned_versions, report.unindexed_documents], ["PARTLY_CHECKED", 2, null]);
  assert.equal(lines.warn.length, 1, "its leftovers are still reported");
});

test("only what the index really lists is passed on", async (t) => {
  logs(t);
  const world = stores({ hits: [{ value: versionA, count: 3 }, { value: 7, count: 1 }, null, { count: 2 }, { value: versionB, count: -1 }, { value: "legacy" }] });
  await reconcileStores(env, { db: world.db, probe: ready, fetchImpl: world.fetchImpl });
  assert.deepEqual(world.calls.db[1].body.p_indexed, [{ value: versionA, count: 3 }, { value: versionB, count: 0 }, { value: "legacy", count: 0 }]);
});

test("a store that cannot be asked is named, the other is still reported, and nothing is thrown", async (t) => {
  let lines = logs(t);
  // The index cannot count by field (too old, or the field is not indexed): storage is still checked.
  let world = stores({ facetStatus: 400, storage: storageReport(1, 10, 0) });
  let report = await reconcileStores(env, { db: world.db, probe: ready, fetchImpl: world.fetchImpl });
  assert.deepEqual([report.storage, report.unreferenced_files, report.index, report.orphaned_versions], ["CHECKED", 1, "NOT_COUNTABLE", null]);
  assert.equal(world.calls.db.length, 1, "the database is not asked to compare a list that does not exist");
  assert.doesNotMatch(lines.warn.join(""), /secret-file|refusal/);
  t.mock.restoreAll();

  // The index did not answer the keep-alive, is not configured, or the keep-alive itself failed.
  for (const [probe, state] of [[{ state: "NOT_ANSWERING" }, "NOT_ANSWERING"], [{ state: "NOT_CONFIGURED" }, "NOT_CONFIGURED"],
    [{ state: "KEY_REJECTED" }, "KEY_REJECTED"], [undefined, "NOT_CHECKED"]]) {
    lines = logs(t); world = stores();
    report = await reconcileStores(env, { db: world.db, probe, fetchImpl: world.fetchImpl });
    assert.deepEqual([report.storage, report.index, world.calls.index.length], ["CHECKED", state, 0]);
    assert.equal(lines.log.length, 1, "an index that could not be asked is not a finding");
    t.mock.restoreAll();
  }

  // The database refuses (the reports are not installed yet, or it is down): both parts say so.
  lines = logs(t); world = stores({ storage: new Error("synthetic database failure"), index: new Error("synthetic database failure") });
  report = await reconcileStores(env, { db: world.db, probe: ready, fetchImpl: world.fetchImpl });
  assert.deepEqual([report.storage, report.unreferenced_files, report.index, report.orphaned_versions], ["UNAVAILABLE", null, "UNAVAILABLE", null]);
  assert.deepEqual(lines.warn, []);
  t.mock.restoreAll();

  // The index stops answering between the keep-alive and the question.
  lines = logs(t); world = stores();
  report = await reconcileStores(env, { db: world.db, probe: ready, fetchImpl: async () => { throw new Error("synthetic network failure"); } });
  assert.deepEqual([report.storage, report.index], ["CHECKED", "UNAVAILABLE"]);

  // A database answer that is not a report is not read as "nothing found".
  t.mock.restoreAll(); logs(t); world = stores({ storage: {}, index: [] });
  report = await reconcileStores(env, { db: world.db, probe: ready, fetchImpl: world.fetchImpl });
  assert.deepEqual([report.storage, report.unreferenced_files, report.index, report.orphaned_versions], ["UNAVAILABLE", null, "UNAVAILABLE", null]);
});

test("the first cron run of each day makes the report, with the gateway's own database and index calls", async (t) => {
  resetIndexProbeMemory();
  const lines = logs(t), requests = [];
  t.mock.method(globalThis, "fetch", async (rawUrl, init = {}) => {
    const url = String(rawUrl);
    if (url === "https://qdrant.invalid/collections/nexusrag-test") return json({ result: { points_count: 3, config: { params: { vectors: { size: 768 } } } } });
    if (url === FACET_URL) return json({ result: { hits: [{ value: versionA, count: 3 }] } });
    if (url === "https://supabase.invalid/rest/v1/rpc/nexus_storage_reconciliation") {
      requests.push({ url, body: JSON.parse(init.body), apikey: init.headers.apikey });
      return json(storageReport(1, 2048, 0));
    }
    if (url === "https://supabase.invalid/rest/v1/rpc/nexus_index_reconciliation") {
      requests.push({ url, body: JSON.parse(init.body), apikey: init.headers.apikey });
      return json(indexReport());
    }
    return json([]);
  });
  const run = async (scheduledTime) => {
    const waited = [];
    scheduled({ scheduledTime }, env, { waitUntil: (promise) => waited.push(Promise.resolve(promise).catch(() => undefined)) });
    await Promise.all(waited);
  };
  const reports = () => [...lines.log, ...lines.warn].filter((line) => String(line).includes("store_reconciliation")).map((line) => JSON.parse(line));
  await run(Date.UTC(2026, 10, 14, 0, 0));
  assert.deepEqual(reports(), [{ event: "store_reconciliation", storage: "CHECKED", unreferenced_files: 1, unreferenced_bytes: 2048,
    missing_originals: 0, index: "CHECKED", orphaned_versions: 0, orphaned_entries: 0, unindexed_documents: 0 }]);
  assert.equal(lines.warn.filter((line) => String(line).includes("store_reconciliation")).length, 1, "a leftover file is a warning");
  assert.deepEqual(requests, [
    { url: "https://supabase.invalid/rest/v1/rpc/nexus_storage_reconciliation", body: { p_limit: 0 }, apikey: "synthetic-service-secret" },
    { url: "https://supabase.invalid/rest/v1/rpc/nexus_index_reconciliation", body: { p_indexed: [{ value: versionA, count: 3 }], p_complete: true, p_limit: 0 }, apikey: "synthetic-service-secret" },
  ]);
  await run(Date.UTC(2026, 10, 14, 0, 5));
  await run(Date.UTC(2026, 10, 14, 13, 0));
  assert.equal(reports().length, 1, "other runs of the day make no report");
});
