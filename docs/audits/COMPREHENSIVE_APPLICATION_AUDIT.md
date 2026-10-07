# Comprehensive application audit

Status: **PARTIAL_NOT_COMPLETE — locally tested implementation; not production verified**

This receipt supersedes historical status claims only where it records a fresh observation. It does not certify a complete product, production release, provider rights, or absence of all defects.

## Current completion execution — authoritative scope

Starting main identity: `f508abb7ebcef6b8b1992ae27c898f08256dc78a`. Full history and the complete tracked-file byte/import inventory were inspected; focused executable review covered authorization, ingestion/retrieval/lifecycle, SQL, UI state and deployment paths. An inventory is not a claim that every line received manual review.

### Implemented and traced workflows

| Workflow | UI → API → durable authority | Acceptance evidence / boundary |
| --- | --- | --- |
| Private finding create/edit/read | `/findings` → `/api/v2/findings` → service-only `nexus_finding`, existing private-record authorization, immutable revisions | Gateway tests; UI regression tests; local PostgreSQL two-identity stand-ins. No real OAuth isolation claim. |
| Explicit sharing / revocation / independent review | Member picker and read/contribute selection → finding share/unshare/review → participants and revision-bound review | Owner-only sharing, revoked-read denial, self-review denial, stale revision and fresh role checks. |
| Portable authored-note export | Workbench JSON-LD download → export endpoint → hashed durable export receipt | Exact current record/review comparison and tampered-hash denial. Source-backed export stays rights-blocked. This is not standards or legal certification. |
| Workspace creation | Name-only creation → actor-scoped deterministic slug/idempotency → atomic workspace/member/settings/audit | Payload replay/conflict and Unicode key regressions. |
| Existing-account member management | Members settings → service-only `nexus_manage_member` → fresh role checks and capability-revision trigger | Owner/admin invariants; demotion fences; last-owner protection; confirmed Auth identity only. Invitations remain unimplemented. |
| Identity transitions | Auth/workspace keyed pages and captured request context → late-response fences | Findings, privacy and member pages do not reuse prior-identity private state. |
| Honest document inventory | Document list → keyset pagination → authorized active workspace | No sampled list labeled an exact inventory; duplicate/non-progress page failures stay visible. |
| Honest readiness and advertised API | Correct route titles / sign-in state; private-record MCP reads | CONFIGURED/NOT_PROBED is not READY. Unsupported product aliases fail rather than returning unrelated records. |
| Deletion safety | Existing tombstone → explicitly blocked cleanup | Removed fabricated derived-data/remote-write receipts. Verified complete document cleanup is still required implementation, not a passed gate. |

### Database and deployment boundary

Forward migrations 035 and 036 were replayed against a disposable local PostgreSQL 17 database, then applied only to the existing isolated rehearsal project `ukgjygzfhyvnrsecdcuu`. Production project `fcjaomiceajcdownarel` was not modified. The clean baseline and historical migrations were not rewritten. Migration 035's applied SHA256 remains `23828d242284731128359122fdaaba247dd272c65822c32a5d6552a90658375f`.

036 fixes the initially detected profile-email authority defect using a narrow service-only, fixed-search-path resolver of confirmed `auth.users` identities. Hosted metadata confirmed version 036 and denied anon/authenticated execution of that resolver. Local Auth/Storage tables are explicitly stand-ins, not hosted OAuth/Storage implementations.

The protected provider workflow had path filters that omitted docs/visual-only candidate heads. Those filters were removed while retaining trusted-branch-only secret access and non-cancellable disposable cleanup; a regression test prevents missing exact-head provider contexts.

Candidate mapping was revalidated: dedicated candidate frontend/gateway Workers, candidate ingestion queue and rehearsal Supabase project. Existing candidate deployment/version IDs were retained externally for rollback; no live Worker, queue, database, object or production record was deleted. At this source publication boundary, live Workers still predate the changes and observed log redaction is false. A final target review found the candidate gateway configuration also lacked the redaction flag present in the other configs; it was corrected, and candidate resolution now rejects either Worker when sensitive-query redaction is omitted or false. Deployment is not yet claimed.

Sensitive candidate credential headers are passed through a shell-owned curl configuration descriptor rather than process arguments. The isolated preview workflow now fails unless schema 036 is present, publishes non-secret exact-source identity in gateway health and a generated frontend asset, checks both deployed identities, and runs public Chromium/mobile-emulation plus Firefox/WebKit functional acceptance. Generated build metadata is ignored, not committed. Production cutover still needs explicit owner approval and its genuine acceptance gates.

### Fresh verification

