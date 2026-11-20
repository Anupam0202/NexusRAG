import { createHash } from "node:crypto";
import type { ResearchRun, ResearchRunResult } from "@/lib/research-run";

export const copyModes = ["COMPARE", "TIMELINE", "CONTRADICTION_ANALYSIS", "DEEP_RESEARCH"] as const;
export function researchCopyRun(mode: typeof copyModes[number]): ResearchRun {
  const documentIds = ["55555555-5555-4555-8555-555555555551", "55555555-5555-4555-8555-555555555552"];
  const versionIds = ["66666666-6666-4666-8666-666666666661", "66666666-6666-4666-8666-666666666662"];
  const texts = mode === "TIMELINE" ? ["On 2026-10-01 the interval is 30 days.", "No relevant date is recorded."]
    : ["\u{1F600} The interval is 30 days.", "The interval is 60 days."];
  const originals = texts.map((content, i) => ({
    citation_id: `S${i + 1}`, document_id: documentIds[i], version_id: versionIds[i],
    chunk_id: `77777777-7777-4777-8777-77777777777${i + 1}`, filename: i ? "Beta.txt" : "Alpha.txt",
    content, original_content_hash: createHash("sha256").update(content).digest("hex"),
    location: { char_start: 0, char_end: Array.from(content).length }, page_number: null, chunk_index: 0, excerpt: false,
  }));
  const receipt = (i: number) => ({ version_id: versionIds[i], chunk_id: originals[i].chunk_id,
    original_content_hash: originals[i].original_content_hash, page_number: null, chunk_index: 0 });
  const result: ResearchRunResult = {
    question: "Which synthetic intervals need review?", answer: "Inspect the saved evidence [S1].",
    claim_state: "REVIEW_REQUIRED", abstained: false, sources: [originals[0]], validated_citation_ids: ["S1"], model: null,
    coverage: { completeness: "NOT_EXHAUSTIVE", chunks_considered: 1 }, provider_cost_status: "UNKNOWN",
    review_state: "COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED",
  };
  if (mode === "COMPARE") result.comparison = {
    schema_version: "research-comparison/1", criterion_index: 0, batch_index: 0, batch_count: 1, total_documents: 2,
    interpretation: "REVIEW_REQUIRED_NO_AUTOMATIC_EQUIVALENCE_OR_RANKING",
    cells: [
      { document_id: documentIds[0], filename: "Alpha.txt", answer: "30 days [S1].", claim_state: "REVIEW_REQUIRED",
        abstained: false, validated_citation_ids: ["S1"], gap: null },
      { document_id: documentIds[1], filename: "Beta.txt", answer: "Not reported.", claim_state: "UNSUPPORTED",
        abstained: true, validated_citation_ids: [], gap: "NO_INDEXED_EVIDENCE" },
    ],
  };
  if (mode === "TIMELINE") result.timeline = {
    schema_version: "research-timeline/1", criterion_index: 0, batch_index: 0, batch_count: 1, total_documents: 2,
    interpretation: "REVIEW_REQUIRED_BOUNDS_NOT_CAUSAL_ORDER", coverage: "AT_MOST_TWO_EVENTS_PER_DOCUMENT_PER_CRITERION_NOT_EXHAUSTIVE",
    events: [{ document_id: documentIds[0], filename: "Alpha.txt", citation_id: "S1", quote: texts[0], quote_start: 0,
      quote_end: Array.from(texts[0]).length, date_text: "2026-10-01", date_role: "EFFECTIVE",
      date: { precision: "DAY", lower: "2026-10-01T00:00:00.000Z", upper: "2026-10-01T23:59:59.999Z" }, claim_state: "REVIEW_REQUIRED" }],
    gaps: [{ document_id: documentIds[1], filename: "Beta.txt", reason: "NO_INDEXED_EVIDENCE", rejected_events: 0 }],
  };
  if (mode === "CONTRADICTION_ANALYSIS") {
    result.sources = originals; result.validated_citation_ids = ["S1", "S2"];
    result.contradiction = {
      schema_version: "research-contradiction/1", criterion_index: 0, total_documents: 2,
      pairs: [{ left: { document_id: documentIds[0], citation_id: "S1", quote: texts[0], quote_start: 0, quote_end: Array.from(texts[0]).length },
        right: { document_id: documentIds[1], citation_id: "S2", quote: texts[1], quote_start: 0, quote_end: Array.from(texts[1]).length },
        relationship: "DIFFERENT_CONTEXT", explanation: "Different periods are not a confirmed conflict.", claim_state: "REVIEW_REQUIRED" }],
      documents: documentIds.map((document_id, i) => ({ document_id, filename: originals[i].filename, evidence_state: "PAIRED_CANDIDATE", consulted_sources: [receipt(i)] })),
      rejected_pairs: 0, interpretation: "REVIEW_REQUIRED_NO_AUTOMATIC_CONFLICT_VERDICT", coverage: "BOUNDED_RETRIEVAL_AT_MOST_SIX_PAIRS_NOT_EXHAUSTIVE",
    };
  }
  if (mode === "DEEP_RESEARCH") result.deep = {
    schema_version: "research-deep/1", phase: "SYNTHESIS", criterion_index: 0, question_count: 1, prior_results: [],
    documents: [
      { document_id: documentIds[0], filename: "Alpha.txt", evidence_state: "CITED", context_citation_ids: ["S1"], consulted_sources: [receipt(0)] },
      { document_id: documentIds[1], filename: "Beta.txt", evidence_state: "NO_INDEXED_EVIDENCE", context_citation_ids: [], consulted_sources: [] },
    ],
    limitations: ["Independent review required."], gaps: ["The second document has no indexed evidence."],
    interpretation: "REVIEW_REQUIRED_CITATIONS_NOT_ENTAILMENT", coverage: "BOUNDED_CANDIDATES_AND_CONTEXT_NOT_EXHAUSTIVE",
  };
  return {
    id: "33333333-3333-4333-8333-333333333333", plan_id: "44444444-4444-4444-8444-444444444444",
    workspace_id: "11111111-1111-4111-8111-111111111111", owner_id: "22222222-2222-4222-8222-222222222222",
    schema_version: "research-run/1", persistence_state: "PERSISTED", mode, state: "completed", generation: 1, position: 1,
    questions: [result.question], results: [result], source_state: "CURRENT", error_code: null, created_at: "2026-10-20T00:00:00Z", total_steps: 1,
    source_snapshot: documentIds.map((document_id, i) => ({ document_id, version_id: versionIds[i], index_generation: "synthetic-copy", lifecycle_epoch: 1 })),
  };
}
