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

Status remains **`PARTIAL_NOT_COMPLETE`**. Draft PR #3 (`critical-gaps/v8-remote-validation` → `v6-zero-cost-foundations-clean`) carries the candidate: fail-closed atomic quota admission/settlement, answer evidence review gating, bounded resumable text ingestion, and updated local Supabase CI rehearsal for migrations 027/028. The complete Cloudflare test suite passes 40/40 and Wrangler dry-run succeeds.

A further zero-cost local SQL rehearsal now runs against PostgreSQL 17.10 with native `pgcrypto` and `pgvector` 0.8.6. The clean 51-table baseline and candidate migrations 027/028 apply. Real independent local database sessions test reservation contention/no oversubscription, concurrent idempotency replay, settlement replay, and partial/rollback-safe quota behavior. Local synthetic two-identity Storage RLS checks and four-chunk append/replay/finalize/publish checks pass. Reproducible scripts are in `tests/postgres/`.

The draft PR's clean Supabase CLI/Docker rehearsal also passed with the full local Supabase services and migrations 027/028 applied. This advances compatibility evidence but **does not** prove hosted Supabase project-specific Auth/OAuth, remote Storage or account behavior. No additional hosted project/branch was created; the user declined a separate Free test project and the available branch costs money. Live migration history still ends at 026; 027/028 remain unapplied.

Read-only account verification after the owner signed in: Cloudflare shows an active **Workers Free** subscription; dashboard usage is 1,094/100,000 Worker requests today, 107/200,000 observability events, and 3/10,000 Queue operations today. The current gateway reports 1.34k invocations and 971 aggregate subrequests in 24 hours, zero errors, zero CPU-limit errors, and 770 µs CPU time. The ingestion Queue shows 3 messages enqueued/acknowledged, zero retries, zero backlog, an existing inactive DLQ, and 24-hour retention. Qdrant shows a healthy Free cluster using 2.53 MiB/4 GiB disk, 132.37 MiB/1 GiB RAM, and 0.04/0.5 vCPU. These are existing deployed-version/account measurements, not candidate-code validation or proof of per-invocation subrequest maxima. Cloudflare MCP still returns authentication error `10000`, but the signed-in dashboard was readable.

The live gateway health endpoint reports Gemini and Qdrant credentials configured and paid fallback false. Gemini's AI Studio project tier/usage remains unverified: the sign-in page is presenting a saved Google identity that has not been confirmed as the owner of the API project. No Gemini request was made. Do not submit customer data or seed provider policies/budgets until the account and rights are reviewed.

All 9 GitHub PR checks passed on the candidate code commit `84fe768`, including clean local Supabase migration rehearsal, frontend, backend, migration integrity, and Cloudflare compatibility. On the later audit-only head `2fd270b`, 8/9 checks pass; the repeated Supabase rehearsal failed before starting because GitHub Actions could not pull `ghcr.io/supabase/postgres:17.6.1.167`. That failed attempt executed no migration SQL; the earlier successful rehearsal used the same candidate migrations. Remaining merge/release gates: reviewed provider terms/data rights and quota ceilings (budget tables remain empty and metered work therefore fail-closed); Gemini project tier/usage and privacy approval; candidate-code Preview runtime/subrequest/queue rehearsal; authenticated two-user upload-to-answer plus tenant denial and delete/export/restore/retry E2E; held-out human-reviewed semantic support evaluation; and the product/release partial phases listed above. No merge, Cloudflare deployment, metered provider call or production migration was performed.

## Synthetic gateway E2E continuation — 2026-09-23

Added a provider-free route integration test for synthetic authenticated upload → durable queue message → resumable chunk indexing/publication → fenced Qdrant retrieval → cited chat answer → receipt-verified document deletion. The test runs the actual gateway handlers/Worker job code while all Auth/REST/Storage, Gemini and Qdrant network calls are deterministic local mocks. It verifies the answer remains `REVIEW_REQUIRED`, paid fallback stays false, and deletion removes the synthetic original and vectors only after verification receipts. The full Cloudflare test suite now has 40 passing tests.

