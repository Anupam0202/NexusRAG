import test from "node:test";
import assert from "node:assert/strict";
import { ensureQdrant } from "../../apps/gateway/src/worker-pipeline.js";

const env = { QDRANT_URL: "https://qdrant.invalid", QDRANT_API_KEY: "synthetic", QDRANT_COLLECTION: "synthetic-collection" };
const tenant = { data_type: "keyword", params: { type: "keyword", is_tenant: true }, points: 3 };
const plain = { data_type: "keyword", points: 3 };
function cluster(t, { collection = 200, schema = {}, indexStatus = () => 200 } = {}) {
  const puts = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input), method = init.method || "GET", json = (value, status = 200) => new Response(JSON.stringify(value), { status });
    if (url.pathname === "/collections/synthetic-collection" && method === "GET")
      return collection === 404 ? json({ status: { error: "Not found" } }, 404) : json({ result: { status: "green", payload_schema: schema } });
    if (url.pathname === "/collections/synthetic-collection" && method === "PUT") return json({ result: true });
    if (url.pathname === "/collections/synthetic-collection/index" && method === "PUT") {
      const body = JSON.parse(init.body);
      puts.push(body);
      return json({ result: { status: "acknowledged" } }, indexStatus(body));
    }
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  });
  return puts;
}

test("a new collection gets its payload indexes, with workspace_id as the tenant", async t => {
  const puts = cluster(t, { collection: 404 });
  await ensureQdrant(env, 768, true);
  assert.deepEqual(puts, [{ field_name: "workspace_id", field_schema: { type: "keyword", is_tenant: true } },
    { field_name: "document_id", field_schema: "keyword" }, { field_name: "version_id", field_schema: "keyword" },
    { field_name: "index_generation", field_schema: "keyword" }]);
});

test("indexes already in place are not requested again; a plain tenant index gets the tenant flag", async t => {
  const ready = cluster(t, { schema: { workspace_id: tenant, document_id: plain, version_id: plain, index_generation: plain } });
  await ensureQdrant(env, 768, true);
  assert.deepEqual(ready, []);
  const upgraded = cluster(t, { schema: { workspace_id: plain, document_id: plain, version_id: plain, index_generation: plain } });
  await ensureQdrant(env, 768, true);
  assert.deepEqual(upgraded, [{ field_name: "workspace_id", field_schema: { type: "keyword", is_tenant: true } }]);
  // Searching never creates anything.
  const searching = cluster(t, { schema: {} });
  await ensureQdrant(env, 768, false);
  assert.deepEqual(searching, []);
});

test("a cluster that refuses the tenant flag still gets a plain index, and other failures stop indexing", async t => {
  const refusedOnNew = cluster(t, { collection: 404, indexStatus: body => typeof body.field_schema === "object" ? 400 : 200 });
  await ensureQdrant(env, 768, true);
  assert.deepEqual(refusedOnNew.slice(0, 2), [{ field_name: "workspace_id", field_schema: { type: "keyword", is_tenant: true } },
    { field_name: "workspace_id", field_schema: "keyword" }]);
  const refusedOnPlain = cluster(t, { schema: { workspace_id: plain, document_id: plain, version_id: plain, index_generation: plain },
    indexStatus: () => 400 });
  await ensureQdrant(env, 768, true);
  assert.equal(refusedOnPlain.length, 1);
  cluster(t, { collection: 404, indexStatus: () => 500 });
  await assert.rejects(ensureQdrant(env, 768, true));
});
