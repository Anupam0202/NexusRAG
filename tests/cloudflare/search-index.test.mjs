import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INDEX_COLLECTION,
  indexEndpoint,
  indexFailure,
  indexStateFor,
  indexSummary,
  probeIndex,
  resetIndexProbeMemory,
} from "../../apps/gateway/src/search-index.js";
import { checkReadiness, resetReadinessMemory } from "../../apps/gateway/src/readiness.js";
import { searchChunks } from "../../apps/gateway/src/worker-pipeline.js";
import { verifyQdrantGeneration } from "../../apps/gateway/src/worker-lifecycle.js";
import { handle, scheduled } from "../../apps/gateway/src/preview-worker.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const collection = (points = 12) => json({ result: { status: "green", points_count: points, config: { params: { vectors: { size: 768, distance: "Cosine" } } } }, status: "ok" });
const index = { QDRANT_URL: "https://qdrant.invalid/", QDRANT_API_KEY: "synthetic-qdrant-secret", QDRANT_COLLECTION: "nexusrag-test" };
const gateway = {
  ...index,
  SUPABASE_URL: "https://supabase.invalid",
  SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-secret",
  GOOGLE_API_KEY: "synthetic-google-secret",
  RUNTIME_SERVICE_NAME: "nexusrag-test-gateway",
  SOURCE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
};
const COLLECTION_URL = "https://qdrant.invalid/collections/nexusrag-test";

function reset() {
  resetIndexProbeMemory();
  resetReadinessMemory();
}

// A healthy database, quota ledger and embedding provider; `qdrant` decides what the index does.
function services(qdrant, { database = () => json([{ id: workspaceId }]) } = {}) {
  const calls = { qdrant: [], database: [] };
  const fetch = async (rawUrl, init = {}) => {
    const url = String(rawUrl);
    if (url.endsWith("/rpc/v6_reserve_many")) {
      const payload = JSON.parse(init.body);
      return json({ state: "READY", reservations: Object.values(payload.p_dimensions).map((amount, n) => ({ id: `11111111-1111-4111-8111-${String(n + 1).padStart(12, "0")}`, amount })) });
    }
    if (url.endsWith("/rpc/v6_settle_many")) return json({ state: "SETTLED" });
    if (url.startsWith("https://supabase.invalid/rest/v1/")) {
      calls.database.push({ url, init });
      return database(url, init);
    }
    if (url.includes(":embedContent")) return json({ embedding: { values: Array.from({ length: 768 }, (_, n) => n / 768) } });
    if (url.startsWith("https://qdrant.invalid/")) {
      calls.qdrant.push({ url, init });
      return qdrant(url, init);
    }
    throw new Error(`unexpected request: ${url}`);
  };
  return { fetch, calls };
}

test("an index response is classified by what it proves", () => {
  assert.equal(indexStateFor(200), "READY");
  assert.equal(indexStateFor(404), "EMPTY");
  assert.equal(indexStateFor(401), "KEY_REJECTED");
  assert.equal(indexStateFor(403), "KEY_REJECTED");
  assert.equal(indexStateFor(429), "RATE_LIMITED");
  // 0 stands for no answer at all: a timeout, a reset connection or a name that does not resolve.
  for (const status of [0, 500, 502, 503, 504]) assert.equal(indexStateFor(status), "NOT_ANSWERING");
  for (const status of [400, 409, 422]) assert.equal(indexStateFor(status), "REJECTED");
});

test("each index failure says whose problem it is and whether waiting helps", () => {
  const silent = indexFailure("NOT_ANSWERING", 503);
  assert.deepEqual([silent.code, silent.status, silent.retryable, silent.indexState], ["INDEX_NOT_ANSWERING", 503, true, "NOT_ANSWERING"]);
  assert.match(silent.message, /not answering/);
  assert.match(silent.message, /paused/);
  assert.match(silent.message, /documents are safe/i);

  const key = indexFailure("KEY_REJECTED", 403);
  assert.deepEqual([key.code, key.status, key.retryable], ["INDEX_KEY_REJECTED", 503, false]);
  assert.match(key.message, /operator/);

  const empty = indexFailure("EMPTY", 404);
  assert.deepEqual([empty.code, empty.status, empty.retryable], ["INDEX_EMPTY", 503, false]);

  const limited = indexFailure("RATE_LIMITED", 429);
  assert.deepEqual([limited.code, limited.status, limited.retryable], ["PROVIDER_QUOTA_EXHAUSTED", 429, true]);

  const rejected = indexFailure("REJECTED", 400);
  assert.deepEqual([rejected.code, rejected.status, rejected.retryable], ["PROVIDER_UNAVAILABLE", 503, true]);
  assert.match(rejected.message, /HTTP 400/);

  const missing = indexFailure("NOT_CONFIGURED");
  assert.deepEqual([missing.code, missing.status, missing.retryable], ["CONFIGURATION_ERROR", 503, false]);
  for (const failure of [silent, key, empty, limited, rejected, missing]) assert.doesNotMatch(failure.message, /qdrant/i, "the provider's name is an operator detail");
});

