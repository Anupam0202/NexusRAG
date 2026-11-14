import test from "node:test";
import assert from "node:assert/strict";
import { resolveSummaryDocuments } from "../../apps/gateway/src/document-summary-scope.js";

const docs = [{ id: "cover", filename: "Cover_Letter.pdf" }, { id: "resume", filename: "Resume.pdf" }];
for (const question of ["Summarize the cover letter", "Please summarise Cover_Letter.pdf", 'Provide a summary of "Cover_Letter.pdf"']) {
  test(`literal summary target: ${question}`, () => {
    const scope = resolveSummaryDocuments(question, docs);
    assert.deepEqual(scope.document_ids, ["cover"]); assert.equal(scope.reason, "NAMED_DOCUMENT");
  });
}
for (const [question, input] of [
  ["Summarize this document", docs],
  ['Summarize "Missing.pdf"', docs],
  ["Summarize Cover Letter", [...docs, { id: "other", filename: "Cover-Letter.docx" }]],
]) test(`ambiguous or missing target asks for selection: ${question}`, () => {
  assert.throws(() => resolveSummaryDocuments(question, input), error =>
    error.status === 422 && error.code === "DOCUMENT_SELECTION_REQUIRED");
});
test("full filenames distinguish same stems with different extensions", () => {
  assert.deepEqual(resolveSummaryDocuments("Summarize Cover_Letter.pdf",
    [...docs, { id: "other", filename: "Cover_Letter.txt" }]).document_ids, ["cover"]);
});
test("quoted multiple filenames require every exact source without silently dropping a missing file", () => {
  assert.deepEqual(resolveSummaryDocuments('Summarize both files "Cover_Letter.pdf" and "Resume.pdf"', docs).document_ids, ["cover", "resume"]);
  assert.throws(() => resolveSummaryDocuments('Summarize "Cover_Letter.pdf" and "Missing.pdf"', docs), /missing or ambiguous/);
});
test("explicit scope, plural summaries and factual queries retain caller scope", () => {
  assert.deepEqual(resolveSummaryDocuments("Summarize the cover letter", [docs[1]], true).document_ids, ["resume"]);
  for (const q of ["Summarize all documents", "Summarize both files", "What is the summary retention period?"]) {
    assert.deepEqual(resolveSummaryDocuments(q, docs).document_ids, ["cover", "resume"]);
  }
});
test("a sole or empty workspace remains a bounded honest summary scope", () => {
  assert.deepEqual(resolveSummaryDocuments("Summarize this document", [docs[0]]).document_ids, ["cover"]);
  assert.deepEqual(resolveSummaryDocuments("Summarize this document", []).document_ids, []);
});
test("filename boundaries do not match a longer word or generic report reference", () => {
  assert.throws(() => resolveSummaryDocuments("Summarize Resumes", docs), /Select the document/);
  assert.throws(() => resolveSummaryDocuments("Summarize this report",
    [{ id: "one", filename: "Report.pdf" }, { id: "two", filename: "Notes.pdf" }]), /Select the document/);
});

test("literal title suffixes support prefixed filenames and ask when multiple letters match", () => {
  const prefixed = [{ id: "cover", filename: "Applicant_Cover_Letter.pdf" }, docs[1]];
  assert.deepEqual(resolveSummaryDocuments("Could you please summarize the cover letter?", prefixed).document_ids, ["cover"]);
  assert.throws(() => resolveSummaryDocuments("Summarize the cover letter", [...prefixed,
    { id: "second", filename: "Other_Cover_Letter.pdf" }]), /Select the document/);
});

test("a missing unquoted filename does not fall back to the sole available file", () => {
  assert.throws(() => resolveSummaryDocuments("Summarize Missing.pdf", [docs[1]]), /missing or ambiguous/);
});

test("a missing named title cannot become the sole unrelated workspace document", () => {
  assert.throws(() => resolveSummaryDocuments("Summarize the cover letter", [docs[1]]), /Select the document/);
});