- Gateway: 102 passed; no skips.
- Frontend: 106 unit tests in 25 files; ESLint and TypeScript passed.
- Public Chromium desktop / Pixel 7 emulation: 42 smoke and visual checks passed, including keyboard, overflow and reduced motion.
- Real Firefox engine: 19 public functional checks passed. WebKit cannot launch on this Amazon Linux host because compatible system libraries are missing; Ubuntu CI now runs that engine fail closed. No WebKit pass is claimed here.
- Only the two Evidence OS screenshot baselines were updated after inspecting the received desktop/mobile images: new functional workbench/library links, correct route title, honest sign-in and incomplete-readiness states. Original home baselines and all screenshot tolerances remain unchanged.
- Complete network-denied backend suite: 275 passed plus 10 subtests. Isolated backend suite: 57 passed.
- Local PostgreSQL: private-finding authorization/revocation, role races, confirmed identity/spoofed profile tests, concurrent quota/account admission, extraction and Storage-policy stand-ins passed. Backup/restore passed with 59 local tables and 87 public functions (three tables are Auth/Storage stand-ins).
- Immutable baseline and migration-integrity checks passed; whitespace and workflow YAML checks passed.
- The isolated installed Python test environment audit reported no known vulnerabilities after upgrading vulnerable pip itself. This is not a heavyweight production-image audit.
- GitHub secret scanning is unavailable because Advanced Security is not enabled. A free local `detect-secrets` changed-source scan flagged three candidates: a runtime variable assignment and two explicit synthetic test keys, reviewed as non-secrets. No suppressions or paid feature were enabled.
- Docker source now fails model-prefetch errors, excludes secrets/runtime files and drops root privileges, but no Docker engine/image build or complete heavyweight dependency audit has been performed. The image is not an active Cloudflare runtime.

Fresh `npm ci --ignore-scripts`, ESLint, 106 unit tests, TypeScript, Next.js production build and OpenNext Cloudflare build passed; 25 required prerendered HTML assets were published locally. The full locked npm audit reports zero info/low/moderate/high/critical findings. Exact-head CI must independently repeat these gates. Passing source checks is not deployment or product acceptance.

### Required work still incomplete — not optional future phases

The ten connected Evidence Intelligence products remain partial foundations, not ten finished user workflows. Durable research orchestration, deployed connector activation/rights, obligations/procurement/counterparty/passport/science/software/risk workflows, graph/review/monitor productivity, source-backed exports, true progressive generation, parity-safe advanced filters, retention/legal hold/workspace erasure, verified document/remote-write cleanup and representative held-out quality evaluation remain required implementation/acceptance work.

Specific external prerequisites: two distinct authorized OAuth identities/test sessions for live browser isolation; workspace-owner/provider processing and rights/budget approval before synthetic metered acceptance; rights/access decisions for connectors that lack approval; production authorization and approved release policy before production cutover. No customer document is authorized as a provider-availability fixture. Synthetic fixture inventory does not satisfy the 400 labeled / 125 held-out source-entailment quality gates.

The historic integrated audit below remains evidence of its earlier snapshot only. Its test counts and absent-member-management statements are superseded by this section where explicitly stated; it must not be treated as the current deployed identity.

## Earlier integrated audit — historical evidence

### Scope and evidence

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
| Full npm audit | Zero reported findings after validated tooling migration |
| Isolated installed Python dependency audit after upgrading the test environment's pip | Zero known findings; not a full heavyweight production-image audit |

Browser regression evidence and exact commands are retained with the local audit logs. Two-real-user isolation is **not** claimed: only one OAuth identity was used. No actual provider-backed upload/chat, destructive retention, workspace erasure, paid service, DNS change, or production deployment was performed in this audit.

## Remaining release blockers — do not hide or bypass these

### P0 / security gate

- **Resolved tooling gate:** Tailwind 4 with its maintained PostCSS plugin and compatible class-merging utility replaces the affected Tailwind 3 watcher chain. An explicit maintained ESLint stack retains TypeScript, React, hooks, and accessibility checks without the affected Next plugin fast-glob dependency. Legacy colors, shadows, radii, and sRGB gradient behavior are preserved; the original desktop/mobile visual baselines pass unchanged. The fresh full npm audit has zero findings. No advisory ignores or fictitious patched versions were added.
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

## Repository cleanup

Four obsolete branches were backed up in a verified external git bundle before deletion: the tree-identical release branch, the squash-integrated PR 2 and PR 3 branches, and the abandoned PR 1 legacy branch. The external backup is not committed to the application repository. Candidate deployment now accepts only an explicit manual dispatch on main and remains restricted to the isolated rehearsal backend; retired branch triggers have been removed. An unreferenced legacy frontend Worker wrapper, its unused alternate configuration, and its obsolete type shim were removed; the active OpenNext candidate/PR3/production configurations remain. Required database rehearsal runs on every PR, instead of leaving unrelated changes permanently pending. Its uniquely named protected summary always executes and fails unless the PostgreSQL migration/concurrency/backup/restore job succeeds; upstream failures cannot turn into an accepted skipped summary. Live provider probes remain manual/trusted-push only; pull-request code is never given provider credentials. Live preview Workers and database resources were not deleted. Historical migration and audit evidence is retained rather than misclassified as application clutter.

## Live provider recovery during cleanup

The exact release-head Gemini probe passed. Qdrant initially failed twice with a connection reset. Authenticated Qdrant Cloud inspection identified the existing NexusRAG Free-tier cluster as suspended for inactivity. Reactivated that same cluster without a paid upgrade, new cluster, key rotation, endpoint overwrite, or customer-data fixture. The console then reported Healthy, and the unchanged bounded Qdrant tenant/version isolation probe passed with temporary collection cleanup. Free-tier inactivity suspension remains an operational availability risk, not a resolved production SLA.

Trusted release-branch push probes remain enabled alongside main and manual dispatch so the protected provider check is reported before main integration. Pull-request code still never receives provider credentials; retired branch-specific triggers remain removed.

## Publication boundary

The user authorized integration of reviewed code and redundant branch cleanup. Merge only after exact-head required checks pass; do not trigger production dispatch or weaken protections to complete repository cleanup. Remaining application and operational blockers above still prevent a production-readiness claim. Secrets, browser session files, runtime artifacts, and audit snapshots containing account/session data must not be committed.
