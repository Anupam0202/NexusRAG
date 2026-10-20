import type { ResearchRunResult } from "./research-run";

export function researchResultsClipboardText(results: readonly ResearchRunResult[]): string {
  return results.map(result => {
    const parts = [result.question, result.answer,
      result.sources.map(source => `[${source.citation_id}] ${source.filename}, chunk ${source.chunk_index}, ${source.original_content_hash}`).join("\n")];
    // Keep the saved structures, including gaps and interpretations absent from summary prose.
    if (result.comparison) parts.push(`Comparison (review required; no automatic equivalence or ranking):\n${JSON.stringify(result.comparison, null, 2)}`);
    if (result.timeline) parts.push(`Timeline (review required; bounds do not establish causal order):\n${JSON.stringify(result.timeline, null, 2)}`);
    if (result.contradiction) parts.push(`Source-paired analysis (review required; no automatic conflict verdict):\n${JSON.stringify(result.contradiction, null, 2)}`);
    if (result.deep) parts.push(`Deep Research ${result.deep.phase}\nLimitations: ${result.deep.limitations.join(" | ")}\nEvidence gaps: ${result.deep.gaps.join(" | ")}\nEarlier analyses: ${result.deep.prior_results.map(prior => `${prior.result_index + 1}: ${prior.question} (${prior.claim_state})`).join(" | ")}`,
      `Deep Research evidence and lineage:\n${JSON.stringify(result.deep, null, 2)}`);
    if (result.obligations) parts.push(`Obligation Analysis (provisional; applicability undetermined):\n${JSON.stringify(result.obligations, null, 2)}`);
    if (result.query_retrieval) parts.push(`Search queries (not evidence): ${result.query_retrieval.queries.join(" | ")}`);
    return parts.join("\n");
  }).join("\n\n");
}
