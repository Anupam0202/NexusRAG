// Citation syntax and source presence are necessary, never sufficient, for support.
// Semantic entailment requires independent verification or human review.
function assessAnswer(answer, sources) {
  const text = String(answer || "").trim();
  const citations = [...text.matchAll(/\[S(\d+)\]/g)].map(match => Number(match[1]));
  const valid = citations.length > 0 && citations.every(index => index >= 1 && index <= sources.length &&
    typeof sources[index - 1]?.content === "string" && sources[index - 1].content.trim().length > 0);
  // Fail closed for uncited/invalidly cited model output; do not publish an unsupported claim.
  if (!valid) return { answer: "I cannot verify this answer against the available evidence. Please review the sources or refine the question.", claim_state: "UNSUPPORTED", abstained: true, citations: [] };
  return { answer: text, claim_state: "REVIEW_REQUIRED", abstained: false, citations: [...new Set(citations)] };
}
export { assessAnswer };
