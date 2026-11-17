import test from "node:test";
import assert from "node:assert/strict";
import { KEYWORD_LIMIT, keywordCandidates } from "../../apps/gateway/src/keyword-search.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const VERSIONS = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const passage = (id, version = VERSIONS[0], workspace = WORKSPACE) => ({ id, workspace_id: workspace, document_id: "d", version_id: version,
  chunk_index: 0, page_number: 1, content: "text", original_text: "text", original_content_hash: "a".repeat(64), location: {}, metadata: {} });

/** The gateway's service request, answering the keyword search with `ranked` and table reads with `rows`. */
function database({ ranked = [], rows = [], failure = null } = {}) {
  const calls = [];
  const read = async (path, init = {}) => {
    calls.push({ path, init, body: init.body ? JSON.parse(init.body) : null });
    if (path === "rpc/nexus_keyword_chunks") {
      if (failure) throw failure;
      return ranked;
    }
    return rows;
  };
  return { read, calls };
}

test("the database ranks every passage of the chosen versions by the question's words", async () => {
  const db = database({ ranked: [{ ...passage("p2"), keyword_score: 9.5 }, { ...passage("p1", VERSIONS[1]), keyword_score: 1.2 }] });
  const result = await keywordCandidates(db.read, { workspace: WORKSPACE, versionIds: VERSIONS, question: "Clause ZX-4471?" });
  assert.deepEqual(db.calls.map((call) => call.path), ["rpc/nexus_keyword_chunks"]);
  assert.equal(db.calls[0].init.method, "POST");
  assert.deepEqual(db.calls[0].body, { p_workspace: WORKSPACE, p_version_ids: VERSIONS, p_question: "Clause ZX-4471?", p_limit: KEYWORD_LIMIT });
  assert.deepEqual(result.rows.map((row) => row.id), ["p2", "p1"], "the database's order is kept");
  assert.equal("keyword_score" in result.rows[0], false);
  assert.deepEqual([result.limited, result.method], [false, "RANKED"]);
});

test("a passage of another workspace or version is dropped even if the database returned it", async () => {
  const db = database({ ranked: [passage("foreign", VERSIONS[0], "99999999-9999-4999-8999-999999999999"),
    passage("other-version", "44444444-4444-4444-8444-444444444444"), passage("kept")] });
  const result = await keywordCandidates(db.read, { workspace: WORKSPACE, versionIds: VERSIONS, question: "q" });
  assert.deepEqual(result.rows.map((row) => row.id), ["kept"]);
});

test("a database without the migration gets the bounded read of the first passages", async () => {
  for (const storageCode of ["PGRST202", "42883"]) {
    const rows = Array.from({ length: 201 }, (_, index) => passage(`p${index}`));
    const db = database({ rows, failure: Object.assign(new Error("missing"), { status: 503, code: "PERSISTENCE_UNAVAILABLE", storageCode }) });
    const result = await keywordCandidates(db.read, { workspace: WORKSPACE, versionIds: VERSIONS, question: "q", chunkFilters: "" });
    assert.equal(db.calls.length, 2);
    assert.match(db.calls[1].path, new RegExp(`^document_chunks\\?workspace_id=eq\\.${WORKSPACE}&version_id=in\\.\\(${VERSIONS.join(",")}\\)&select=.*&order=id\\.asc&limit=201$`));
    assert.deepEqual([result.rows.length, result.limited, result.method], [201, true, "FIRST_PASSAGES"]);
  }
});

test("page or metadata filters keep the complete bounded read and never ask for a ranking", async () => {
  const db = database({ rows: [passage("p1")] });
  const result = await keywordCandidates(db.read, { workspace: WORKSPACE, versionIds: VERSIONS, question: "q",
    chunkFilters: "&page_number=gte.2", chunkScoped: true });
  assert.deepEqual(db.calls.map((call) => call.path.split("?")[0]), ["document_chunks"]);
  assert.match(db.calls[0].path, /&page_number=gte\.2&select=/);
  assert.deepEqual([result.rows.length, result.limited, result.method], [1, false, "FIRST_PASSAGES"]);
});

test("any other failure, and an answer that is not a short list, stops the request", async () => {
  const refused = Object.assign(new Error("refused"), { status: 503, code: "PERSISTENCE_UNAVAILABLE", storageCode: "42501" });
  await assert.rejects(keywordCandidates(database({ failure: refused }).read, { workspace: WORKSPACE, versionIds: VERSIONS, question: "q" }), refused);
  for (const ranked of [null, { rows: [] }, Array.from({ length: KEYWORD_LIMIT + 1 }, (_, index) => passage(`p${index}`))]) {
    await assert.rejects(keywordCandidates(database({ ranked }).read, { workspace: WORKSPACE, versionIds: VERSIONS, question: "q" }),
      (error) => error.code === "PERSISTENCE_UNAVAILABLE" && error.status === 503);
  }
});

test("no versions means no request at all", async () => {
  const db = database();
  assert.deepEqual(await keywordCandidates(db.read, { workspace: WORKSPACE, versionIds: [], question: "q" }), { rows: [], limited: false, method: "RANKED" });
  assert.equal(db.calls.length, 0);
});
