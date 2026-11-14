# Durable aggregate worksheet: batch026

PARTIAL_NOT_COMPLETE. Parent c6c5c7508add50420f699d395b359033976548f5,
tree23295867443d3e92297733e816ea62a588e8dde8; isolated functional checkout.
Original paused022 remains untouched. No security investigation or remediation.

## Functional gap and contract

Saved Calculation plans offered only two-quantity operations. Two actual Gateway
aggregate create/confirmation regressions returned404 before this implementation.
POST/GET /api/v2/research/plans/:id/aggregations now execute/save and cursor-page
immutable series results. Native Pair/Series controls preserve both unsaved forms.
The actual Research page/client/Gateway connect to the real PostgreSQL contract;
transport browser fixtures simulate only the database peer, not arithmetic.

SUM, COUNT, AVERAGE, MEDIAN, MINIMUM, MAXIMUM, WEIGHTED_AVERAGE, RANK and
DESCRIPTIVE_STATISTICS use exact numeric inputs and explicit rational half-even
rounding. Statistics are the adopted retained engine's five metrics: count,
minimum, maximum, average, median. Variance or inference is not claimed. Ranked
rows retain unrounded lexical input values, stable input indices/positions and
references. Weighted calculations require nonnegative aligned weights and positive
included weight in every group; no model/JS floating-point arithmetic is used.

Explicit REJECT/EXCLUDE policies preserve null input positions, included/excluded
counts and included-only lineage. No zero filling or silent missing-value removal.
Grouping keeps at most100 explicit labels; units must match within each included
group, not across different groups. Inputs, weights, expressions, units, precision,
references, ownership, plan and results persist atomically. Same-key retry restores
the same immutable record; altered input conflicts, including cross-kind key reuse.

The forward migration adds a kind field to existing calculation storage; binary
v1 lists filter aggregate rows and hide the new internal field. Both kinds share
100records/plan,1000/workspace and10MiB/workspace limits. Decimal text has128digit
mantissa/range bounds and0..18 output places. Requests are additionally bounded by
40,000 formatted input bytes,100groups and128,000 result-group bytes; the10,000row
ceiling is not a promise that10,000large rows fit the smaller byte budget.

Series UI supports explicit weights/groups/missing policy, add/remove with focus
restoration, duplicate-submit prevention, preserved input/key after unconfirmed
save, reload, cursor pagination, copying inputs without execution, rank-row paging,
read-only roles, and ordinary errors. Receipt checks verify all groups/counts/
excluded indices/units/references/rank metadata, not just a numeric display.
References remain CALLER_ASSERTED_NOT_VERIFIED; results need independent review.
No source support, complete CALCULATION mode or full research execution is implied.

## Fresh evidence and boundaries

Actual rootless PostgreSQL17.11/pgvector0.8.7 passes nine operation assertions,
756 grouped/missing/precision/sign/large-value comparisons against the retained
Python Decimal engine,196 unchanged binary parity cases, both concurrent retry
tests, cursor completeness/disjointness, shared capacity and replay at capacity,
and63table116function backup/restore. These use disposable synthetic fixtures only.

Initial412frontend tests and14 desktop/mobile light/dark browser journeys pass;
the form-preserving Pair/Series regression brings the frontend total413.631backend
plus10subtests and95script tests pass. Final checks/builds/exact source recovery/CI
must be bound in external receipts; these source-time notes are not future PASS.
The first typecheck exposed typed mock-call indexing and an invalid Testing Library
option; lint caught a callback mistakenly named like a hook. Corrected fixtures/
names preserve all assertions and checks. No thresholds/gates/timeouts weakened.
One later full unit run overlapping the OpenNext build timed out a new UI test
at its unchanged5second bound; the next serial full run passes413/413. Preserve
that timing failure and require fresh recovered dependency/test execution too;
do not infer a production cause or accept a warm isolated retry as full proof.

Fresh Chrome can read the actual older candidate again. Settings loads with Gateway
reachable; Evidence OS still shows foundation/declaration-only products. Direct
/research displays Cloudflare1101, ray a4ad00557b2c5412 at2026-10-15T07:09:58Z.
This is a reproduced deployment failure, not corrected by local test success.
Older deployment/runtime identity and logs need verification before authorized
rollout; no deployment or hosted migration is performed to conceal the drift.
Cloudflare dashboard is presently signed out. Account-owner sign-in was requested
for read-only source/configuration/log inspection; this is not rollout approval.

Existing025foundation38691267091 image/runtime116277595894 and required summary
116284389446 now FAILED; native verification and frontend/DB passed. Findings
NOT_READ_IN_FUNCTIONAL_SCOPE. Preserve the unsuppressed gate; do not investigate
or remediate it here. PR12 stays draft/unmerged; protected main/release unchanged.

CLI2.121.0 generated20261015063813_research_aggregate_execution.sql. Neither025
nor026 is approved/applied hosted.024 exact rehearsal-only schema approval is
fulfilled and cannot be reused. No new identities, private hosted operations,
provider processing, customer/destructive action, paid product or production.

## Continued accepted work

All224 exact definitions, ten connected products, twelve research modes and400+125
quality remain intact and incomplete. Next: authoritative evidence-backed numeric
inputs/conversions/dates and review, durable complete research execution/progress/
cancel/resume/results, the remaining product journeys and representative quality.
Paused022, failed required image gate, two-user OAuth/private acceptance, lifecycle/
independent erasure, rights/budgets/canonical source-schema-origin and approved
rollout/rollback remain separate release prerequisites. This is a bounded feature
checkpoint, not PRODUCTION_READY or permission to stop independent engineering.

Engine references: https://www.postgresql.org/docs/17/datatype-numeric.html and
https://www.postgresql.org/docs/17/functions-math.html . No new dependency or
change to the retained Python arithmetic engine.
