import test from "node:test";
import assert from "node:assert/strict";
import { candidateChunkIds, rehydrateEvidence } from "../../apps/gateway/src/retrieval-authority.js";
import { sha256 } from "../../apps/gateway/src/worker-pipeline.js";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
async function fixture() {
  const original = "Authoritative non-sensitive source text";
  return { workspaceId: "workspace-a",
    candidates: [{ id, score: 0.8, payload: { chunk_id: id, workspace_id: "workspace-a", document_id: "doc-a", version_id: "version-a", index_generation: "generation-a", content: "Poisoned vector text", filename: "forged.txt", page_number: 999 } }],
    documents: [{ id: "doc-a", workspace_id: "workspace-a", lifecycle_state: "active", active_version_id: "version-a", filename: "correct.txt", content_type: "text/plain" }],
    versions: [{ id: "version-a", document_id: "doc-a", workspace_id: "workspace-a", publication_state: "ready", data_classification: "non_sensitive", index_generation: "generation-a" }],
    chunks: [{ id, workspace_id: "workspace-a", document_id: "doc-a", version_id: "version-a", content: original, original_text: original, original_content_hash: await sha256(original), chunk_index: 3, page_number: 2, location: { char_start: 20, char_end: 60 } }] };
}
test("vector text, filename and locator are replaced with hash-verified durable originals", async () => {
  const rows = await rehydrateEvidence(await fixture());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.content, "Authoritative non-sensitive source text");
  assert.equal(rows[0].payload.filename, "correct.txt");
  assert.equal(rows[0].payload.page_number, 2);
  assert.deepEqual(rows[0].payload.location, { char_start: 20, char_end: 60 });
});
for (const [name, mutate] of [
  ["foreign chunk", value => { value.chunks[0].workspace_id = "workspace-b"; }],
  ["foreign document", value => { value.documents[0].workspace_id = "workspace-b"; }],
  ["foreign version", value => { value.versions[0].workspace_id = "workspace-b"; }],
  ["tombstoned document", value => { value.documents[0].lifecycle_state = "deleting"; }],
  ["superseded active version", value => { value.documents[0].active_version_id = "new-version"; }],
  ["stale index generation", value => { value.candidates[0].payload.index_generation = "old-generation"; }],
  ["sensitive version", value => { value.versions[0].data_classification = "sensitive"; }],
  ["unpublished version", value => { value.versions[0].publication_state = "staged"; }],
  ["altered original", value => { value.chunks[0].original_text = "Changed original"; }],
  ["missing hash", value => { delete value.chunks[0].original_content_hash; }],
  ["mismatched payload document", value => { value.candidates[0].payload.document_id = "other-document"; }],
]) test(`rehydration denies ${name}`, async () => {
  const value = await fixture(); mutate(value);
  assert.deepEqual(await rehydrateEvidence(value), []);
});
test("only bounded UUID chunk identifiers enter authoritative filters", () => {
  assert.deepEqual(candidateChunkIds([{ payload: { chunk_id: id } }, { payload: { chunk_id: id } }, { payload: { chunk_id: "x)&workspace_id=neq.foreign" } }]), [id]);
});
