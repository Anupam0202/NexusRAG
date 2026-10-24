# Finding Creation Replay045

PARTIAL_NOT_COMPLETE. Uncommitted functional correction on saved044source
1f2a86375946987914ce4c01fc86572e1fd5bdd6. No security investigation, hosted change,
provider processing, customer operation, deployment or release acceptance.

## Reproduction And Root Cause

The new real local PostgreSQL test reuses stored production-executor synthetic
research results, then sends two saves through independent database connections
and one sequential retry. Existing workspace serialization and unique create_key
correctly retain one Finding and one version. However, seven paths emit two then
three finding.create events: QUICK_LOOKUP,EVIDENCE_ANSWER,COMPARE,TIMELINE,
CONTRADICTION_ANALYSIS,DEEP_RESEARCH and manual notes. OBLIGATION_ANALYSIS already
emits exactly one because044guarded that handler. The actual before-run fails
at the intended event-count assertion; all mode rows are printed before failure.
This is ordinary misleading audit history, not an attack simulation.

The legacy mode-specific wrappers and generic handler unconditionally insert
the creation event after the idempotent workbench call, even for an existing
create_key. Stable Finding IDs alone never proved truthful audit idempotency.

## Scoped Correction

CLI2.121.0 migration new, after help inspection, scaffolded
20261020123354_finding_creation_audit_replay.sql. Five existing function definitions
are replaced explicitly in a new forward migration. Existing transaction/workspace
serialization, branch validation, current-source rules, signatures, invoker/search
path properties and return semantics are retained. Creation audit insertion now
requires the previously serialized lookup to find no prior Finding. The generic
handler prefetches for manual saves as well as stored research answers. Edit,
share,review and other ordinary mutation events keep existing behavior.

No historical migration/audit/customer data is rewritten. No table,index,trigger,
new routine or caller grant is added. No accepted limits or rights/budgets change.
The new file is LOCAL_ONLY_UNAPPROVED; local test loading is not hosted approval.

Actual frozen044file hashes guard the mechanical definition-copy helper. Its
first unanchored header matched ALTER plus CREATE and failed before any source
edit, leaving the scaffold empty; the helper now anchors CREATE and retains exact
occurrence/hash assertions. This failed preparation is not application evidence.
The final explicit SQL is the runtime artifact; the helper is not a dependency.

## Verification State

Before: ordinary-audit-before-01.log fails with all eight paths enumerated.
The fixture mode inventory and eight-path label were corrected during preparation
before that test executed; the actual failing event counts are unchanged.
After: whole owning SQL/production-executor/concurrency/backup-restore PASS at
2026-10-20T12:38:02Z,65tables160functions. All eight paths preserve revision2,
later authored note,original generated content/lineage, one creation event and
a normal edit event. Scratch cluster stopped; no hosted/provider operation.
Fresh owning suites/review/source publication/recovery remain required; no old
green count is inherited as current acceptance.

Later source045-final14checks PASS12:49:01Z:631backend+10subtests/669Gateway/
519frontend/57isolated/102scripts,lint/typecheck/foundation/baseline,Next/OpenNext
26routes and four actual native probes. Post-build full controlled browser
122PASS/4intentional skips at12:54:31Z,owned server stopped; not actual hosted
OAuth/private acceptance. Manual functional review confirms exact five-definition
copy apart from dispatch-preserving audit guards and serialized generic prelookup;
no independent-review clearance claimed. Current-tree CI,source save/publication
and full NEW dependency/recovery still required.
SQLSHA2567190fb8f7afecb7bda20954f3305c7591c84a05b7a2e8be0fb0aa4c4fe000c9d.
Final external BATCH045_HANDOFF/frozen receipts govern later milestones only.

First owning script suite fails102tests/one failure because the new migration was
not yet in database CI's explicit copy list. Copy and required ordinary-result
marker added, keeping the guard and existing required gates unchanged. This
failed packaging receipt remains; the source checks are rerun afterward.

The separate owner's exact044rehearsal approval was fulfilled once as registry
20261020124410/research_obligation_execution;37function/sixconstraint equality
to fresh frozen044reference, prior35records unchanged. No045approval/application
or hosted private workflow is implied. See the separate044rehearsal addendum.

## Compatibility References

- https://supabase.com/docs/guides/deployment/database-migrations
- https://www.postgresql.org/docs/17/sql-createfunction.html
- https://supabase.com/changelog.md (fetched read-only; markdown browser adapter
  unsupported, ordinary HTTP read succeeded; no new hosted feature used).
- https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes

Existing local PostgreSQL17.11 is a fixture environment, not hosted17.6acceptance.
No new platform schema-diff/advisor or security audit is part of this task.

## Remaining Scope

All224requirements/tenproducts/twelvemodes/400+125quality remain accepted and
incomplete. Global run-storage/free budgets, constrained plans/register/products,
real approved private/provider workflows, independent lifecycle/erasure, active
old source/schema/1101, canonical origin/rights/budgets/rollout/rollback and paused022
plus excluded failed release prerequisites remain. This narrow fix cannot clear
those gates. Complete044source/evidence recovery remains frozen and unchanged.
