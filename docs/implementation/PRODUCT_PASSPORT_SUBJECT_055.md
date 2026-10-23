# Product Passport Declared Subject - Functional055

PARTIAL_NOT_COMPLETE. This batch completes the declared-identity draft journey,
not Product Passport execution or production acceptance. Base is published054
d70b752c818afbf193645d1b2e1e16c9d743c834/tree5c37d78a809c6c5b99bbc079b2ff53c9f74ec624.
The isolated functional checkout excludes owner-paused022. No new security work,
provider processing, hosted/private/customer/destructive/paid/deployment operation.

## Implemented Contract

Product Passport plans can record an optional typed `passport_subject`: product
identifier/name/version/supplier,128/256/128/256 Unicode characters respectively.
It is caller-declared identity, not a verified identity, certificate or claim.
All four fields are mandatory when the subject is present. Surrounding whitespace
is normalized before save; empty/NUL/over-limit/extra fields and unrelated modes
are ordinary invalid input. The existing aggregate byte/source/mode limits remain.
The new UI requires subject input for a new passport draft. Legacy drafts without
the field remain readable and copyable; no identity is invented or backfilled.
Other modes keep their existing request JSON without the optional field.

The production Research page, typed client, Gateway validator and existing private
JSONB plan persistence preserve this object together. Save confirmation rejects a
dropped or changed product version, including after JSONB key reordering. A copy
gets a new plan identifier and independent subject object; edits do not mutate the
original. An unconfirmed response retains fields and the same retry intent. Reload
recovers the declared identity; long fields wrap without horizontal overflow.

The retained Python API/domain validate and echo the same declared input but still
truthfully report VALIDATED_NOT_PERSISTED/NOT_PERSISTED and execution_supported:false.
They are not falsely described as the Gateway durable implementation.

CLI2.121.0-created local migration20261023123558_research_passport_subject.sql
wraps existing plan-limit validation, retaining the original function/legacy caps.
It validates canonical subject input through the existing service-mediated create
path; it grants no table access and changes no existing stored rows or jobs.
It is NOT installed or approved on hosted Supabase. Existing048Entity approval
is fulfilled once;052Due and this055change require separate exact authorization.
Installation/forward repair must be versioned and backed up before any hosted use.
The original limits function remains available under its explicit predecessor
name; a separately reviewed repair can restore that definition if ever needed.

## Evidence And Limits

Revision2review13:18:29Z:635backend+19subtests and59genuinely dependency-free
isolated tests pass. All4moved/retained method ASTs are identical;production/SQL/
frontend/locks/CI/runners/exclusions are byte-unchanged. First revision complete
779source207c4098...and failed280file evidenceab234a2c...recover into NEW directories.
Corrected source/CI/NEW780source/fresh dependency/evidence recovery are pending.

Revision1 published e89eaa1f/tree1d667ca1 has complete779source recovery,SHA256
207c40989c23cdd26f44c015cad98dc969cbf3c4f28ab0658c0776086213c7c6.
Exact-tree isolated CI FAILS2new API tests due to absent FastAPI/Pydantic. Earlier
local61isolated passes were not dependency-free environment proof. A new stdlib-only
venv reproduces both errors. Revision2 moves those exact methods to the complete
backend suite;59isolated pass without third-party packages. No test assertion,
runner,exclusion or CI dependency change. Current source correction/review/full
backend/CI/NEW recovery are not yet accepted. Failed revision/evidence is retained.

Reviewed12:59:37ZOct23:all17owning/build/native checks pass635backend+19subtests,
703Gateway,575frontend89files,61isolated,110scripts,lint/type/foundation/baseline,
Next/OpenNext26routes,actual gateway fixtures,two lifecycle/five native probes.
176Research browser cases pass,4intentionalSKIP excluded;14cross-client/Gateway
subject vectors and551paused022entries preserved. Exact-tree CI/save/NEW complete
779source/fresh dependency/evidence recovery remain pending,not production proof.

Before: two Gateway and four UI regressions fail for dropped identity/missing
inputs. Initial focused correction passes24Gateway/22client-page tests. Eight
desktop/mobile browser cases pass after correcting a new test's incomplete exact
sentence and adding real theme-CSS assertions before/after reload. The erroneous
browser attempts remain retained; no existing assertion/timeout was weakened.

Real disposable PostgreSQL persists/reads/replays the exact subject, rejects changed
versions under the same key, checks Unicode/bounds/legacy compatibility, confirms
two ordinary concurrent retries create one record, and restores all65tables/
175functions. These are synthetic local SQL tests, not hosted Auth/Storage proof.
The new migration/assertions/concurrency and browser journey are in existing CI.
Later owning/exact-tree/fresh-recovery receipts must supersede provisional counts;
source publication, archive export, CI and NEW recovery are still pending here.

Frozen054fresh verification remains FAILED26PASS/1FAIL. One bounded startup
diagnostic later passed568tests/88original files with unchanged forks/worker count/
isolation/timeouts. Its max acknowledgement was28599ms. This is not root-cause
proof or a fresh recovery retry-to-green. Historical054and current diagnostic
both use Node24.22.1; an inaccurate summary's24.19.0 claim was explicitly withdrawn.
No memory-pressure cause is proven and no unrelated process was stopped.

Current Chrome Cloudflare page control still times out; active logs/bindings/source
correlation are unverified. Rehearsal registry still ends at Entity048. Required
release gates remain failed; no excluded findings logs or manual scans are read.

## Remaining Accepted Product Work

PRODUCT_PASSPORT execution remains explicitly unimplemented. Next connect the
declared subject to bounded60source/12subquestion/eightquery/600second execution,
exact version/chunk anchors, qualified claims/contradictions/expiry/revocation/
gaps, durable cancellation/resume, Findings independent review and reproducible
JSON-LD/W3C-PROV packages/receipts. Complete supplied component/certificate/test/
declaration/obligation/SBOM/licence/VEX workflows without new scans or certification.
Do not treat these new input fields, existing dataclass or an export endpoint as
the finished product. Full224definitions,tenproducts,twelvemodes,400+125quality,
private/lifecycle/rights/budgets/canonical origin/release/rollback remain accepted.

Platform API guidance was checked against current official
[database functions](https://supabase.com/docs/guides/database/functions),
[migration CLI](https://supabase.com/docs/reference/cli/supabase-migration-new)
and [changelog](https://supabase.com/changelog); installed CLI help was inspected.