This improves local integration coverage only. It does not test genuine OAuth, hosted Supabase, actual providers, real Qdrant, provider budgets or production evaluation, and does not close authenticated product E2E or semantic-quality gates. Status remains `PARTIAL_NOT_COMPLETE`.

A further provider-free regression drives a near-capacity 385-chunk plain-text document through 129 sequential three-chunk Queue continuations. Every mocked Worker invocation remains below 50 outbound fetches, vector IDs remain stable, staged content is exact, and publication waits for all 385 verified vectors. This closes the bounded text-batch state machine through its current 400-chunk cap at mock level only; it does not measure actual Workers CPU/request usage, live Queue retries/DLQ, or non-text ingestion above three chunks.

### Critical-blocker reductions — local candidate, not deployed

- **Closed at implementation/test level:** bounded resumable text ingestion now uses append/finalize staging, stable vector identity, exact-count-before-publish, and a three-chunk-per-invocation guard. The full mocked upload/index/chat/delete route E2E passes. This is not a claim of real Workers Free request/CPU measurements, live queue redelivery/DLQ behavior, or hosted execution.
- **Closed at database-engine rehearsal level:** candidate migrations 027/028 pass a clean local PostgreSQL 17 + pgvector rehearsal, including independent concurrent reservation/idempotency/settlement sessions. The synthetic Auth/Storage stand-ins do not close the hosted Supabase gate.
- **Still release-blocking:** no zero-cost hosted Supabase branch/environment exists; production contains existing user/workspace/document/storage data and must not be used as a test database. Provider budgets, registry, rights decisions, and terms snapshots are empty, so metered operations must remain fail-closed. Cloudflare and Qdrant current plans/usage are verified as Free, but the candidate code is not deployed and Gemini project tier/usage is unverified. Authentic OAuth/tenant-boundary/recovery E2E, candidate-version runtime measurements, independent semantic-support evaluation, and the remaining product verticals/release work are still open.

The candidate is in draft PR #3 on an isolated validation branch, targeting the feature branch rather than `main` or the named Preview deployment branch. Earlier full-stack attempts failed before SQL because public container registries returned `toomanyrequests`; the registry-independent PostgreSQL 17/pgvector CI installed packages and created the isolated database cluster, then found the workspace checkout was not readable to the `postgres` OS user. The workflow now copies only the required rehearsal SQL/scripts into a temporary world-readable directory, executes the harness as `postgres`, and removes the temporary database/source on exit. The same full rehearsal passed locally on PostgreSQL 17.10. It covers the clean baseline, migrations, Storage-policy stand-ins, batching, and independent concurrency; see [PostgreSQL APT](https://wiki.postgresql.org/wiki/Apt) and [pgvector](https://github.com/pgvector/pgvector). This validates PostgreSQL behavior, not Supabase Auth/Storage services or hosted project behavior. CI does not deploy Cloudflare or call live providers. Do not merge yet: hosted Supabase/Auth behavior, Gemini plan/rights/privacy/budget, candidate runtime, authenticated product E2E, semantic quality, and product/release gates remain open.

## Critical-gaps continuation — 2026-09-23, latest local validation

**Status remains `PARTIAL_NOT_COMPLETE`; the candidate is not deployed.** This update supersedes the earlier progress counts above. The local candidate now adds migration 029 and durable extraction staging, so large text and bounded PDF/OCR ingestion can resume without re-reading the source or re-running extraction on every three-chunk Queue continuation.

