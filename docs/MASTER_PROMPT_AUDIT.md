# V6 master-prompt completion audit

Status: `PARTIAL_NOT_COMPLETE`

Audited against **NEXUSRAG MASTER IMPLEMENTATION PROMPT V6** on
2026-09-20. This report is a merge gate, not a production claim.

## Delivery phases

| Phase | State | Evidence or blocker |
| --- | --- | --- |
| 0 — connected-platform audit | PARTIAL | GitHub, Cloudflare, Supabase, Qdrant, and Gemini were inspected; GitHub environment values cannot be enumerated by the connector and are validated by fail-closed CI instead. |
| 1 — shared foundations | LOCALLY_TESTED | Tenant/version/job/usage/evidence/streaming/deletion contracts and 51-table Supabase schema are present. |
| 2 — Cloudflare preview | PREVIEW_VERIFIED | OpenNext frontend and gateway are deployed; live route and health smoke checks pass. |
| 3 — Supabase | LIVE_STORAGE_ISOLATION_VERIFIED | 51/51 public tables have RLS, 83 public policies and 3 Storage policies exist. A controlled two-identity live rehearsal proved exact-key upload admission, arbitrary-key denial, own-workspace published-object visibility, cross-workspace invisibility, and complete fixture cleanup. Core authority tables remain intentionally service-mediated rather than browser-readable. |
| 4 — Qdrant | PREVIEW_VERIFIED | Disposable create/index/upsert/tenant-and-version query/delete validation passes. |
| 5 — Gemini | PREVIEW_VERIFIED | Bounded synthetic request passes with thinking disabled and no customer data or paid fallback. |
| 6 — Evidence Workbench UI | PREVIEW_VERIFIED | Evidence OS route builds, deploys, passes smoke validation, and has zero automated WCAG 2 A/AA violations. Authenticated product E2E remains incomplete. |
| 7 — findings/reviews/calculations/monitors | LOCALLY_TESTED | Domain and database contracts exist; complete browser workflow is not verified. |
| 8 — provider registry/rights | REVIEWED_FAIL_CLOSED | Current official evidence, conservative client caps, duties, review dates, and evidence URLs are recorded. Zero recurring public providers are enabled; uncertain sources remain `LEGAL_REVIEW` or `REVIEW_REQUIRED`. |
| 9 — terms/quota radar | LOCALLY_TESTED | Review-safe domain behavior exists; recurring monitoring is not deployed end-to-end. |
| 10 — obligation compiler | LOCALLY_TESTED | Review-first obligation model and tests exist; selected-scope end-to-end workflow is incomplete. |
| 11 — procurement graph | PARTIAL | Shared graph schema exists; provider-specific end-to-end product is incomplete. |
| 12 — counterparty graph | PARTIAL | Shared graph and uncertainty contracts exist; end-to-end product is incomplete. |
| 13 — product passport | LOCALLY_TESTED | Deterministic JSON-LD/W3C PROV export and receipt tests pass. |
| 14 — scientific/open-source packs | PARTIAL | Shared evidence foundations exist; both complete product packs are not verified. |
| 15 — Evidence API/MCP | PREVIEW_VERIFIED | Cloudflare now exposes authenticated, workspace-bound, capability-scoped, rate- and result-limited Evidence API reads plus bounded read-only MCP operation discovery/execution. Live OAuth, owner capability discovery, empty-result reads, and cross-workspace denial passed. |
| 16 — evaluation/recovery/release | PARTIAL | CI, migration rehearsal, supply-chain evidence, provider probes, fixed synthetic quality scoring, deployed accessibility scans, public desktop/mobile browser E2E, and committed visual baselines pass. Authenticated product E2E remains incomplete; live canary, rollback, and restore have passed on Preview. |

## Connected-state verification

