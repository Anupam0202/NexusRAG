# Gateway Offline Fixture Evaluation

Application PARTIAL_NOT_COMPLETE. This batch restores one previously advertised
offline workflow, not live retrieval or production acceptance.

## Defect And Boundary

An actual signed-in Chrome visit to the older Cloudflare candidate ended with
Route is not available / Evaluation unavailable after Run Fixture Gate. The
frontend calls POST /api/v1/evaluations/sample; both that deployed gateway and
the saved e458d18 source lacked the route.24 new handler regressions failed
against old source while50 adjacent private-history controls passed.

The gateway now computes reports from the existing shared
backend/evals/datasets/sample_corpus.json. It does not accept arbitrary data,
paths, URLs, model/provider selection or user-corpus overrides. Auth and current
workspace membership remain required, including viewer access consistent with
the retained backend fixture endpoint. Input modes retrieval/extractive, TopK
1..20 (null/omitted defaults5) and quality thresholds0..1 are strictly validated.
Malformed JSON is400, invalid shape/options422, oversized transport413. Public
responses remain private/no-store. This changes no JWT/RLS/table grants.

Ranking reuses worker-lifecycle.js lexical/RRF retrieval, filtered to each
synthetic case's workspace before ranking. It is explicitly worker_lexical_rrf,
not the retained Python neural/BM25 engine and not measured customer retrieval.
Both existing offline modes produce extractive source excerpts, no generation
provider request. The three-case report includes measured runtime, existing
public case/source projection, deterministic metric values and four computed
gates. No forced PASS: TopK20 can fail citation precision because a second
irrelevant Alpha fixture matches some question terms. Labels are used only for
scoring, never to remove unwanted search hits or alter ranking to pass.

Metrics use the existing Python reference definitions, tested by executing that
stdlib reference on16 normal/edge/actual-report cases. Numerical comparison
allows one four-decimal rounding unit for JavaScript/Python tie behavior; boolean
leak/pass decisions must match exactly. Falsey expected-source entries are
excluded as in Python. Token overlap/support is not entailment; synthetic tenant
separation is not actual two-user JWT/private record acceptance.

No Gemini/Qdrant/customer-record read, persistence mutation or audit-event write
is introduced. Report explicitly records fixture_only:true,
production_quality_claimed:false, provider_processing:false and
audit_status:NOT_RECORDED_OFFLINE_FIXTURE. It does not claim the retained Python
evaluation audit write is implemented on Workers. Full durable audit remains an
accepted unfinished capability. Latency/cost/provider quota behavior for live
systems is not inferred from this offline report.

## Verification And Recovery

Focused26 gateway tests, full349 gateway/zero skips,585backend+10subtests,
357frontend/51files,57isolated and79scripts passed locally. Seven component tests
include actual computed report rendering, failing gate presentation, no auto
execution/invented metrics, exact hydrated workspace, old-account response
discard, pending-control locking/duplicate prevention and retry after failure.

Wrangler4.148.0 dry-run packages the shared cross-root JSON without uploading.
frontend/scripts/test-gateway-fixtures.mjs starts the actual local Worker with
only synthetic Auth/member HTTP responses. Its temporary config has no queues,
crons, owner credential environment or .dev.vars; requests are limited to those
two stub routes. Both modes compute reports;401/403/422 and no-store are verified.
It prints ACTUAL_WORKER_FIXTURE_EVALUATION_PASS. CI runs this same integration
after the actual dependency lock installation. This is a local runtime test,
not browser OAuth or a hosted deployment. The owned subprocess is stopped.

Initial new test-harness lint and UI-import/typecheck failures were retained and
corrected, not hidden. Fresh lint/typecheck, Next/OpenNext25assets,
migration/foundation/ledger integrity pass at source save. Exact-head CI, complete
source/evidence archives, new-directory recovery and fresh reruns must be bound
by subsequent immutable receipts. Do not inherit image acceptance from older
commits; exact013 image and required summary failed163backend matches including
57High/50Medium, and no gate or dependency was changed here.

All224 normative definitions and ten connected products are retained. Separate
hosted approval is still required for013 SQL; no new migration, fixture identity,
customer data operation, provider processing, paid activation or deployment was
performed. Source/schema rollout, real private workflows, full audit/erasure,
rights/budgets and complete product workflows remain unfinished.

## Frontend-Only Context Regression

Initial saved/published head1362c88 passed whole-repository source, recovery,
database and frontend CI. Additional inspection of the frontend-only Docker
context reproduced TS2307: the new computed-report TypeScript test imported
gateway code absent from that context. The assertion is retained unchanged in
a separate fixture-response.test.jsx whole-repository integration test. The
production TypeScript roots no longer acquire the gateway test dependency; no
compiler configuration, Dockerfile, unit assertion or image gate is weakened.
Both test files still run in the normal full Vitest suite (357tests/51files).
Preserve initial source ZIP9ee427742cc7d532d2175396e0cc82ae40d75c6420b197bb45c9bf1c4fd430e9
and its actual receipts; they are not final corrected-source acceptance. The
first isolated Next build harness used a node_modules junction rejected by
Turbopack, so a new frontend-only copy with a real lockfile install is checked
instead. This fixture-harness failure is not hidden or called a successful build.