test("the index address comes from the environment and falls back to the documented collection", () => {
  assert.deepEqual(indexEndpoint(index), { base: COLLECTION_URL, headers: { "content-type": "application/json", "api-key": "synthetic-qdrant-secret" } });
  assert.equal(indexEndpoint({ QDRANT_URL: "https://qdrant.invalid", QDRANT_API_KEY: "k" }).base, `https://qdrant.invalid/collections/${DEFAULT_INDEX_COLLECTION}`);
  assert.equal(indexEndpoint({ ...index, QDRANT_COLLECTION: "a b/c" }).base, "https://qdrant.invalid/collections/a%20b%2Fc");
  assert.throws(() => indexEndpoint({ QDRANT_URL: "https://qdrant.invalid" }), (error) => error.code === "CONFIGURATION_ERROR");
});

test("the probe is one light authenticated read of this environment's collection", async () => {
  reset();
  const calls = [];
  const result = await probeIndex(index, { now: 1_000, fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return collection(); } });
  assert.deepEqual(result, { state: "READY", collection: "nexusrag-test", points: 12, vector_size: 768, http_status: 200, checked_at: "1970-01-01T00:00:01.000Z" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, COLLECTION_URL);
  assert.equal(calls[0].init.method ?? "GET", "GET");
  assert.equal(new Headers(calls[0].init.headers).get("api-key"), "synthetic-qdrant-secret");
  assert.doesNotMatch(JSON.stringify(result), /synthetic/);
});

test("the probe reports every state it can tell apart and never throws", async () => {
  const probe = (fetchImpl, env = index) => { reset(); return probeIndex(env, { now: 5_000, fetchImpl }); };
  assert.deepEqual(await probe(async () => json({ status: { error: "Not found: Collection `nexusrag-test` doesn't exist!" } }, 404)),
    { state: "EMPTY", collection: "nexusrag-test", points: null, vector_size: null, http_status: 404, checked_at: "1970-01-01T00:00:05.000Z" });
  assert.equal((await probe(async () => new Response("forbidden", { status: 403 }))).state, "KEY_REJECTED");
  assert.equal((await probe(async () => new Response("", { status: 401 }))).state, "KEY_REJECTED");
  assert.equal((await probe(async () => new Response("slow down", { status: 429 }))).state, "RATE_LIMITED");
  assert.equal((await probe(async () => new Response("no healthy upstream", { status: 503 }))).state, "NOT_ANSWERING");
  const reset_connection = await probe(async () => { throw new TypeError("fetch failed"); });
  assert.deepEqual([reset_connection.state, reset_connection.http_status], ["NOT_ANSWERING", 0]);
  // A 200 that is not a collection description (a proxy page, a wrong address) proves nothing about the index.
  assert.equal((await probe(async () => new Response("<html>hello</html>", { status: 200 }))).state, "REJECTED");
  assert.equal((await probe(async () => json({ result: null }))).state, "REJECTED");

  let requests = 0;
  const unconfigured = await probe(async () => { requests += 1; return collection(); }, { QDRANT_URL: "https://qdrant.invalid" });
  assert.deepEqual([unconfigured.state, unconfigured.http_status, requests], ["NOT_CONFIGURED", null, 0]);
});