- GitHub branch: `v6-zero-cost-foundations-clean`; pull request remains draft. The `main` branch is now protected: pull requests, five named required checks, up-to-date branches, conversation resolution, linear history, successful `Preview` deployment, and no administrator bypass are required.
- Vercel and Render deployment files are absent. New commits no longer receive
  the prior Vercel preview check.
- Cloudflare has both the gateway Worker and OpenNext frontend Worker. The
  frontend carries static assets. No custom-domain zone is connected. The
  empty permission-check D1 database was removed after an identity and
  zero-table safety check; D1, KV, R2, and Vectorize now hold no application
  state.
- The intended Supabase project contains 51 public tables; all 51 have RLS.
  There are 83 public policies and 3 Storage policies. Controlled E2E fixtures
  used two synthetic identities and two isolated workspaces, then verified
  zero remaining fixture users, workspaces, and Storage rows. No destructive
  rebuild was attempted.
- Supabase leaked-password protection remains disabled, but Email/password authentication is disabled and the owner explicitly excluded this inactive-path warning from the current Preview gate. GitHub and Google OAuth remain enabled.
- Supabase performance advisor reports unused indexes. This is expected for a
  low-traffic schema and is not sufficient evidence to remove security,
  lifecycle, or query-path indexes.

## Required CI and supply-chain gates

Verified on the feature branch:

- migration integrity and clean local Supabase rehearsal;
- isolated backend regression suite;
- 79 frontend unit tests, lint, typecheck, Next production build, and OpenNext
  bundle;
- Cloudflare compatibility contracts;
- bounded Qdrant and Gemini live validation;
- dependency audit;
- CycloneDX SBOM and licence inventory.
- fixed scoring of all 525 synthetic contract cases, including the committed
  thresholds for retrieval, citations, claim support, abstention, entity
  precision, change alerts, reviewed obligations, calculations, and tenant
  isolation;
- public desktop/mobile Playwright coverage and deployed WCAG 2 A/AA scans.

Not yet verified to the master definition of done:

- full document-ingestion and generated-answer product E2E; live GitHub OAuth, workspace listing/selection, owner capability discovery, bounded Evidence API reads, and cross-workspace denial now pass;
- provider-backed quality scoring beyond the deterministic synthetic contract
  dataset; the 400 labeled and 125 held-out fixtures pass fixed synthetic gates
  but do not establish production retrieval or model quality;
- two-simultaneous-real-OAuth-user browser isolation; service-mediated API denial passes with a real signed-in session, and direct Storage RLS isolation passed earlier with two controlled identities;
- full application-level workspace deletion and authority restore with real authenticated sessions; Cloudflare canary/rollback/restore and controlled fixture deletion have passed;
- recovery of the unavailable historical `R`, `CF`, and `A` text. Per the accountable owner’s 2026-09-21 direction, an explicit best-understanding replacement baseline now defines all 96 entries for Preview; it does not claim to reproduce missing historical wording.

## Current Preview environment

Cloudflare account 2FA is enabled. Supabase Auth’s Site URL and callback now target the Cloudflare preview; the retired Vercel callback is no longer canonical. The authenticated gateway reports `READY`, keeps the service-role JWT only in a Worker secret binding, and exposes no unrestricted or destructive MCP operation.


The credential preflight confirms that `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` are available. Cloudflare Worker origins are derived
from the account at deployment time. These browser-safe GitHub `Preview`
environment variables are configured:

1. `NEXT_PUBLIC_SUPABASE_URL`
2. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Canonical placement and ownership are documented in
`docs/GITHUB_ENVIRONMENTS.md`.

## Merge decision

**DO NOT MERGE.** All current-head GitHub checks are green, but the master
definition of done still has mandatory partial gates. Merge is permitted only
after the remaining requirements are implemented and measured or explicitly
accepted as blockers without using a completion claim.
## Critical-gap continuation — 2026-09-23

Status remains **`PARTIAL_NOT_COMPLETE`**. A local, uncommitted candidate patch now adds fail-closed atomic quota admission/settlement, answer evidence review gating, and bounded resumable text ingestion (`027_metered_operation_admission.sql`, `028_resumable_chunk_staging.sql`, gateway and test changes). The complete Cloudflare test suite passes 40/40 and Wrangler dry-run succeeds.