- Local Cloudflare tests: **42/42 passed**. The source-foundation integrity check passed, and Wrangler `deploy --dry-run` successfully bundled the gateway (85.53 KiB, 19.48 KiB gzip); this was a dry run, not a deployment.
- A fresh local PostgreSQL 17.10 + pgvector rehearsal passed the clean baseline and migrations 027/028/029, including quota concurrency/idempotency/settlement, append/replay/publish, durable extraction store/read/replay, terminal-state/TTL cleanup, and synthetic Storage policy assertions. These are local DB-engine tests; synthetic Auth/Storage stand-ins do not establish hosted Supabase behavior.
- The provider-free 385-chunk text regression still passes across 129 bounded continuations. A PDF/OCR regression now demonstrates a single source-storage read and a single extraction/provider invocation across continuations; staged chunks are served in groups of at most three and purged on terminal status. Migration 029 bounds cached extraction to 400 chunks/4 MiB and 24-hour expiry. It stores extracted document text temporarily in service-role-only Supabase tables; this needs privacy/retention review before any hosted application.
- The candidate was pushed only to isolated draft PR #3 (`critical-gaps/v8-remote-validation`) at code head `dc86a79`; its initial current-head run passed 9/9 GitHub checks, including PostgreSQL migration/concurrency rehearsal and Cloudflare compatibility. Keep it draft and unmerged pending the remaining hosted, provider, runtime, and product gates. No production/hosted migration, Cloudflare deploy, external provider call, DNS change, or paid resource has occurred.

### Remaining blockers and next safe steps

1. **Hosted Supabase/Auth/Storage rehearsal remains open.** No zero-cost hosted disposable project/branch is available; production contains user data and is not a test target. The locally rehearsed PostgreSQL migration and synthetic Storage tests are not a substitute for hosted service claims, OAuth, Storage behavior, or independent hosted transactions. Do not create a billed branch or alter production without explicit authorization.
2. **Provider policy remains blocked by account-owner evidence.** Gemini project tier/usage, data terms, privacy/rights decisions, review owner, and genuinely available zero-cost budgets are unverified. Quota/rights records remain unseeded and metered operations fail closed. Do not invent limits or submit real customer data.
3. **Live candidate runtime remains unmeasured.** Wrangler dry-run and mock-counted requests do not validate actual Workers Free CPU/subrequest limits, Queue redelivery/DLQ, or hosted Supabase RPC payload behavior under the candidate. The three-chunk batch and 400-chunk/4-MiB caps are protective candidate limits, not proof that normal production ingestion fits.
4. **Authenticated product E2E, deletion/export/restore, and semantic quality remain incomplete.** Tests use synthetic identities and network mocks; no real OAuth identities, hosted tenant-boundary checks, live retries/DLQ or recovery were run. Citations stay `REVIEW_REQUIRED` absent independent held-out entailment evaluation and human-reviewed labels.
5. **Master-prompt product/release gates remain open** for selected vertical workflows, accessibility, quality, canary/rollback and recovery. Status must remain `PARTIAL_NOT_COMPLETE`; do not claim production readiness.

## Critical-gaps continuation — 2026-09-23, read-only hosted/account checks

This read-only review supersedes the earlier “Gemini project tier/usage remains unverified” statement above. It changed only AI Studio’s imported-project list to inspect the existing project; it did not create or modify a Google Cloud project, activate billing, select an API key, or send a provider request.

