import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { handle } from "../../apps/gateway/src/preview-worker.js";
import { evaluateFixtureCase, runFixtureEvaluation } from "../../apps/gateway/src/fixture-evaluation.js";
import dataset from "../../backend/evals/datasets/sample_corpus.json" with { type: "json" };

const workspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const user = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", FRONTEND_ORIGIN: "https://frontend.invalid" };

async function run(body, { member = true, authenticated = true, method = "POST", raw = false } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url); calls.push(target);
    if (target.endsWith("/auth/v1/user")) return Response.json({ id: user });
    if (target.includes("/workspace_members?")) return Response.json(member ? [{ role: "viewer", user_id: user, workspace_id: workspace }] : []);
    throw new Error("Fixture evaluation attempted external processing or private records");
  };
  try {
    const response = await handle(new Request("https://gateway.invalid/api/v1/evaluations/sample", {
      method, headers: { ...(authenticated ? {authorization: "Bearer synthetic.user.token"} : {}),
        "X-Nexus-Workspace-Id": workspace, "content-type": "application/json" },
      ...(["GET", "HEAD"].includes(method) ? {} : { body: raw ? body : JSON.stringify(body) }),
    }), env);
    return { response, body: await response.json(), calls };
  } finally { globalThis.fetch = original; }
}

for (const mode of ["retrieval", "extractive"]) test(`authenticated ${mode} fixture run returns computed bounded report`, async () => {
  const { response, body, calls } = await run({ mode, top_k: 20, fail_under_recall: 0.9, fail_under_citation_precision: 0.95 });
  assert.equal(response.status, 200);
  assert.equal(body.mode, mode);
  assert.equal(body.dataset, "sample_corpus.json");
  assert.equal(body.summary.total, 3);
  assert.equal(body.results.length, 3);
  assert.equal(body.summary.fixture_only, true);
  assert.equal(body.summary.production_quality_claimed, false);
  assert.equal(body.summary.retrieval_engine, "worker_lexical_rrf");
  assert.equal(body.summary.requested_top_k, 20);
  assert.ok(Number.isFinite(body.duration_ms) && body.duration_ms >= 0);
  assert.ok(Number.isFinite(Date.parse(body.generated_at)));
  for (const item of body.results) {
    assert.equal(item.mode, mode);
    assert.ok(Number.isFinite(item.metrics.latency_ms) && item.metrics.latency_ms >= 0);
    assert.equal(item.sources.every(s => s.workspace_id === item.workspace_id), true);
  }
  assert.equal(body.gates.checks.retrieval_recall.threshold, 0.9);
  assert.equal(body.gates.checks.citation_precision.threshold, 0.95);
  assert.equal(calls.length, 2);
  assert.equal(calls.some(c => /google|qdrant|chat_messages|document_chunks|audit_events|jobs/.test(c)), false);
});

test("fixture defaults and valid minimum topK execute without a paid model", async () => {
  const defaults = await run({});
  assert.equal(defaults.response.status, 200);
  assert.equal(defaults.body.mode, "retrieval");
  assert.equal(defaults.body.summary.requested_top_k, 5);
  const minimum = await run({ top_k: 1 });
  assert.equal(minimum.response.status, 200);
  assert.equal(minimum.body.results.every(r => r.sources.length <= 1), true);
  const nullable = await run({ top_k: null });
  assert.equal(nullable.body.summary.requested_top_k, 5);
});

test("fixture report never forces failing quality metrics into a passing gate", async () => {
  const { response, body } = await run({ top_k: 20, fail_under_citation_precision: 1 });
  assert.equal(response.status, 200);
  assert.equal(body.summary.avg_citation_precision < 1, true);
  assert.equal(body.gates.checks.citation_precision.passed, false);
  assert.equal(body.gates.passed, false);
});

test("fixture route still requires a caller and current workspace membership", async () => {
  assert.equal((await run({}, { authenticated: false })).response.status, 401);
  assert.equal((await run({}, { member: false })).response.status, 403);
});

const invalid = [null, [], { mode: "rag" }, { mode: null }, { top_k: 0 }, { top_k: 21 },
  { top_k: 1.5 }, { top_k: true }, { top_k: "1" }, { fail_under_recall: -1 },
  { fail_under_recall: 1.01 }, { fail_under_recall: null }, { fail_under_recall: "0.9" },
  { fail_under_citation_precision: true }, { fail_under_citation_precision: 2 },
  { dataset: "../../private" }, { provider: "gemini" }, { workspace_id: "other" }];
