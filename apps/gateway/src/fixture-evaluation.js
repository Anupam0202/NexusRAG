import dataset from "../../../backend/evals/datasets/sample_corpus.json" with { type: "json" };
import { hybridFuse } from "./worker-lifecycle.js";

const stopwords = new Set("a an and are as at be by for from in is it of on or the to with".split(" "));
const tokens = value => String(value).toLowerCase().match(/[a-z0-9]+/g)?.filter(t => !stopwords.has(t)) || [];
const round = (value, digits = 4) => Number(value.toFixed(digits));
const normalized = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const matches = (expected, source) => Boolean(normalized(expected)) &&
  [source.filename, source.document_id, source.metadata?.source].some(id => normalized(id) === normalized(expected));

function tokenF1(reference, candidate) {
  const ref = tokens(reference), cand = tokens(candidate);
  if (!ref.length && !cand.length) return 1;
  if (!ref.length || !cand.length) return 0;
  const counts = new Map();
  for (const token of ref) counts.set(token, (counts.get(token) || 0) + 1);
  let overlap = 0;
  for (const token of cand) if (counts.get(token) > 0) {
    overlap += 1; counts.set(token, counts.get(token) - 1);
  }
  return overlap ? round(2 * overlap / (ref.length + cand.length)) : 0;
}

// Same deterministic metric definitions as backend/evals/metrics.py, not entailment.
export function evaluateFixtureCase(caseItem, sources, answer) {
  const expected = (caseItem.expected_sources || []).filter(Boolean);
  const relevant = sources.map(s => expected.some(e => matches(e, s)));
  const recall = expected.length
    ? round(expected.filter(e => sources.some(s => matches(e, s))).length / expected.length)
    : sources.length ? 1 : 0.5;
  const first = relevant.indexOf(true);
  const mrr = expected.length ? first < 0 ? 0 : round(1 / (first + 1)) : sources.length ? 1 : 0;
  const dcg = relevant.reduce((sum, hit, i) => sum + Number(hit) / Math.log2(i + 2), 0);
  const ideal = Array.from({ length: Math.min(expected.length, sources.length) }, (_, i) => 1 / Math.log2(i + 2))
    .reduce((sum, value) => sum + value, 0);
  const ndcg = expected.length ? ideal ? round(dcg / ideal) : 0 : sources.length ? 1 : 0;
  const precision = !sources.length ? 0 : expected.length ? round(relevant.filter(Boolean).length / sources.length) : 1;
  const terms = (caseItem.expected_terms || []).filter(Boolean);
  const termScore = terms.length ? terms.filter(t => answer.toLowerCase().includes(t.toLowerCase())).length / terms.length : 0;
  const reference = caseItem.expected_answer || "";
  const f1 = reference ? tokenF1(reference, answer) : 0;
  const relevance = terms.length && reference ? round((termScore + f1) / 2)
    : terms.length ? round(termScore) : reference ? f1 : answer.trim() ? 1 : 0;
  const answerTokens = new Set(tokens(answer)), sourceTokens = new Set(tokens(sources.map(s => s.content).join(" ")));
  const support = answerTokens.size && sourceTokens.size
    ? round([...answerTokens].filter(t => sourceTokens.has(t)).length / answerTokens.size) : 0;
  const leak = sources.some(s => (caseItem.workspace_id && s.workspace_id && s.workspace_id !== caseItem.workspace_id)
    || (caseItem.forbidden_sources || []).some(e => matches(e, s)));
  return { retrieval_recall_at_k: recall, mrr, ndcg, citation_precision: precision,
    citation_recall: recall, answer_relevance: relevance, answer_support: support,
    cross_workspace_leak: leak, passed: !leak && recall >= 0.8 && relevance >= 0.5 && support >= 0.35 };
}