test("a recent probe is reused only when the caller allows it", async () => {
  reset();
  let requests = 0;
  const fetchImpl = async () => { requests += 1; return collection(requests); };
  const first = await probeIndex(index, { now: 10_000, fetchImpl });
  const reused = await probeIndex(index, { now: 69_999, fetchImpl, maxAgeMs: 60_000 });
  assert.deepEqual(reused, first);
  assert.equal(requests, 1);
  const expired = await probeIndex(index, { now: 70_001, fetchImpl, maxAgeMs: 60_000 });
  assert.equal(expired.points, 2);
  const fresh = await probeIndex(index, { now: 70_002, fetchImpl });
  assert.equal(fresh.points, 3, "without maxAgeMs every call asks the index");
  // Another collection is another index.
  const other = await probeIndex({ ...index, QDRANT_COLLECTION: "another" }, { now: 70_003, fetchImpl, maxAgeMs: 60_000 });
  assert.deepEqual([other.collection, other.points], ["another", 4]);
});

test("only a summary without counts is public", () => {
  const probe = { state: "READY", collection: "nexusrag-test", points: 12, vector_size: 768, http_status: 200, checked_at: "1970-01-01T00:00:01.000Z" };
  assert.deepEqual(indexSummary(probe), { state: "READY", collection: "nexusrag-test", populated: true, http_status: 200, checked_at: "1970-01-01T00:00:01.000Z" });
  assert.equal(indexSummary({ ...probe, points: 0 }).populated, false);
  assert.equal(indexSummary({ ...probe, state: "NOT_ANSWERING", points: null }).populated, null);
});

test("the first cron run of each day asks the index one question, which keeps a free cluster awake", async (t) => {
  reset();
  const backend = services(() => collection(7), { database: () => json([]) });
  t.mock.method(globalThis, "fetch", backend.fetch);
  const warnings = [], logged = [];
  t.mock.method(console, "warn", (line) => warnings.push(line));
  t.mock.method(console, "log", (line) => logged.push(line));
  const run = async (scheduledTime, env = gateway) => {
    const waited = [];
    scheduled({ scheduledTime }, env, { waitUntil: (promise) => waited.push(Promise.resolve(promise).catch(() => undefined)) });
    await Promise.all(waited);
  };
  await run(Date.UTC(2026, 10, 13, 0, 0));
  assert.deepEqual(backend.calls.qdrant.map((call) => call.url), [COLLECTION_URL]);
  await run(Date.UTC(2026, 10, 13, 0, 5));
  await run(Date.UTC(2026, 10, 13, 12, 0));
  assert.equal(backend.calls.qdrant.length, 1, "other runs leave the index alone");
  assert.equal(warnings.some((line) => String(line).includes("search_index_keepalive")), false, "a healthy index is not a warning");
  // The Worker's log is the operator's record of what the index holds.
  assert.deepEqual(logged.filter((line) => String(line).includes("search_index_keepalive")).map((line) => JSON.parse(line)),
    [{ event: "search_index_keepalive", state: "READY", http_status: 200, collection: "nexusrag-test", points: 7, vector_size: 768 }]);

  // A cluster that does not answer is reported once, without failing the cron run or leaking the key.
  const silent = services(() => new Response("no healthy upstream", { status: 503 }), { database: () => json([]) });
  t.mock.method(globalThis, "fetch", silent.fetch);
  await run(Date.UTC(2026, 10, 14, 0, 0));
  const reports = warnings.filter((line) => String(line).includes("search_index_keepalive")).map((line) => JSON.parse(line));
  assert.deepEqual(reports, [{ event: "search_index_keepalive", state: "NOT_ANSWERING", http_status: 503, collection: "nexusrag-test", points: null, vector_size: null }]);
  assert.doesNotMatch(warnings.join(""), /synthetic/);

  // An environment without an index asks nothing.
  const none = services(() => { throw new Error("must not be asked"); }, { database: () => json([]) });
  t.mock.method(globalThis, "fetch", none.fetch);
  await run(Date.UTC(2026, 10, 15, 0, 0), { ...gateway, QDRANT_URL: "", QDRANT_API_KEY: "" });
  assert.equal(none.calls.qdrant.length, 0);
});

