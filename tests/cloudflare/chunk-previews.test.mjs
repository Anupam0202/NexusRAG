import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";
import { sha256 } from "../../apps/gateway/src/worker-pipeline.js";
const workspace = "11111111-1111-4111-8111-111111111111", documentId = "22222222-2222-4222-8222-222222222222", versionId = "33333333-3333-4333-8333-333333333333";
const user = "44444444-4444-4444-8444-444444444444";
const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-public", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
async function fixture(count = 60) {
  const document = { id: documentId, workspace_id: workspace, status: "ready", lifecycle_state: "active", lifecycle_epoch: 1, chunk_count: count, active_version_id: versionId, filename: "Synthetic fixture.txt" };
  const version = { id: versionId, workspace_id: workspace, document_id: documentId, publication_state: "ready", index_generation: "generation-a", lifecycle_epoch: 1 };
  const rows = await Promise.all(Array.from({ length: count }, async (_, index) => {
    const original = index === 59 ? "Late-page NEEDLE original source" : `Original chunk ${index}`;
    return { id: `chunk-${index}`, workspace_id: workspace, document_id: documentId, version_id: versionId,
      chunk_index: index, original_text: original, original_content_hash: await sha256(original), content: "Poisoned derived display content", token_count: 0 };
  }));
  const calls = []; let onChunks = null, membershipReads = 0, revoked = false;
  const fetch = async raw => {
    const url = new URL(raw); calls.push(url);
    if (url.pathname === "/auth/v1/user") return json({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") { membershipReads++; return json(revoked ? [] : [{ workspace_id: workspace, user_id: user, role: "viewer" }]); }
    if (url.pathname === "/rest/v1/documents") { assert.equal(url.searchParams.get("workspace_id"), `eq.${workspace}`); return json([document]); }
    if (url.pathname === "/rest/v1/document_versions") return json([version]);
    if (url.pathname === "/rest/v1/document_chunks") {
      assert.equal(url.searchParams.get("workspace_id"), `eq.${workspace}`);
      assert.equal(url.searchParams.get("version_id"), `eq.${versionId}`); assert.equal(url.searchParams.get("limit"), "401");
      if (onChunks) onChunks(); return json(rows);
    }
    throw new Error(`Unexpected fixture path ${url.pathname}`);
  };
  const run = async (query = "") => {
    const previous = globalThis.fetch; globalThis.fetch = fetch;
    try { const response = await handle(new Request(`https://gateway.invalid/api/v1/documents/${documentId}/chunks${query}`, { headers: { Authorization: "Bearer synthetic-user", "X-Nexus-Workspace-Id": workspace } }), env); return { response, body: await response.json() }; }
    finally { globalThis.fetch = previous; }
  };
  return { document, version, rows, calls, run, mutateDuringRead: fn => { onChunks = fn; }, revoke: () => { revoked = true; }, membershipReads: () => membershipReads };
}
test("chunk search finds authorized original text beyond the first UI page", async () => {
  const f = await fixture(); const { response, body } = await f.run("?limit=2&search=needle");
  assert.equal(response.status, 200); assert.equal(body.total, 1); assert.equal(body.total_is_exact, true);
  assert.equal(body.chunks[0].chunk_index, 59); assert.match(body.chunks[0].content, /original source/);
  assert.doesNotMatch(JSON.stringify(body), /Poisoned/); assert.equal(body.authority, "SUPABASE_HASH_VERIFIED"); assert.equal(body.chunks[0].token_count, 0);
});
test("chunk pagination binds the cursor to the immutable current version", async () => {
  const f = await fixture(5); const first = await f.run("?limit=2");
  assert.equal(first.body.total, 5); assert.equal(first.body.next_after, 1);
  const second = await f.run(`?limit=2&after=1&version_id=${versionId}`);
  assert.deepEqual(second.body.chunks.map(row => row.chunk_index), [2, 3]); assert.equal(second.body.next_after, 3);
  assert.equal((await f.run("?limit=2&after=1")).response.status, 409);
});
test("corrupted, foreign and duplicate chunk authority fails closed", async () => {
  for (const mutation of [f => { f.rows[0].original_text = "Corrupted"; }, f => { f.rows[0].workspace_id = "foreign"; }, f => { f.rows[1].chunk_index = 0; }]) {
    const f = await fixture(2); mutation(f); const { response, body } = await f.run();
    assert.equal(response.status, 409); assert.equal(body.error.code, "EVIDENCE_UNVERIFIED"); assert.equal(body.chunks, undefined);
  }
});
test("tombstoned or unpublished documents never expose private chunk originals", async () => {
  for (const mutation of [f => { f.document.lifecycle_state = "tombstoned"; }, f => { f.version.publication_state = "staged"; }]) {
    const f = await fixture(1); mutation(f); const result = await f.run(); assert.equal(result.response.status, 409); assert.equal(result.body.chunks, undefined);
  }
});
test("concurrent version changes or membership revocation return no chunks", async () => {
  for (const mutation of [f => { f.document.active_version_id = "55555555-5555-4555-8555-555555555555"; }, f => f.revoke()]) {
    const f = await fixture(1); f.mutateDuringRead(() => mutation(f)); const result = await f.run();
    assert.ok([403, 409].includes(result.response.status)); assert.equal(result.body.chunks, undefined);
  }
});
test("oversized chunk inventories are capacity-blocked, never labeled exact samples", async () => {
  const f = await fixture(401); const result = await f.run("?limit=50"); assert.equal(result.response.status, 409); assert.equal(result.body.error.code, "CAPACITY_REACHED");
});
test("malformed limits, cursors and oversized search strings are rejected", async () => {
  const f = await fixture(1);
  for (const query of ["?limit=10oops", "?limit=0", "?limit=201", "?after=-1", "?after=1.2", `?search=${"x".repeat(201)}`]) assert.equal((await f.run(query)).response.status, 422);
});

test("an incomplete persisted inventory cannot become an exact chunk total", async () => {
  const f = await fixture(2); f.rows.pop(); const result = await f.run();
  assert.equal(result.response.status, 409); assert.equal(result.body.error.code, "EVIDENCE_UNVERIFIED"); assert.equal(result.body.total_is_exact, undefined);
});
