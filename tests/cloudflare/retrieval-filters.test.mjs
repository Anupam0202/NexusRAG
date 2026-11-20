import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRetrievalFilters, documentFilterQuery, chunkFilterQuery, matchesDocumentFilters, matchesChunkFilters } from "../../apps/gateway/src/retrieval-filters.js";
import { qdrantFilter, searchChunks } from "../../apps/gateway/src/worker-pipeline.js";

const user = "22222222-2222-4222-8222-222222222222";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("filter normalization preserves exact types and inclusive bounds", () => {
  const filters = normalizeRetrievalFilters({ filename: " Report.PDF ", file_types: [".PDF", "pdf"],
    uploaded_by: user, min_page: 0, max_page: 3, uploaded_after: "2026-01-01",
    uploaded_before: "2026-01-02T23:59:59.999Z", metadata_filters: { "literal.key": false, revision: 0 } });
  assert.equal(filters.filename, "Report.PDF");
  assert.deepEqual(filters.file_types, ["pdf"]);
  const document = { filename: "Report.PDF", uploaded_by: user, created_at: "2026-01-02T12:00:00Z" };
  assert.equal(matchesDocumentFilters(document, filters), true);
  assert.equal(matchesChunkFilters({ page_number: 0, metadata: { "literal.key": false, revision: 0 } }, filters), true);
  assert.equal(matchesChunkFilters({ page_number: null, metadata: { "literal.key": false, revision: 0 } }, filters), false);
  assert.equal(matchesChunkFilters({ page_number: 1, metadata: { "literal.key": false, revision: "0" } }, filters), false);
});
for (const [label, input] of [
  ["object filename", { filename: {} }], ["control filename", { filename: "a\nb" }],
  ["non UUID uploader", { uploaded_by: "someone" }], ["array type required", { file_types: "pdf" }],
  ["type grammar injection", { file_types: ["pdf),workspace_id.neq.private"] }],
  ["type overflow", { file_types: Array(21).fill("pdf") }], ["string page", { min_page: "1" }],
  ["negative page", { min_page: -1 }], ["fraction page", { max_page: 1.1 }],
  ["page overflow", { max_page: 1_000_001 }], ["inverted page", { min_page: 2, max_page: 1 }],
  ["invalid calendar date", { uploaded_after: "2026-02-30" }],
  ["unsupported calendar year zero", { uploaded_after: "0000-01-01" }],
  ["unqualified timestamp", { uploaded_after: "2026-01-01T12:00:00" }],
  ["date overflow hour", { uploaded_after: "2026-01-01T24:00:00Z" }],
  ["inverted dates", { uploaded_after: "2026-01-02", uploaded_before: "2026-01-01" }],
  ["metadata array", { metadata_filters: [] }], ["metadata nested", { metadata_filters: { field: {} } }],
  ["metadata null value", { metadata_filters: { field: null } }],
  ["metadata overflow", { metadata_filters: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i])) }],
  ["metadata prototype key", { metadata_filters: JSON.parse('{"__proto__":"bad"}') }],
  ["metadata infinite value", { metadata_filters: { field: Infinity } }],
]) test(`invalid filter fails closed: ${label}`, () => {
  assert.throws(() => normalizeRetrievalFilters(input), error => error.code === "INVALID_SCOPE" && error.status === 422);
});
test("PostgREST filters encode values without changing tenant authority or literal metadata keys", () => {
  const filters = normalizeRetrievalFilters({ filename: "a&workspace_id=neq.private,report.txt", file_types: ["txt", "md"],
    min_page: 0, max_page: 3, metadata_filters: { "literal.key": "x&workspace_id=neq.private" },
    uploaded_after: "2026-01-01", uploaded_before: "2026-01-02" });
  const doc = new URL(`https://supabase.invalid/rest/v1/documents?workspace_id=eq.tenant${documentFilterQuery(filters)}`);
  assert.deepEqual(doc.searchParams.getAll("workspace_id"), ["eq.tenant"]);
  assert.equal(doc.searchParams.get("filename"), "eq.a&workspace_id=neq.private,report.txt");
  assert.equal(doc.searchParams.get("or"), "(filename.ilike.*.txt,filename.ilike.*.md)");
  assert.deepEqual(doc.searchParams.getAll("created_at"), ["gte.2026-01-01T00:00:00.000Z", "lte.2026-01-02T00:00:00.000Z"]);
  const chunk = new URL(`https://supabase.invalid/rest/v1/document_chunks?workspace_id=eq.tenant${chunkFilterQuery(filters)}`);
  assert.equal(chunk.searchParams.get("metadata"), 'cs.{"literal.key":"x&workspace_id=neq.private"}');
  assert.deepEqual(chunk.searchParams.getAll("page_number"), ["gte.0", "lte.3"]);
});
test("UUID uploader normalization agrees with PostgreSQL UUID equality", () => {
  assert.equal(normalizeRetrievalFilters({ uploaded_by: id.toUpperCase() }).uploaded_by, id);
});
test("missing or mismatched authoritative document fields never match", () => {
  assert.equal(matchesDocumentFilters({ filename: "report.pdf" }, { uploaded_after: 0 }), false);
  assert.equal(matchesDocumentFilters({ filename: "Report.pdf" }, { filename: "report.pdf" }), false);
  assert.equal(matchesDocumentFilters({ filename: "report.pdf.exe" }, { file_types: ["pdf"] }), false);
  assert.equal(matchesDocumentFilters({ uploaded_by: "foreign" }, { uploaded_by: user }), false);
  assert.equal(matchesChunkFilters({ page_number: 4 }, { max_page: 3 }), false);
  assert.equal(matchesChunkFilters({ metadata: {} }, { metadata_filters: { field: false } }), false);
});
test("dense retrieval retains tenant/version/generation fences and exact bounded chunk scope", () => {
  const filter = qdrantFilter("workspace-a", ["doc"], ["version"], ["generation"], [id]);
  assert.equal(filter.must[0].match.value, "workspace-a");
  assert.deepEqual(filter.must[4], { has_id: [id] });
  for (const values of [[], [")&workspace_id=neq.private"], Array(201).fill(id)]) {
    assert.throws(() => qdrantFilter("workspace-a", [], [], [], values), error => error.code === "INVALID_SCOPE");
  }
});
test("invalid filtered vector scope cannot reserve provider usage or send content", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", (...args) => { calls.push(args); throw Error("Must not call provider"); });
  await assert.rejects(searchChunks({}, { workspaceId: id, question: "test", dataClassification: "non_sensitive", chunkIds: [] }),
    error => error.code === "INVALID_SCOPE");
  assert.equal(calls.length, 0);
});