# Comprehensive application audit

Status: **PATCH_VALIDATED_LOCALLY — NOT_PRODUCTION_VERIFIED**

This receipt supersedes historical status claims only where it records a fresh observation. It does not certify a complete product, production release, provider rights, or absence of all defects.

## Scope and evidence

- Full, non-shallow repository history fetched from GitHub, including remote branches; the working tree started from PR #5 (`release/production-dispatch`, `c2dd89e`). Prior local frontend fixes were retained.
- Read the frontend API/auth/session paths, gateway ingestion/retrieval/lifecycle paths, Python API and test configuration, deployment workflows, migration inventory, and outstanding implementation documents.
- Connected GitHub identity matches the repository owner. PR #5 initially had no review threads and its published required checks were successful. These checks predate this patch.
- Browser OAuth sign-in succeeded. Exercised workspace listing, documents, member management, analytics, privacy, and account-key pages on the PR3 preview. No raw provider key was entered, retrieved, or written to source.
- Cloudflare has six preview/candidate Workers, not the two claimed by older receipts. No zones were returned. The PR3 and candidate gateways point at the rehearsal Supabase project. Configured secret names were inspected, not their values.
- Both repository-linked Supabase projects have 56 public tables with RLS enabled. The rehearsal catalog additionally verified zero public Storage buckets and zero public SECURITY DEFINER functions missing an explicit search path. Production migrations include the newer account/BYOK and bounded-pipeline migrations through 034. No schema, user, Storage object, policy, or production record was changed.
- Supabase security advisors report disabled leaked-password protection. Performance advisors on the rehearsal report unused indexes; these were not removed from a low-traffic database merely because they have not yet been used.

## Fixed in this patch

1. Patched Next.js in the existing 16.x major line (resolved 16.4.0), updated compatible Cloudflare tooling, and refreshed vulnerable transitive overrides. The fresh scan originally had 17 findings including a critical Next.js advisory; production-only dependencies now have zero reported npm advisories.
2. Included the earlier Vitest fix and canonical OAuth-provider-order browser regression correction.
3. CORS preflight permits `DELETE`, allowing browser account-key removal while preserving the exact frontend-origin allowlist.
4. First login without a stored workspace binding can resolve an existing membership instead of incorrectly forcing workspace creation. Selection is restricted to the authenticated user's memberships.
5. Workspace and account changes clear cached documents, messages, API-key/quota UI state, and bind chat session identity to the account/workspace pair. Token refresh preserves the current session.
6. Late chat/document-list responses are ignored after the initiating account/workspace context changes.
7. Unsupported advanced retrieval filters and malformed/empty document scope fail before account admission or provider work. They no longer silently broaden a query.
8. Added tenant-scoped member-list, privacy-settings-read, exact-count analytics, and admin-only audit-read endpoints that were missing from the deployed gateway. Unsupported member-management, retention, and workspace-erasure controls are explicitly gated off by these responses instead of presented as working. Unmeasured averages are explicitly marked `NOT_MEASURED`; they are not invented from sampled rows.
9. ZIP decoding checks declared expansion before allocation, bounds streamed decompression even with forged size metadata, and rejects entry overflow rather than silently dropping later files.
10. Non-STOP Gemini document extraction is rejected instead of publishing partial extracted content.
11. Retrieval includes the published index-generation fence and defensively verifies returned document/version/generation payloads. Workspace retrieval no longer drops document IDs after the first 25.
12. Upload UI uses the bounded Worker format allowlist and decimal-byte 10 MB limit; unsupported spreadsheet, GIF, and BMP promises were removed. Unenforced page-count claims were removed.
13. Added query-string redaction to deployment configuration. This takes effect only when the reviewed configuration is deployed.
14. Gateway URL configuration rejects non-loopback HTTP, embedded credentials, query parameters, and fragments before attaching bearer tokens.
15. Full backend tests use synthetic credentials and deterministic offline embeddings. The complete suite has a secret-scrubbing, network-denying runner and is included in the required CI summary.

## Validation

