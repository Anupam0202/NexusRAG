# Supabase Security Verification

Status: `LIVE_STORAGE_ISOLATION_VERIFIED`

Verified: 2026-09-20

## Authority boundary

Supabase remains authoritative for tenant identity, memberships, private-document metadata, evidence records, reviews, provider policy, usage accounting, audit history, and deletion state. Cloudflare coordination stores and Qdrant indexes must not become alternate authorities.

## Exposed-table isolation

Live verification found 51 public tables, with row-level security enabled on all 51. No public-table grants to `anon` or `authenticated` were present at verification time.

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

## Function execution hardening

Live review found three public functions whose default `PUBLIC` execution privilege made them callable by the anonymous role. Migration `025_function_execution_hardening` removed that implicit access and preserved only the required authenticated or service-role contracts.

Verified after migration:

- Anonymous execution is denied for `match_document_chunks`, `set_updated_at`, and `uuid_or_null`.
- Authenticated retrieval remains available for `match_document_chunks` and is still subject to table RLS.
- Authenticated policy-helper execution remains available for `uuid_or_null`.
- `set_updated_at` is service-role executable and remains usable as a trigger function.
- All reviewed security-definer helpers are owned by the database owner and have fixed search paths.
- The private helper schema does not grant usage to the anonymous role.

The source is preserved in `supabase/migrations/025_function_execution_hardening.sql`; its offline contract test is `backend/tests/regressions/test_v6_function_execution_hardening.py`.

## Storage boundary

The `documents` bucket exists and is private. Its live configuration enforces a 25,000,000-byte object limit and a bounded MIME-type allowlist. Three authenticated Storage policies enforce exact allocated-object read/write authorization:

- `nexusrag_documents_select`
- `nexusrag_documents_insert`
- `nexusrag_documents_update`

Client deletion is intentionally unavailable; cleanup is service-mediated and
bounded.

### Controlled live isolation rehearsal

Two synthetic identities and two workspaces were created with reserved E2E
UUIDs. The rehearsal proved:

- an editor/owner can insert only the exact allocated object key;
- an arbitrary object key is rejected with PostgreSQL `42501` by Storage RLS;
- before publication, the exact object is not readable;
- after a service-mediated `ready` version is published, the owning identity
  sees exactly one object;
- the identity from the other workspace sees zero objects;
- cleanup leaves zero synthetic users, workspaces, and Storage object rows.

Core authority tables intentionally have no direct browser grants, so their
isolation is enforced through the service-mediated API boundary rather than
direct Supabase browser reads.

## Migration-source integrity

The live migration history includes migrations 014 through 025. Exact repository sources for 014 and 015–022 are still unavailable. Searches of the current branch, the legacy branch tree, and legacy branch path history found no recoverable copies. Migration integrity therefore remains failed; reconstructed SQL must not be represented as the exact historical source.

## Remaining security warning

Supabase Auth leaked-password protection remains disabled and the advisor warning remains visible. Supabase documents this feature as available only on the Pro plan and above; enabling it would violate the selected zero-cost operating contract without an explicit paid-plan decision. The deployed UI is OAuth-only and does not expose email/password sign-up or sign-in. The Email provider is also disabled in the connected Supabase project; GitHub and Google OAuth remain enabled. The warning is therefore an inactive-path plan limitation, not a cleared finding. If email/password authentication is enabled later or the project moves to Pro, leaked-password protection becomes a mandatory release gate.

Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Remaining validation

- Revoked-membership and stale-authorization fixtures.
- Viewer/editor/admin capability matrix.
- Upload expiry, multipart cleanup, signed-URL expiry, and deletion receipts
  through the deployed application.
- Recovery, restore, and read-only-mode rehearsal.
- Exact historical migration-source recovery or an explicitly approved baseline replacement procedure.

No production-security, compliance, or completion claim is made by this report.