function options(body) {
  const invalid = () => { throw Object.assign(new Error("Choose retrieval or extractive mode, Top K from 1 to 20, and thresholds from 0 to 1."),
    { status: 422, code: "INVALID_SCOPE" }); };
  const allowed = new Set(["mode", "top_k", "fail_under_recall", "fail_under_citation_precision"]);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !allowed.has(k))) invalid();
  const mode = body.mode === undefined ? "retrieval" : body.mode;
  const topK = body.top_k ?? 5;
  const recall = body.fail_under_recall === undefined ? 0.9 : body.fail_under_recall;
  const citation = body.fail_under_citation_precision === undefined ? 0.95 : body.fail_under_citation_precision;
  if (!["retrieval", "extractive"].includes(mode) || !Number.isInteger(topK) || topK < 1 || topK > 20 ||
    [recall, citation].some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1)) invalid();
  return { mode, topK, recall, citation };
}

export function runFixtureEvaluation(body) {
  const config = options(body), started = performance.now();
  // Only the shipped synthetic corpus is reachable. No user corpus or network adapter.
  const results = dataset.cases.map(caseItem => {
    const caseStart = performance.now();
    const rows = dataset.corpus.filter(row => row.workspace_id === caseItem.workspace_id)
      .map(row => ({ ...row, id: row.document_id, metadata: { filename: row.filename, workspace_id: row.workspace_id } }));
    const sources = hybridFuse(caseItem.question, [], rows, config.topK, 0).map(hit => ({
      filename: hit.payload.filename, document_id: hit.payload.document_id, workspace_id: hit.payload.workspace_id,
      content: hit.payload.content, score: round(hit.lexical_score || 0),
    }));
    const answer = sources.length ? [`Extractive answer for: ${caseItem.question}`, "",
      ...sources.slice(0, 5).map((source, i) => `${i + 1}. ${source.filename}: ${source.content.slice(0, 450)}`)].join("\n")
      : "No relevant document excerpts were retrieved for this question. The system should ask for more context or ingest the needed source.";
    const metrics = evaluateFixtureCase(caseItem, sources, answer);
    metrics.latency_ms = round(performance.now() - caseStart, 2);
    return { id: caseItem.id, question: caseItem.question, workspace_id: caseItem.workspace_id,
      mode: config.mode, answer, sources: sources.map(({ content: _content, ...source }) => source), metrics, passed: metrics.passed };
  });
  const total = results.length, passed = results.filter(r => r.passed).length;
  const summary = { total, passed, failed: total - passed, pass_rate: total ? round(passed / total) : 0,
    cross_workspace_leaks: results.filter(r => r.metrics.cross_workspace_leak).length,
    fixture_only: true, production_quality_claimed: false, retrieval_engine: "worker_lexical_rrf",
    requested_top_k: config.topK, provider_processing: false, audit_status: "NOT_RECORDED_OFFLINE_FIXTURE" };
  for (const metric of ["retrieval_recall_at_k", "mrr", "ndcg", "citation_precision", "citation_recall",
    "answer_relevance", "answer_support", "latency_ms"])
    summary[`avg_${metric}`] = total ? round(results.reduce((sum, r) => sum + r.metrics[metric], 0) / total) : 0;
  const checks = {
    retrieval_recall: { value: summary.avg_retrieval_recall_at_k, threshold: config.recall, passed: summary.avg_retrieval_recall_at_k >= config.recall },
    citation_precision: { value: summary.avg_citation_precision, threshold: config.citation, passed: summary.avg_citation_precision >= config.citation },
    cross_workspace_leaks: { value: summary.cross_workspace_leaks, threshold: 0, passed: summary.cross_workspace_leaks === 0 },
    case_pass_rate: { value: summary.pass_rate, threshold: 1, passed: summary.pass_rate === 1 },
  };
  return { dataset: "sample_corpus.json", mode: config.mode, generated_at: new Date().toISOString(),
    duration_ms: round(performance.now() - started, 2), summary,
    gates: { passed: total > 0 && Object.values(checks).every(c => c.passed), checks }, results };
}
