# Deployment Status

Status: `PARTIAL_NOT_COMPLETE`

This document records only verified deployment facts. It is not a production-readiness claim.

## Verified repository state

- The active implementation branch is `v6-zero-cost-foundations-clean`.
- Committed deployment-account and Supabase project identifiers have been removed from the current branch tree.
- The repository contains Cloudflare gateway foundations and offline compatibility tests.
- The repository contains zero-cost admission, rights, lifecycle, Storage authorization, service-table denial, and function-execution hardening contracts.
- The migration verifier still references intentionally retired historical migration files. A new self-contained migration-001 baseline has not yet been validated or published.
- Evaluation fixtures contain at least 400 labeled and 125 held-out cases, but the quality gates have not been executed.

## Connected-platform state

- The intended Supabase project has been confirmed separately through protected connected tooling. Project identifiers must not be committed to this repository.
- The existing Supabase application has not yet been destructively rebuilt from a clean baseline.
- The Cloudflare account currently has a hardened preview gateway, but Cloudflare frontend parity, canary, rollback, and restore verification remain incomplete.
- Qdrant authenticated validation is blocked until a real API token is supplied through a protected secret surface.
- Gemini bounded validation is blocked until credentials are supplied through a protected secret surface.
- Vercel and Render remain active compatibility paths. They must not be removed until Cloudflare parity and rollback gates pass.

## Required next gates

1. Build and statically validate a self-contained migration-001 baseline with no dependency on retired migration files.
2. Rehearse the baseline against a disposable PostgreSQL/Supabase-compatible environment.
3. Rebuild the authorized Supabase project only after the rehearsal passes.
4. Verify RLS, private Storage, grants, function execution, Auth emptiness, and deletion behavior after rebuild.
5. Regenerate database client types from the rebuilt schema.
6. Complete Cloudflare frontend and gateway parity, then test canary and rollback.
7. Run bounded Qdrant and Gemini validations using protected credentials.
8. Execute evaluation, security, accessibility, recovery, and end-to-end product gates.
9. Remove Vercel and Render from active production paths only after replacement gates pass.

## Safety boundaries

- Do not commit service URLs, project identifiers, secrets, personal email addresses, user records, or Storage object names.
- Do not claim `PREVIEW_VERIFIED` or `PRODUCTION_VERIFIED` while required gates are missing.
- Do not merge, release, change DNS, enable paid usage, or remove rollback paths without separate authorization.