| Check | Result |
| --- | --- |
| Complete Python backend suite, outbound networking denied | 275 passed, 10 subtests passed |
| Backend isolated foundation suite | 57 passed |
| Gateway/Cloudflare suite | 85 passed |
| Frontend unit suite | 96 passed |
| Public desktop/mobile browser and visual suites, synthetic OAuth configuration | 40 passed; existing visual baselines preserved |
| Frontend ESLint / TypeScript | Passed |
| Next.js production build | Passed |
| OpenNext Cloudflare bundle | Passed; 24 prerendered routes materialized |
| Migration/source foundation verification | Passed |
| Workflow YAML and git whitespace checks | Passed |
| npm production-only audit | Zero reported findings |
| Full npm audit | Seven high findings remain in one shared brace/glob tooling chain |
| Isolated installed Python dependency audit after upgrading the test environment's pip | Zero known findings; not a full heavyweight production-image audit |

Browser regression evidence and exact commands are retained with the local audit logs. Two-real-user isolation is **not** claimed: only one OAuth identity was used. No actual provider-backed upload/chat, destructive retention, workspace erasure, paid service, DNS change, or production deployment was performed in this audit.

## Remaining release blockers — do not hide or bypass these

### P0 / security gate

- The published npm `braces` version is still 3.0.3 and is affected by GHSA-vfj7-8cjw-p6xm. Seven high audit entries propagate through Tailwind 3, chokidar, micromatch, fast-glob, and the Next ESLint plugin/config. Blindly accepting npm's suggested Next ESLint downgrade is not compatible with this application. Required dependency-review CI must stay blocking. Resolve through an upstream fixed package or a separately validated replacement/migration of both affected tooling paths; do not add an advisory ignore to produce a green badge.
- Production GitHub environment inspection showed required reviewers disabled, administrator bypass enabled, and deployment branches set to `No restriction`. Establish an explicit operator approval policy and restrict deployments to protected main before release. No repository protection setting was changed during this audit.
- Query-log redaction is currently false on the observed live Workers; the new config must be deployed and checked before claiming mitigation. GitHub/Supabase OAuth callback codes must not be retained in request URL logs.

### P1 / application completeness

- The new routes and fixes need exact-head CI, review, preview deployment, and authenticated verification. Existing deployed preview pages still contain the observed defects until that deployment.
- Member add/update/remove, retention settings mutation/execution, workspace erasure, and sample evaluations remain absent from the bounded gateway. Adding member reads does not complete management. Implement role/owner invariants and durable cleanup/receipt semantics, then validate on synthetic fixtures before exposing these controls as functional.
- Advanced filename/filetype/date/page/metadata retrieval filters are explicitly unsupported by this Worker. Implement both lexical and vector filtering with parity tests before enabling them, rather than removing the fail-closed protection.
- Authenticated two-user E2E requires two real OAuth identities or securely provisioned test sessions and verified cleanup. The legacy password-based isolation test is not aligned with OAuth-only deployment and must not be used as evidence that isolation passed.
- Provider registry, terms acceptance, per-workspace rights, and durable platform budgets are not established simply by the existence of secret bindings. Missing rights/budgets must remain fail closed. Do not send customer documents to Gemini to test availability.
- Current lexical recall/document listing bounds, true streaming, page-accurate OCR provenance, reranking, spreadsheet/native heavy extraction, representative answer-quality evaluation, and the Evidence OS write/review/export surfaces need explicit acceptance work. Passing synthetic contract tests does not establish production answer quality.

### P2 / operations

- Reconcile historical deployment/baseline documents against current inventory rather than silently deleting preview resources.
- Confirm credential scopes/expiration and rotation policy using metadata and a bounded operation; secret-name presence is not proof of validity or least privilege. Existing GitHub secret values were neither exposed nor copied.
- Finish restore/canary/rollback and deletion/retention rehearsals, production-image supply-chain audit, cost/budget verification, and operational alerting.
- Custom-domain launch requires a Cloudflare zone; none is currently available.
- Disabled leaked-password protection remains an advisor warning. Evaluate its relevance to OAuth-only authentication and plan availability; do not enable password authentication or paid services merely to eliminate the warning.

## Publication boundary

Publish this increment as a reviewable, non-production change. Do not merge or trigger production dispatch while these blockers remain. Secrets, browser session files, runtime artifacts, and audit snapshots containing account/session data must not be committed.