A further zero-cost local SQL rehearsal now runs against PostgreSQL 17.10 with native `pgcrypto` and `pgvector` 0.8.6. The clean 51-table baseline and candidate migrations 027/028 apply. Real independent local database sessions test reservation contention/no oversubscription, concurrent idempotency replay, settlement replay, and partial/rollback-safe quota behavior. Local synthetic two-identity Storage RLS checks and four-chunk append/replay/finalize/publish checks pass. Reproducible scripts are in `tests/postgres/`.

This advances SQL/locking evidence beyond the earlier PGlite-only check but **does not** prove hosted Supabase Auth/JWT, managed Storage API or role behavior. The local `auth` and `storage` schemas are stand-ins; no Supabase branch was created because the available branch path is not zero-cost. Live migration history still ends at 026; 027/028 remain unapplied. Do not infer that actual Cloudflare, Gemini, or Qdrant account plans/quotas have been verified; Cloudflare billing API authentication failed and Gemini/Qdrant account quota evidence is unavailable.

Remaining merge/release gates: reviewed provider terms/data rights and quota ceilings (budget tables remain empty and metered work therefore fail-closed); account-owner plan/usage verification; real free-tier Worker runtime/subrequest/queue measurements; authenticated two-user upload-to-answer plus tenant denial and delete/export/restore/retry E2E; held-out human-reviewed semantic support evaluation; and the product/release partial phases listed above. No GitHub push, merge, live deployment, provider call or production migration was performed.

## Synthetic gateway E2E continuation — 2026-09-23

Added a provider-free route integration test for synthetic authenticated upload → durable queue message → resumable chunk indexing/publication → fenced Qdrant retrieval → cited chat answer → receipt-verified document deletion. The test runs the actual gateway handlers/Worker job code while all Auth/REST/Storage, Gemini and Qdrant network calls are deterministic local mocks. It verifies the answer remains `REVIEW_REQUIRED`, paid fallback stays false, and deletion removes the synthetic original and vectors only after verification receipts. The full Cloudflare test suite now has 40 passing tests.

This improves local integration coverage only. It does not test genuine OAuth, hosted Supabase, actual providers, real Qdrant, provider budgets or production evaluation, and does not close authenticated product E2E or semantic-quality gates. Status remains `PARTIAL_NOT_COMPLETE`.

### Critical-blocker reductions — local candidate, not deployed

- **Closed at implementation/test level:** bounded resumable text ingestion now uses append/finalize staging, stable vector identity, exact-count-before-publish, and a three-chunk-per-invocation guard. The full mocked upload/index/chat/delete route E2E passes. This is not a claim of real Workers Free request/CPU measurements, live queue redelivery/DLQ behavior, or hosted execution.
- **Closed at database-engine rehearsal level:** candidate migrations 027/028 pass a clean local PostgreSQL 17 + pgvector rehearsal, including independent concurrent reservation/idempotency/settlement sessions. The synthetic Auth/Storage stand-ins do not close the hosted Supabase gate.
- **Still release-blocking:** no zero-cost hosted Supabase branch/environment exists; production contains existing user/workspace/document/storage data and must not be used as a test database. Provider budgets, registry, rights decisions, and terms snapshots are empty, so metered operations must remain fail-closed. Cloudflare account reads are blocked by API authentication. Authentic OAuth/tenant-boundary/recovery E2E, live free-tier measurements, independent semantic-support evaluation, and the remaining product verticals/release work are still open.

The candidate remains local and uncommitted. The branch's existing GitHub checks pass on the unchanged base commit; they have not validated this candidate. Do not push this branch as-is: `.github/workflows/cloudflare-preview-deploy.yml` deploys Cloudflare Preview on push, so a push is a live Preview change, not merely a CI run.