test("readiness reports what the gateway could actually reach", async () => {
  reset();
  const healthy = services(() => collection(3));
  const report = await checkReadiness(gateway, { fetchImpl: healthy.fetch, now: 1_000 });
  assert.deepEqual(report, {
    readiness: "READY",
    checked_at: "1970-01-01T00:00:01.000Z",
    dependencies: {
      database: { state: "REACHABLE", http_status: 200 },
      search_index: { state: "READY", collection: "nexusrag-test", populated: true, http_status: 200, checked_at: "1970-01-01T00:00:01.000Z" },
    },
  });
  assert.equal(healthy.calls.database.length, 1);
  const read = healthy.calls.database[0];
  assert.match(read.url, /\/rest\/v1\/workspaces\?select=id&limit=1$/);
  assert.equal(new Headers(read.init.headers).get("apikey"), "synthetic-service-secret");

  // A new environment has no collection yet; the first upload creates it, so that is still ready.
  reset();
  assert.equal((await checkReadiness(gateway, { fetchImpl: services(() => new Response("{}", { status: 404 })).fetch, now: 2_000 })).readiness, "READY");

  const degraded = async (qdrant, database) => { reset(); return checkReadiness(gateway, { fetchImpl: services(qdrant, { database }).fetch, now: 3_000 }); };
  const asleep = await degraded(() => new Response("", { status: 503 }));
  assert.deepEqual([asleep.readiness, asleep.dependencies.search_index.state, asleep.dependencies.database.state], ["DEGRADED", "NOT_ANSWERING", "REACHABLE"]);
  assert.equal((await degraded(() => new Response("", { status: 403 }))).dependencies.search_index.state, "KEY_REJECTED");
  const badKey = await degraded(() => collection(), () => json({ message: "Invalid API key" }, 401));
  assert.deepEqual([badKey.readiness, badKey.dependencies.database], ["DEGRADED", { state: "KEY_REJECTED", http_status: 401 }]);
  const noSchema = await degraded(() => collection(), () => json({ code: "PGRST205" }, 404));
  assert.deepEqual(noSchema.dependencies.database, { state: "SCHEMA_MISSING", http_status: 404 });
  const down = await degraded(() => collection(), () => { throw new TypeError("fetch failed"); });
  assert.deepEqual(down.dependencies.database, { state: "UNAVAILABLE", http_status: 0 });

  // A degraded answer is kept for ten seconds only, so a fix shows up quickly; a ready one for a minute.
  reset();
  let awake = false;
  const waking = services(() => awake ? collection(1) : new Response("", { status: 503 }));
  assert.equal((await checkReadiness(gateway, { fetchImpl: waking.fetch, now: 100_000 })).readiness, "DEGRADED");
  awake = true;
  assert.equal((await checkReadiness(gateway, { fetchImpl: waking.fetch, now: 109_999 })).readiness, "DEGRADED");
  assert.equal((await checkReadiness(gateway, { fetchImpl: waking.fetch, now: 110_000 })).readiness, "READY");
  assert.equal((await checkReadiness(gateway, { fetchImpl: waking.fetch, now: 169_999 })).checked_at, "1970-01-01T00:01:50.000Z");
  assert.equal(waking.calls.qdrant.length, 2);

  reset();
  let requests = 0;
  const bare = await checkReadiness({}, { fetchImpl: async () => { requests += 1; return collection(); }, now: 4_000 });
  assert.deepEqual([bare.readiness, bare.dependencies.database.state, bare.dependencies.search_index.state, requests], ["DEGRADED", "NOT_CONFIGURED", "NOT_CONFIGURED", 0]);
});

test("/ready answers 200 only when everything was reached, and remembers the answer for a minute", async (t) => {
  reset();
  const healthy = services(() => collection(3));
  t.mock.method(globalThis, "fetch", healthy.fetch);
  const first = await handle(new Request("https://gateway.invalid/ready"), gateway);
  const body = await first.json();
  assert.equal(first.status, 200);
  assert.equal(body.service, "nexusrag-test-gateway");
  assert.equal(body.source_commit, gateway.SOURCE_COMMIT);
  assert.equal(body.readiness, "READY");
  assert.deepEqual(body.dependencies.search_index, { state: "READY", collection: "nexusrag-test", populated: true, http_status: 200, checked_at: body.checked_at });
  assert.match(first.headers.get("cache-control"), /no-store/);
  assert.doesNotMatch(JSON.stringify(body), /synthetic/);

  // Anyone may ask, so repeated questions must not become repeated provider calls.
  const again = await handle(new Request("https://gateway.invalid/ready"), gateway);
  assert.equal(again.status, 200);
  assert.equal(healthy.calls.qdrant.length, 1);
  assert.equal(healthy.calls.database.length, 1);
  const head = await handle(new Request("https://gateway.invalid/ready", { method: "HEAD" }), gateway);
  assert.deepEqual([head.status, await head.text()], [200, ""]);

  reset();
  t.mock.method(globalThis, "fetch", services(() => new Response("no healthy upstream", { status: 503 })).fetch);
  const degraded = await handle(new Request("https://gateway.invalid/ready"), gateway);
  assert.equal(degraded.status, 503);
  const report = await degraded.json();
  assert.deepEqual([report.readiness, report.dependencies.search_index.state], ["DEGRADED", "NOT_ANSWERING"]);
  assert.equal((await handle(new Request("https://gateway.invalid/ready", { method: "POST" }), gateway)).status, 401, "only reads are public");
});

