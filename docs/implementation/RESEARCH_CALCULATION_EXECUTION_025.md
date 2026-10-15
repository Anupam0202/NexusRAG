# Deterministic calculation worksheet: batch025

PARTIAL_NOT_COMPLETE. Base70593cb945009148343b87bb394b0506d9a3bed4,
treeb4e50c7ca7e8322811063b5d2cf3e0de7c1cd878. Functional isolated checkout only;
original17paused022paths/551working-source entries remain untouched.

## Actual gap and implementation

Saved CALCULATION plans had no executable UI/Gateway journey: three ordinary
create/receipt/precision regressions returned404 before correction. New
POST/GET /api/v2/research/plans/:id/calculations executes and reads immutable
calculation receipts through existing workbench context and role patterns.

The actual PostgreSQL numeric engine computes ADD, SUBTRACT, DIFFERENCE, MULTIPLY,
DIVIDE, RATIO and PERCENT_CHANGE; no model arithmetic, paid/provider call, JS binary
floating arithmetic or new dependency. Exact integer div/mod on the scaled rational
implements half-even final rounding without approximating the quotient first.
Inputs are decimal strings (not JSON numbers), bounded to128mantissa digits,
exponent/magnitude range, units/references and0..18decimal places. Undefined zero
denominators and incompatible units produce ordinary actionable errors.

Inputs, output string, units, explicit formula, deduplicated ordered reference IDs,
owner/workspace/plan/time and retry identity persist atomically. Same-key retry
recovers the exact record; changed payload conflicts. Limits100calculations/plan,
1000/workspace and10MiB/workspace are enforced before insertion. List is bounded
by the per-plan cap. Current plan remains immutable; only CALCULATION accepts this
worksheet. Result state is calculated, never reviewed/complete research.

The private Research UI accepts both quantities as text, units/references/precision,
executes and saves explicitly, preserves inputs/key on an unconfirmed response,
blocks duplicate submit, reloads stored results and shows formula/inputs/lineage/
rounding/review limitation. Plan details are a native disclosure so mobile users
reach the worksheet without traversing empty fields. Full mode execution is not
implied by a saved calculation; status distinguishes stored plan from worksheet.

Source references are CALLER_ASSERTED_NOT_VERIFIED. There is no claim of
authoritative source extraction, rehydration, numeric entailment, consequential
review, complete CALCULATION mode, aggregates/grouping/ranking/conversions, durable
asynchronous progress/cancel/resume or completion of the other modes/products.

## Verification and retained failures

Actual new rootless PostgreSQL17.11/pgvector0.8.7 tests exact decimals beyond JS
safe integers, seven operations, positive/negative ties, large products, high
precision division, lineage, retry/conflict/reload, ordinary invalid values,
undefined rollback and capacity.196cases compare the real SQL result/unit/formula
with the retained Python Decimal engine. Scientific-notation spelling is normalized
only for formula parity; original lexical spelling remains in persisted inputs.
Two concurrent ordinary retry sessions return one stored identity. Real backup/
restore recovers63tables/111functions. No hosted/OAuth/private-user acceptance.

Production React/page/API/Gateway run in ten desktop/mobile-emulated light/dark
browser journeys: six plan cases and four calculation save/reload/retry cases.
Only Supabase transport is simulated there; fixed arithmetic response is not a
second calculator or SQL durability proof. Real SQL tests are separate. Screenshots
must show the visible result, not only a successful text assertion off-screen.
Fresh385frontend/631backend+10subtests/93scripts and initial447Gateway pass.
Final owning checks/build/recovery/exact CI receipts belong in the external handoff.

Failures retained: original404, hand-counted large-number expected string, formula
scientific-notation spelling, and an initial screenshot framed at the plan heading.
Corrections retain exact-value/formula checks and add visible-result evidence.
Existing required schema inventory adds one table (58to59), changing no assertion,
grant, rate/budget threshold or required image gate. No new security investigation.

CLI2.121.0 generated20261015053618_research_calculation_execution.sql. It is NOT
approved/applied hosted. The fulfilled024approval installed only draft schema in
rehearsalukgjygzfhyvnrsecdcuu, registry20261015052629, with all3bodies/0rows checked.
It does not cover this migration, deployments, new users, customer operations,
production or provider processing. Preserve paused022 and failed required gates.

## Engine references and remaining scope

PostgreSQL's exact numeric and math operators are the calculation engine:
https://www.postgresql.org/docs/17/datatype-numeric.html
https://www.postgresql.org/docs/17/functions-math.html
Numeric round normally uses ties-away-from-zero; explicit integer quotient/remainder
selection is necessary to preserve the adopted half-even result contract.

All224definitions/tenproducts/twelve modes/400+125quality remain intact and unfinished.
Next complete authoritative evidence-backed calculation inputs, aggregate/grouped/
ranked/conversion results and independent review; continue real bounded execution/
progress/cancel/resume/evidence/results for every mode and connected product.
Known paused022/image/private-workflow/lifecycle/rights/budget/source-schema-origin/
rollout/rollback prerequisites are neither investigated here nor waived.