- **Supabase:** the connected organization is `tier_free`; the intended project is active and healthy, with **no development branches**. Live migration history still ends at migration 026, so candidate migrations 027–029 remain unapplied. The security advisor currently reports **Leaked Password Protection Disabled** (warning); no Auth setting was changed. No production database/storage/auth writes occurred.
- **Cloudflare:** the configured gateway and queue remain the previously deployed version, not this candidate. Read-only API inspection shows the ingestion queue at zero backlog; batch size 1, max concurrency 1, three retries, DLQ configured, and 24-hour retention. Secret values were not retrieved. The Workers plan/usage verification above applies to the existing deployment, not the candidate.
- **Gemini account:** the signed-in owner account contains an existing Gemini API project with NexusRAG-labelled credentials, but the Cloudflare `GOOGLE_API_KEY` is write-only, so its exact project/key association cannot be independently proven. AI Studio reports the inspected project on its **Free tier**, with Gemini API spend **₹0.00** for the displayed period. The Google Cloud project list separately displayed project-wide charges of **<₹0.01** that day; because that may include other Google services and is rounded, strict account-wide zero cost is **not** established. No spend cap was set, no billing was activated, and no API key was selected.
- **Observed active free-tier limits (28-day view):** the app uses `gemini-2.5-flash` and `gemini-embedding-001`. AI Studio showed 0/5 RPM, 0/250,000 TPM, 0/20 RPD for Gemini 2.5 Flash; and 0/100 RPM, 0/30,000 TPM, 0/1,000 RPD for Gemini Embedding 1. These are observed account limits, not guaranteed static ceilings; Google states rate limits can change with project tier/account status and actual capacity can vary. See [Google’s rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits).
- **Privacy/rights blocker is now stronger, not cleared:** Google’s current Additional Terms classify unpaid Gemini API quota as an Unpaid Service and say Google may use submitted content/responses to improve and develop products; human reviewers may read/process inputs and outputs. The app must not send customer/private documents via the free tier absent a documented privacy/legal owner decision and permitted data scope. Paid-tier processing terms would avoid product-improvement use but are incompatible with the zero-cost requirement unless separately approved; no paid call was attempted. See [Gemini API Additional Terms](https://ai.google.dev/terms).
- The existing candidate’s empty provider rights/budget rows therefore remain intentionally fail-closed. A synthetic request was **not** sent; the application’s Google key was not exposed or rotated.

### Remaining critical gates after this read-only review

1. Create or identify a genuinely zero-cost disposable Supabase Auth/Storage environment; there is none in the connected organization. Do not use the active production project or create a billed branch without explicit cost approval.
2. Obtain owner/privacy approval for any Gemini processing of user data, or choose an alternative that satisfies both the privacy requirements and zero-cost constraint. Confirm the Cloudflare key-to-project mapping privately; do not reveal the key.
3. Keep budget/rights rows empty until the actual account limits, sharing with other project users, data rights, and hard-stop strategy are reviewed. The current spend display and free quota alone do not promise a permanent zero bill.
4. Run authorized candidate-version Preview E2E, hosted Auth/Storage/tenant isolation, retries/DLQ, and deletion/export/restore only after safe credentials, budget, and test-project boundaries exist.
5. Resolve the Supabase leaked-password-protection warning via an owner-approved Auth setting change; evaluate its behavior/plan implications before changing production.
6. Complete the human-reviewed semantic evaluation and remaining accessibility, vertical workflow, canary/rollback, and recovery gates. Status remains **`PARTIAL_NOT_COMPLETE`**.

## Critical privacy-gate continuation — 2026-09-23, local candidate only

This section supersedes stale PR counts and the earlier statement that the Google project/key association was unconfirmed. Overall status remains **`PARTIAL_NOT_COMPLETE`**; no hosted migration, deployment, merge, or provider request was performed.

- **User-selected policy:** only non-sensitive material may be considered, and only after workspace-owner/privacy review; sensitive material must be blocked. The user confirmed the Cloudflare `GOOGLE_API_KEY` binding maps to the NexusRAG-labeled Gemini project. The secret value was not read, copied, disclosed, or rotated.
- **Code implementation:** candidate migration 030 adds immutable-by-default `unknown` document classification, declaration identity/time, and a database RPC gate requiring the exact `gemini_non_sensitive` action, explicitly `non_sensitive` classification, matching owner-approved provider-terms snapshot evidence, and a reviewed workspace-owner allowlist. Provider and workspace reviews expire after 30 days and future-dated/missing/mismatched approvals deny. It removes the prior service-role direct quota-reservation bypass. Existing/legacy versions default to `unknown` and are excluded from retrieval; reindex inherits only an explicitly declared non-sensitive class.
- **Application implementation:** uploads without an explicit non-sensitive declaration are rejected before Storage/DB writes; sensitive/unknown sources are blocked before OCR, embeddings, vector indexing, or retrieval. Chat requires a per-message non-sensitive affirmation and queries only ready versions classified non-sensitive. Candidate frontend chat now uses the authenticated REST gateway only; the legacy WebSocket transport is disabled so it cannot bypass the same server admission path. Paid fallback remains off.
- **Important limitation:** an upload/chat checkbox records a user declaration, not an automatic DLP or reliable sensitive-content detector. It does not prove that a mislabeled file is non-sensitive. Keep real content blocked until the authorized owner/privacy reviewer accepts this residual risk or a zero-cost content-classification control is implemented and validated.
- **Local verification:** Cloudflare synthetic suite **46/46 passed**; frontend unit suite **79/79 passed**; frontend lint and TypeScript checks passed. Clean disposable PostgreSQL 17.10 with pgcrypto/pgvector applied baseline plus migrations 027–030; quota rights/classification, grants, two-session concurrency/idempotency/settlement, append/finalize, extraction staging and local Storage-policy stand-ins passed. Correct gateway Wrangler dry-run bundled at **88.76 KiB (20.14 KiB gzip)**. No real identity, hosted Supabase or production provider call was used.
- **Provider evidence:** the inspected AI Studio Gemini project shows Free tier and ₹0.00 Gemini API spend; the account’s displayed 28-day limits and current zero usage are in the section above. Google Cloud separately displayed project-wide charges under ₹0.01 that day, so strict account-wide zero cost is not proven. Google unpaid-tier terms may permit product-improvement use and human review. No Gemini prompt was submitted, no billing was enabled, and no key was selected. A zero-cost budget must remain an explicitly reviewed hard stop; public or observed free limits are not a guarantee.

### Blockers still open; do not deploy

1. No genuinely zero-cost hosted Supabase Auth/Storage/pgvector rehearsal environment exists. Production contains user data; the available hosted branch is not free. Do not create/bill a branch or apply candidate migrations to production.
2. Supabase provider, workspace-policy, rights, and budget rows remain empty. The candidate therefore blocks Gemini even for declared non-sensitive content; a workspace owner/privacy reviewer must independently record terms and allowed-action approval and separately establish safe global/workspace free-tier ceilings.
3. The account-wide zero-cost guarantee is unproven. Observed AI Studio Free tier does not establish a permanent hard cap across all Google Cloud services; do not enable Gemini until no-charge enforcement is confirmed.
4. The synthetic route E2E is not authentic two-user OAuth/hosted tenant-boundary, real Storage, Qdrant, Queue/DLQ or recovery/export/restore evidence. Candidate-version live runtime/subrequest measurements remain undone.
5. Self-attestation is not content classification; no general-purpose local DLP detector has been validated.
6. Citation syntax still cannot establish semantic entailment; held-out expert-reviewed evaluation and accessibility, selected vertical workflows, canary/rollback, and restore gates remain open.

The clean local rehearsal is evidence about PostgreSQL execution only. The production project still ends at migration 026; migrations 027–030 are unapplied. Keep draft PR #3 unmerged and the Cloudflare candidate undeployed; status remains **`PARTIAL_NOT_COMPLETE`**.

## Zero-cost hosted rehearsal and security-fix continuation — 2026-09-23

The owner approved checking the only Supabase organization and creating a separate project **only at a confirmed $0/month quote**. Supabase quoted $0/month; a clean `nexusrag-zero-cost-rehearsal` project was created in `us-east-1`. It contains no production data and is reserved for disposable tests.

- Applied the clean 51-table baseline and migrations 027–030 to the fresh hosted Supabase/PostgreSQL 17.6 project. This first hosted rehearsal surfaced a real security-advisor defect in migration 029: the trigger function `cleanup_terminal_ingestion_extraction()` retained PostgreSQL's default `PUBLIC` execute grant, and the two service-only staging tables had RLS enabled without explicit deny policies.
- Added candidate migration 031 to revoke that function from `PUBLIC`, `anon`, and `authenticated`, grant it only to `service_role`, and add restrictive client-deny policies for both extraction-staging tables. The same exact migration applied successfully to the disposable hosted project.
- After migration 031, the hosted Supabase security advisor returned **zero security findings**. Direct privilege checks confirmed that `anon` and `authenticated` cannot execute the trigger function, `service_role` can, and both explicit-deny policies exist.
- Rollback-only hosted SQL tests replayed the synthetic fixture plus security, quota, Storage, extraction-staging, and resumable-batch assertions in one transaction. The actual hosted RPCs admitted the valid synthetic non-sensitive policy case, denied sensitive/unknown/unapproved/stale cases, and passed reservation/settlement/replay, staging cleanup, and exact batch publication checks.
- The hosted RLS test used two synthetic Auth identities/claims against the real `authenticated` role, `auth.uid()`, `documents`, and `storage.objects` (with temporary read grants inside the rollback transaction). Each identity saw its own document/object and zero cross-tenant records; the opposite-tenant storage predicate denied. The transaction was rolled back; final counts for Auth users, workspaces, documents, Storage objects, reservations, provider records/terms, budgets, and extraction staging rows are all zero.
- A fresh local PostgreSQL 17 + pgvector rehearsal including migration 031 passed; quota/idempotency/concurrency, extraction-stage, batch publication, Storage stand-in, and privilege assertions all passed. GitHub exact-head CI then passed **9/9 checks** on `f4c913ee402f416ea63e75533fdd7469f6d9b022`, including the PostgreSQL 17 migration/concurrency rehearsal, frontend, migration integrity, and Cloudflare compatibility.
- The intended live Supabase project was not modified: its migration history still ends at 026. No Cloudflare deployment, Gemini call, Qdrant mutation, or paid action occurred.

This closes the **hosted database migration compatibility**, **hosted SQL-level tenant/Storage RLS**, and **hosted independent-transaction quota/idempotency concurrency** gates for the tested candidate schema. It does **not** establish real OAuth sign-in, HTTP Storage upload/download, or calls through the application/PostgREST route; the two identities were synthetic SQL JWT claims.

**Hosted concurrent transaction verification (new):** On the $0/month rehearsal project, four independent PostgreSQL 17.6 `pg_cron` sessions started between `20:41:00.104` and `20:41:00.110 UTC` (distinct backend PIDs; all four overlapped for the deliberate eight-second lock window). Two different idempotency keys racing for a global limit of one produced exactly one `READY` and one `TRY_AFTER_RESET`; the same-key pair produced exactly one `READY` and one `RESERVATION_IN_PROGRESS`. All four hosted jobs succeeded. These exercised the actual `v6_reserve_many` function and lock/reservation tables with a synthetic test-only Qdrant provider identifier; no actual Qdrant/Gemini/provider request occurred. All four jobs were unscheduled, reservations were released, and synthetic users, workspace, provider/policy/budget rows and temporary harness schema were removed. Post-cleanup checks found zero Auth users, workspaces, providers, policies, budgets, reservations, active cron jobs, or harness schema. The rehearsal project's migration history retains the apply/cleanup harness records for auditability.

This is hosted PostgreSQL transaction evidence, not end-to-end authenticated PostgREST behavior or real OAuth/HTTP Storage evidence. No test fixtures or running test jobs remain.

### Remaining release blockers

1. **Zero-cost provider guard:** the owner authorized Gemini Free only for explicitly attested non-sensitive inputs under its unpaid-tier terms. Production rights, terms-snapshot, and budget rows remain empty; we have not seeded guessed account limits or made provider calls. The checkbox is not DLP, and the account-wide $0 guarantee cannot be proven while Google Cloud reports other project charges.
2. **Candidate-runtime and full product E2E:** candidate Worker remains undeployed. No real OAuth, authenticated HTTP upload-to-answer, cross-tenant Storage API denial, Qdrant integration, retry/DLQ, deletion/export/restore, or live subrequest/CPU measurement has been run.
3. **Answer quality and master-prompt releases:** claim state remains `REVIEW_REQUIRED` until independently labeled held-out entailment evaluation passes. Selected vertical workflow, accessibility, canary/rollback, and restore gates remain open.
4. **Production migration/release:** migrations 027–031 remain candidate-only. Do not apply them to the active project or merge/deploy until independent PR review, owner-approved operational policy/budgets, and the remaining release gates are satisfied.

**Status: `PARTIAL_NOT_COMPLETE`.** PR #3 remains draft and unmerged; Cloudflare candidate remains undeployed.
