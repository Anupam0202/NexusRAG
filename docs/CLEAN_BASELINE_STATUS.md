# Clean Supabase baseline status

Status: `CANDIDATE_NOT_APPLIED`

The reviewed migration-001 candidate is published on this branch. Publication does not mean that the migration has been executed, rehearsed against PostgreSQL, or applied to production.

## Candidate identity

- Path: `supabase/baseline/001_v6_zero_cost_baseline.sql`
- SHA-256: `a024f96282cdd2cce91290082a5e88c5abb9cb23c5496c95cf2cec200d1813de`
- Size: 230,273 bytes
- Lines: 2,311
- Profile: `ZERO_COST_LOW_TRAFFIC`
- `disposable_rehearsal_passed: false`
- `production_applied: false`

## Reviewed inventory

- 51 public tables
- 600 columns
- 267 constraints, including 89 foreign keys
- 172 indexes
- 76 functions
- 14 application triggers
- 83 public policies
- 3 Storage policies
- 35 restrictive service-table deny policies

## Completed checks

- Deterministic builder output
- Baseline SHA-256, byte-count, and line-count integrity
- Catalog object-name uniqueness
- Foreign-key table and column references
- Index, policy, and trigger target references
- RLS enabled for all reviewed public tables
- Fixed search paths for all reviewed functions
- No anonymous routine grants
- No direct authenticated-role grants on public authority tables
- No dependency on retired migration sources 014/015–022
- Privacy and credential-pattern scan
- One-time GitHub reconstruction and verification job

## Blocking gates

1. Require the normal migration-integrity and required-foundation CI jobs to pass on the published SQL.
2. Execute the baseline in disposable, genuinely zero-cost PostgreSQL/Supabase-compatible infrastructure.
3. Verify schema objects, extensions, grants, RLS, policies, function execution, private Storage, and deletion behavior after execution.
4. Only then perform the separately authorized clean Supabase erase/rebuild.

A disposable Supabase branch was not created because the quoted branch price was `$0.01344/hour` and the user selected zero-cost-only execution. This is a deliberate safety and cost-control decision.

## Production safety

No production schema or data was modified while generating, publishing, or statically validating this candidate. No merge, release, DNS cutover, paid usage, or production-launch claim is authorized by this document.
