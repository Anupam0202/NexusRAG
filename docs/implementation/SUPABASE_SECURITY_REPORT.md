# Supabase Security Verification

Status: `PARTIAL_NOT_COMPLETE`

Verified: 2026-09-12

## Authority boundary

Supabase remains authoritative for tenant identity, memberships, private-document metadata, evidence records, reviews, provider policy, usage accounting, audit history, and deletion state. Cloudflare coordination stores and Qdrant indexes must not become alternate authorities.

## Explicit service-table isolation

Migration `024_explicit_service_table_denies` was applied after confirming that 35 RLS-enabled authority tables were intentionally service-mediated and had no browser-role grants.

The migration:

- Enables RLS on every listed service-mediated table.
- Creates one restrictive `ALL` policy for `anon` and `authenticated` with `USING (false)` and `WITH CHECK (false)`.
- Revokes all table privileges from `anon` and `authenticated`.
- Fails with `MIGRATION_REQUIRED` when an expected table is absent.
- Leaves server-side capability enforcement and service-role operations unchanged.

Post-migration verification found:

- 35 explicit restrictive client-deny policies.
- Zero browser-role grants on those 35 tables.
- Zero remaining `rls_enabled_no_policy` advisor findings.

The source is preserved in `supabase/migrations/024_explicit_service_table_denies.sql`; its offline contract test is `backend/tests/regressions/test_v6_service_table_denies.py`.

## Storage boundary

The private `documents` bucket remains governed by exact allocated-object authorization. Client deletion is intentionally unavailable; cleanup is service-mediated and bounded. Live cross-workspace fixtures and signed-URL expiry tests are still required before the Storage gate can pass.

## Remaining security warning

Supabase Auth leaked-password protection remains disabled. This gate is unresolved. The application must compensate with strong password requirements, MFA support, and reauthentication for consequential operations, but those controls do not replace the provider warning.

Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Remaining validation

- Authenticated cross-workspace denial fixtures.
- Revoked-membership and stale-authorization fixtures.
- Exact-path Storage success and arbitrary-path denial.
- Viewer/editor/admin capability matrix.
- Upload expiry, multipart cleanup, signed-URL expiry, and deletion receipts.
- Review of security-definer ownership and fixed search paths.
- Recovery, restore, and read-only-mode rehearsal.

No production-security, compliance, or completion claim is made by this report.