test("a search says when the index is not answering, is misconfigured or is empty", async (t) => {
  const search = (signal) => searchChunks(gateway, { workspaceId, question: "What is the retention period?", dataClassification: "non_sensitive", signal });
  const failsWith = async (qdrant, code, status, retryable) => {
    t.mock.method(globalThis, "fetch", services(qdrant).fetch);
    await assert.rejects(search(), (error) => {
      assert.deepEqual([error.code, error.status, error.retryable], [code, status, retryable]);
      assert.doesNotMatch(error.message, /synthetic|qdrant\.invalid/);
      return true;
    });
  };
  await failsWith(() => new Response("no healthy upstream", { status: 503 }), "INDEX_NOT_ANSWERING", 503, true);
  await failsWith(() => { throw new TypeError("fetch failed"); }, "INDEX_NOT_ANSWERING", 503, true);
  await failsWith(() => new Response("forbidden", { status: 403 }), "INDEX_KEY_REJECTED", 503, false);
  await failsWith(() => new Response("{}", { status: 404 }), "INDEX_EMPTY", 503, false);
  await failsWith(() => new Response("slow down", { status: 429 }), "PROVIDER_QUOTA_EXHAUSTED", 429, true);
  // The collection answers, then the query itself is lost.
  await failsWith((url) => url === COLLECTION_URL ? collection() : new Response("bad gateway", { status: 502 }), "INDEX_NOT_ANSWERING", 503, true);
  await failsWith((url) => { if (url === COLLECTION_URL) return collection(); throw new TypeError("fetch failed"); }, "INDEX_NOT_ANSWERING", 503, true);

  // A person who cancels their own question is not told the index is down.
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", services(() => { controller.abort(); throw controller.signal.reason; }).fetch);
  await assert.rejects(search(controller.signal), (error) => error.name === "AbortError" && error.code !== "INDEX_NOT_ANSWERING");
});

test("checks that run outside a search report an unanswered index the same way", async (t) => {
  t.mock.method(globalThis, "fetch", services(() => { throw new TypeError("fetch failed"); }).fetch);
  await assert.rejects(verifyQdrantGeneration(gateway, workspaceId, workspaceId, workspaceId, "generation-1", 3),
    (error) => error.code === "INDEX_NOT_ANSWERING" && error.status === 503 && error.retryable === true);
});

test("the signed-in status page shows the probed index state instead of a guess", async (t) => {
  reset();
  const user = () => json({ id: "22222222-2222-4222-8222-222222222222" });
  const withIndex = (qdrant) => {
    const backend = services(qdrant);
    return async (url, init) => String(url).endsWith("/auth/v1/user") ? user() : backend.fetch(url, init);
  };
  const status = async () => (await handle(new Request("https://gateway.invalid/api/v1/status", { headers: { authorization: "Bearer synthetic-user-token" } }), gateway)).json();

  t.mock.method(globalThis, "fetch", withIndex(() => collection(5)));
  const ready = await status();
  assert.deepEqual([ready.status, ready.readiness], ["READY", "READY"]);
  assert.deepEqual(ready.dependency_status, { supabase_data_api: "REACHABLE", qdrant: "READY", gemini: "CONFIGURED_NOT_PROBED" });

  reset();
  t.mock.method(globalThis, "fetch", withIndex(() => new Response("no healthy upstream", { status: 503 })));
  const asleep = await status();
  assert.deepEqual([asleep.status, asleep.readiness, asleep.dependency_status.qdrant], ["DEGRADED", "DEGRADED", "NOT_ANSWERING"]);
  assert.doesNotMatch(JSON.stringify(asleep), /synthetic/);
});