for (const [index, input] of invalid.entries()) test(`fixture scope and numeric bounds reject invalid input ${index}`, async () => {
  const { response, body } = await run(input);
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "INVALID_SCOPE");
  assert.equal(body.results, undefined);
});

test("fixture route rejects malformed JSON and unsupported methods", async () => {
  assert.equal((await run("{", { raw: true })).response.status, 400);
  assert.equal((await run({}, { method: "GET" })).response.status, 404);
});

test("fixture transport body remains bounded without external processing", async () => {
  const { response, calls } = await run(JSON.stringify({ padding: "x".repeat(100001) }), { raw: true });
  assert.equal(response.status, 413);
  assert.equal(calls.length, 2);
});

test("Worker metrics match the actual Python reference across synthetic edge cases", () => {
  const source = { filename: "known.txt", document_id: "known-id", content: "revenue revenue 10 USD",
    workspace_id: "alpha", metadata: {} };
  const base = { workspace_id: "alpha", expected_sources: ["known.txt"], expected_terms: ["10", "USD"],
    expected_answer: "revenue revenue 10 USD" };
  const cases = [
    { caseItem: base, sources: [source], answer: source.content },
    { caseItem: base, sources: [], answer: "" },
    { caseItem: base, sources: [{ ...source, workspace_id: "beta" }], answer: source.content },
    { caseItem: { ...base, forbidden_sources: ["KNOWN-ID"] }, sources: [source], answer: source.content },
    { caseItem: { ...base, expected_sources: ["", "missing", "known.txt"] }, sources: [source], answer: "10 USD" },
    { caseItem: { ...base, expected_sources: [] }, sources: [], answer: "the and" },
    { caseItem: { expected_sources: [], expected_answer: "the and" }, sources: [source], answer: "the and" },
    { caseItem: { expected_sources: ["Alias FILE"], expected_terms: [""] }, sources: [{ ...source, metadata: { source: "alias-file" } }], answer: "revenue" },
    { caseItem: base, sources: [{ ...source, filename: "other.txt", document_id: "other-id" }, source], answer: "revenue 10 USD invented" },
    { caseItem: base, sources: [source, source], answer: "revenue revenue revenue 10 USD" },
  ];
  for (const mode of ["retrieval", "extractive"]) {
    for (const result of runFixtureEvaluation({ mode }).results) cases.push({
      caseItem: dataset.cases.find(c => c.id === result.id), answer: result.answer,
      sources: result.sources.map(s => ({ ...s, content: dataset.corpus.find(c => c.document_id === s.document_id).content })),
    });
  }
  const reference = spawnSync(process.env.PYTHON || "python", ["-c", `
import json, sys
from evals.metrics import RetrievedSource, evaluate_case
items = json.load(sys.stdin)
out = []
for item in items:
    c = item['caseItem']
    out.append(evaluate_case(answer=item['answer'], sources=[RetrievedSource(**s) for s in item['sources']],
        **{k: c[k] for k in ('expected_sources', 'expected_answer', 'expected_terms', 'workspace_id', 'forbidden_sources') if k in c}).as_dict())
json.dump(out, sys.stdout)
`], { cwd: fileURLToPath(new URL("../../backend/", import.meta.url)), input: JSON.stringify(cases), encoding: "utf8", timeout: 10000 });
  assert.equal(reference.status, 0, reference.stderr || reference.error?.message);
  const expected = JSON.parse(reference.stdout);
  for (const [i, item] of cases.entries()) {
    const actual = evaluateFixtureCase(item.caseItem, item.sources, item.answer);
    for (const [key, value] of Object.entries(expected[i])) {
      if (typeof value === "number") assert.ok(Math.abs(actual[key] - value) <= 0.0001, `${i}/${key}: ${actual[key]} vs ${value}`);
      else assert.equal(actual[key], value, `${i}/${key}`);
    }
  }
  assert.equal(expected[2].cross_workspace_leak, true);
  assert.equal(expected[3].cross_workspace_leak, true);
  assert.equal(expected[2].passed, false);
  assert.equal(expected[3].passed, false);
});
