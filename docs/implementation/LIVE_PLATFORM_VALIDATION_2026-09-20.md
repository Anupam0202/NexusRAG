# Live platform validation — 2026-09-20

Status: `PASS_WITH_REMAINING_PRODUCT_GATES`

## GitHub

- Repository: `Anupam0202/NexusRAG`
- Branch: `v6-zero-cost-foundations-clean`
- Audited head: `701c1fc4d5d27e35770cf0a5bbe43af0b8b5d9d6`
- Pull request 2 remains draft, open, cleanly mergeable, and unmerged.
- All 11 current-head checks reported success: foundation summary,
  Cloudflare compatibility, backend regressions, migration integrity,
  dependency review, evaluation scoring, SBOM/licences, clean Supabase
  rehearsal, frontend validation, Qdrant, and Gemini.
- `main` remains unprotected. No merge or release was performed.

## Cloudflare

- Workers:
  - `nexusrag-v6-frontend-preview` — OpenNext modules and static assets,
    observability enabled.
  - `nexusrag-v6-preview-gateway` — bounded provider-readiness gateway.
- Worker subdomain: `nexusrag-evidence-preview.workers.dev`.
- Homepage, `/evidence-os`, and gateway `/health` return HTTP 200.
- The gateway reports `ZERO_COST_LOW_TRAFFIC`, Qdrant and Gemini configured,
  no paid fallback, and no production-verification claim.
- No custom Worker domain, KV namespace, Vectorize index, or R2 bucket is
  active. R2 is disabled.
- The empty `test-permission-check-invalid` D1 database was confirmed to have
  zero tables and deleted. A follow-up list returned zero D1 databases.

## Supabase

- Project URL: `https://fcjaomiceajcdownarel.supabase.co`.
- 51 public tables have RLS enabled.
- 26 migrations are recorded through
  `025_function_execution_hardening`.
- Security advisor: one accepted operator warning for leaked-password
  protection being disabled.
- Performance advisor: unused-index notices are expected in the empty,
  low-traffic preview and were not used as evidence to remove lifecycle,
  security, or retrieval indexes.
- No Edge Functions are deployed.

### Controlled RLS and Storage rehearsal

The test used two reserved synthetic identities, two workspaces, one allocated
upload, one object row, and one published document version.

| Check | Result |
| --- | --- |
| exact allocated object insert | PASS |
| object invisible before publication | PASS (`0` rows) |
| arbitrary path insert | PASS — denied with `42501` |
| owning identity reads published object | PASS (`1` row) |
| other workspace reads published object | PASS (`0` rows) |
| fixture cleanup | PASS (`0` users, `0` workspaces, `0` objects) |

Authority tables remain service-mediated and intentionally grant no direct
browser access to `authenticated`.

## Local reproducibility

The exact audited head passed:

- migration integrity;
- 54 isolated backend regressions;
- 525-case synthetic contract scoring;
- 20 Cloudflare contract tests;
- frontend lint;
- 79 frontend unit tests;
- TypeScript;
- Next.js production build.

## Remaining non-claims

This validation does not claim production readiness. Remaining gates include
provider-backed authenticated product E2E, provider-backed quality evaluation,
complete current rights evidence for recurring sources, visual-regression
baselines, restore/canary/rollback/deletion rehearsals, complete legacy
register source definitions and traceability, custom-domain/DNS work, branch
protection, merge, and release.