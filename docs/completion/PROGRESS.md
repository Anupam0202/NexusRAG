# NexusRAG completion progress
Last updated: 2026-11-18. The goal and the ordered remaining work are in `docs/completion/CONTINUATION_PROMPT.md`.
Everything an agent can do without the owner is done; the Handoff below lists the owner's steps in order.

## Handoff 2026-11-18
Branch: `codex/runtime-manifest-008` (draft PR #12; its page shows the head), last code commit `8315b8e`. CI: V6 Database
Rehearsal green; V6 Foundation CI green except the image scan, red since 18 November on OpenSSL advisories with no
fixed release (NX-49). NX-48's advisory was withdrawn on 18 November, and the audit gate passes again.
Deployed: preview gateway `81bab63` (smoke test, `/ready` and the workspace-deletion journey 19 of 19 passed); preview
frontend `2fbc5c9` (October); production unchanged (23 September Workers, 46 migrations behind, `gemini-2.5-flash`).
Plan and goal: `docs/completion/CONTINUATION_PROMPT.md`. Done on 17 and 18 November (commits in the done log): public
addresses and Cloudflare cleanup; NX-20 ranked keyword search; NX-25 token checks and both request counters; 21
foreign-key indexes; F8 budgets measured; NX-42 exhausted jobs fail their document; one Qdrant request per answer;
NX-19 grants checked on both projects, with a replay assertion; NX-36 required collection name and no passage text in
the index; NX-48 and NX-49 recorded, and NX-48 resolved by the advisory's withdrawal; three moderate advisories in
the test and lint tools fixed.
Still failing: ingestion and answers (both Gemini keys answer 402); five rehearsal migrations unapplied (the
connector's approval went unanswered on 15 to 18 November); preview frontend refused by the environment's branch
rule; production unreleased; NX-49 has no upstream fix yet.
Agent work left: none that does not wait on a step below. CI is red only on NX-49: OpenSSL has not released the
fix, and the scan is not loosened without step 4. A scheduled check every 12 hours re-runs the scan, which takes
the fix once Alpine ships OpenSSL 3.5.10.
Owner actions, step by step:
1. Gemini key, before 1 December: create a key in Google AI Studio in a project with credit, or in a free-tier
   project without prepaid billing. GitHub → Settings → Environments: set it as the secret `GOOGLE_API_KEY` in both
   `NexusRAG-Candidate-Preview` and `Production`.
2. Preview environment: GitHub → Settings → Environments → `NexusRAG-Candidate-Preview` → Deployment branches and
   tags: add `codex/runtime-manifest-008`. Add the secret `SUPABASE_DB_URL`: the rehearsal project's session-pooler
   string (Supabase → project `ukgjygzfhyvnrsecdcuu` → Connect → Session pooler). The agent then runs the preview
   workflow, which applies the five migrations (or approve the connector's prompt when the agent sends them).
   Shortcut for step 2's migrations and for step 3: a Supabase personal access token lets the agent do both. The
   token saved in this cloud environment on 18 November is refused by Supabase ("JWT could not be decoded"), so
   replace its value: cloud environment menu → Edit → Network secrets → `api.supabase.com`, with a token that
   starts `sbp_` (Supabase → Account → Access Tokens), entered without "Bearer".
3. Supabase → Authentication → URL Configuration. Production (`fcjaomiceajcdownarel`): Site URL
   `https://nexusrag.pages.dev`, add redirect `https://nexusrag.pages.dev/**`. Rehearsal (`ukgjygzfhyvnrsecdcuu`):
   Site URL `https://nexusrag-preview.pages.dev`, add `https://nexusrag-preview.pages.dev/**`, remove the PR3 URLs.
4. Reply in chat with ledger decisions ("Ledger status" gives each recommendation): accept or refuse NX-22, NX-25,
   NX-32, NX-33's remainder, NX-35, NX-41 and NX-42's remainder; decide NX-15, NX-31, NX-38 and NX-49.
   For NX-49, reply "wait" (CI stays red until Alpine ships the fix) or "accept NX-49 until <date>": the agent
   then adds an exception for those five CVEs alone, which ends on that date. Recommended: accept it until
   31 January 2027. OpenSSL rates the five Low and has not dated its fix release, the deployed Workers do not use
   the image, and `main` reportedly requires CI to pass before the merge in step 6.
5. GitHub → Environments → `Production`: confirm these secrets exist: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (an `sb_secret_` key), `SUPABASE_DB_URL`
   (production's session pooler), `GEMINI_USER_KEY_ENCRYPTION_SECRET` (base64 of 32 random bytes, set once and never
   replaced), `GOOGLE_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`.
6. Once the agent reports the preview journey passed, CI green and the trusted push done (D2: the head pushed to
   `release/production-*`, which records the provider checks and the `Preview` deployment that `main` reportedly
   requires; Settings → Rules shows the rules): review and merge PR #12; Actions → Production Deploy → Run
   workflow with `release_sha` set to the merge commit, and approve the environment; then walk through
   `docs/completion/OWNER_WALKTHROUGH.md` on https://nexusrag.pages.dev and confirm in chat.
7. Credential rotation (MASTER_PROMPT section F6), when you choose; the agent prepares the list.
After each step the agent continues with the matching phase of CONTINUATION_PROMPT.md section 5.

## Current state
- main: `85b14f1`; working branch: `codex/runtime-manifest-008` (draft PR #12, owner-approved for direct
  commits on 2026-11-09); open PRs: #12
- Plan: `docs/completion/MASTER_PROMPT.md`; repository notes: `CLAUDE.md`
- Candidate preview: gateway `81bab63` (previous version `797eb124`), released 2026-11-18 (smoke test and `/ready`
  passed); before it `cf9c862` (previous version `1257b684`), released 2026-11-18 from a cloud session (smoke
  test and `/ready` passed, the index found under its named collection; the workspace-deletion journey passed 19 of 19
  on it); before it `c7eb61c` and `e9b23af` (previous version `95890b72`), released 2026-11-17 from a cloud session (smoke
  test and `/ready` passed); before it `8bcfc22` (previous version `d30adcbe`), and before that
  `6e1d540` (version `c5d60d8c`, 11:44 UTC); before it, `c05f319` released 08:12 UTC
  from a cloud session (smoke test and `/ready` passed: database reachable, search index ready, collection
  `nexusrag-v6-candidate` empty). Until `20261117090000_ranked_keyword_search` is applied to rehearsal, its chat uses
  the bounded keyword read (`coverage.lexical_search: FIRST_PASSAGES`). The release of `6fb3123` at 06:55 UTC is the
  one checked live below. Its `FRONTEND_ORIGIN` lists https://nexusrag-preview.pages.dev and the frontend
  Worker's own address; a preflight from each is allowed, and one from production's address or another site is
  refused. The workspace-deletion journey passed 19 of 19 checks on it afterwards (its upload fails at processing
  on the Gemini key's 402, as expected). Its cron treats a missing database function as unavailable, so it runs
  safely before the remaining migrations; account deletion, CALCULATION runs and the daily reconciliation line stay
  unavailable there until then. Frontend is still the old build `2fbc5c9`, whose `/research`, `/radar`,
  `/evidence-api` and unknown paths return 500 (NX-01): a cloud session cannot upload frontend assets, and the
  preview workflow rejects this branch (environment branch rule).
- Rehearsal Supabase (`ukgjygzfhyvnrsecdcuu`): 54 migrations applied (`20261113190000_workspace_deletion` on
  2026-11-15, when the owner answered the Supabase connector's confirmation); pending:
  `20261113210000_account_deletion`, `20261114090000_research_calculation_runs` and
  `20261114120000_storage_reconciliation`, and since 17 November `20261117090000_ranked_keyword_search` and
  `20261117120000_foreign_key_indexes` (the
  confirmation was asked on 15, 16 and 17 November and timed out unanswered each time). Nothing is stored or open: no documents, no stored files, no open deletions.
  Advisors: only leaked-password protection (an Auth setting). Both test accounts' trial counters were reset after
  the journey on `cf9c862` (18 November); each journey uses account A's trial document, so reset them again
  before the next one (next steps, item 2). Provider reviews recorded for Gemini, Qdrant
  and Supabase Storage (staging attestation by test account A, valid to 2027-11-12). Two test accounts
  (`nexus-e2e-a@nexusrag.test`, `nexus-e2e-b@nexusrag.test`), each with an approved workspace; their passwords were
  set anew on 2026-11-15 and exist only in the build session, so set new ones (a bcrypt hash in
  `auth.users.encrypted_password`) when a later session needs to sign in.
- Production: `nexusrag-v6-frontend-preview` v29 → `nexusrag-v6-preview-gateway` v52, both from 23 September,
  on Supabase `fcjaomiceajcdownarel` (35 migrations applied, nine of them under names the repository no longer
  uses; matched by name, 46 of the repository's 72 are pending, checked 17 November with `scripts/migration_status.py
  status --applied` on its migration list) and collection
  `nexusrag-v6-preview`. The live gateway still defaults to `gemini-2.5-flash` with `thinkingBudget: 0`, has no
  `GEMINI_USER_KEY_ENCRYPTION_SECRET`, and nothing has been changed there.
- Gemini: the candidate Worker's shared key answers **HTTP 402** (its Google project is prepaid and has no
  credit; Google enforces this since March 2026). Every ingestion and every chat on the shared key fails.
- Public addresses (17 November): Pages projects `nexusrag` → https://nexusrag.pages.dev, bound to
  `nexusrag-v6-frontend-preview`, and `nexusrag-preview` → https://nexusrag-preview.pages.dev, bound to
  `nexusrag-v6-candidate-frontend` (deployed with `scripts/front_door.py`; code `apps/front-door/worker.js`). Both
  Workers still run builds from before the front door, so page requests are sent on (302) to the Workers' own
  addresses; Cloudflare's URL scanner, run from outside, followed the preview address to the app, with every file
  served (200). The service-binding path is exercised by the first release made for the public address. This
  session cannot open `*.pages.dev` (network allowlist).
- Cloudflare (17 November): Workers `nexusrag-v6-candidate-gateway`, `nexusrag-v6-candidate-frontend`,
  `nexusrag-v6-preview-gateway`, `nexusrag-v6-frontend-preview`; queues `nexusrag-v6-candidate-ingestion`,
  `nexusrag-v6-preview-ingestion` and their DLQs; the two Pages projects above. The retired PR3 Workers
  (`nexusrag-v6-pr3-gateway`, `nexusrag-v6-pr3-frontend`) and queues (`nexusrag-v6-pr3-ingestion` and its DLQ)
  were deleted on 17 November at the owner's request. No KV, D1, R2, Hyperdrive or zones.
- Qdrant: cluster `fc0c77d2-d9fd-4648-8459-09fa74372f16` (AWS eu-west-2) stopped serving between 9 and 11
  November and serves again since 12 November. The preview gateway reaches it with its own key (`/ready`:
  READY). The daily keep-alive is live on the preview from `4864133`; production gets it with the release.

## Optimization budgets (F8), measured 2026-11-17
No numeric targets are agreed yet, so the target is no regression (section F8). "Before" is the October candidate
build (frontend `2fbc5c9`) or the 8 November figure (gateway); "after" is this branch at `6d2c434`. Sizes are
gzip -9. Live figures are Workers Logs and Cloudflare's analytics for the 7 days to 17 November 12:22 UTC.

| Measure | Before | After | Free plan limit | Notes |
|---|---|---|---|---|
| Gateway bundle | 424 KiB, 94 KiB gzipped | 510.5 KiB, 115.3 KiB gzipped | 3 MiB gzipped | Growth is the completion features: deletions, retention, accounts, CALCULATION, token checks, ranked keyword search. The deployed preview gateway measures the same |
| Frontend Worker | 6,924 KiB, 1,393 KiB gzipped | 7,255 KiB, 1,482 KiB gzipped | 3 MiB gzipped | Next 16.4.5 and the new pages; half the limit |
| First-load JavaScript, `/chat` | 356.9 KiB gzipped, 15 files | 382.5 KiB gzipped, 16 files | — | Regression of 25.6 KiB. 10.5 KiB of it is the research, Radar and evidence-package checks that `src/lib/api.ts` imports for every page; splitting that module by domain (F7) takes them out of pages that do not use them. The rest is the app shell's new parts (key prompt, error screens) |
| First-load JavaScript, `/documents` | 328.4 KiB gzipped | 353.8 KiB gzipped | — | Same causes |
| Requests per chat answer | 30 (derived: the same path plus a Supabase Auth call on every request) | 28: 25 Supabase REST, 0 Supabase Auth, 1 Qdrant (the search), 2 Gemini (embedding and answer) | 50 | Counted by the end-to-end test, which now fails if a checked token reaches Supabase Auth, if chat falls back to the bounded keyword read, or if any invocation passes 40. The keyword step returns at most 50 ranked passages instead of reading up to 201. A search no longer asks Qdrant about the collection first (29 → 28, one cross-region round trip less per answer; its budget reservation dropped from 2 Qdrant requests to 1) |
| Requests per upload; per ingestion batch | — | 9; 31 and 22 (a six-passage text file) | 50 | Same test |
| Gateway CPU per request | — | median 1 ms, p95 11 ms, p99 13 ms, max 13 ms (1,490 requests) | 10 ms | Every invocation ended `ok` |
| Queue consumer CPU | — | median 12 ms, max 20 ms (20 batches) | 10 ms | Over the documented limit, yet none was stopped (NX-35) |
| Cron CPU | — | median 3 ms, p95 6 ms, max 15 ms (2,060 runs); production's September gateway at most 2 ms | 10 ms | Wall time median 1.1 s, max 3.0 s |
| Frontend CPU per request | production's September build: median 32 ms, p95 486 ms, p99 799 ms (400 requests) | not live yet | 10 ms | Server rendering. None was stopped, so this relies on Cloudflare's tolerance (NX-35). The October candidate build threw on all of its 130 requests (NX-01, fixed on this branch) |
| Subrequests | — | candidate gateway 3.5 per invocation on average (11,617 over 3,339) | 50 per invocation | Mostly the five-minute cron |
| Database size | — | rehearsal 18.3 MiB; production 16.8 MiB | — | |
| Stored files | — | rehearsal none; production 7 files, 366 KiB | — | |
| Orphans | — | rehearsal none; production: no file without a document, one document whose file is gone | 0 | That document is the one stuck in deletion since 22 September (NX-47); the production release finishes it. Qdrant points not counted: this session has no key for the cluster |
| CI wall-clock | 19m41s to 23m52s for V6 Foundation CI (12 October) | V6 Foundation CI 20m56s, V6 Database Rehearsal 7m30s (`729c4ec`) | — | No regression |
| Chat time to first token and total time, p50 and p95 | — | not measured | — | Every Gemini call fails with HTTP 402; measure once a key works |

## Ledger status, 2026-11-17
Section 13 needs every ledger item (MASTER_PROMPT Part 2, section D) fixed and verified, or accepted by the owner
in chat with a reason. Where each one stands:
- Closed, fixed and verified live: NX-07, NX-16, NX-23, NX-47. Fixed and verified in CI: NX-09, NX-10, NX-11.
  Checked on both hosted projects, with a replay assertion that keeps it so: NX-19 (re-run after each migration batch).
  Resolved: NX-43; NX-48 (the advisory was withdrawn, 18 November).
- Fixed in code; the live check waits for one of the owner's steps:
  - the frontend release (the preview environment's branch rule): NX-01, NX-28, NX-30;
  - a Gemini key with credit: NX-03, NX-06 (production must be released before 2026-12-01), NX-14 (its prepaid
    message already shows live), NX-21, NX-24, NX-36, and NX-22's long PDF;
  - the five rehearsal migrations: NX-17, NX-20, NX-27, then a re-run of NX-19's grants check and the advisors;
  - the two-account journey with ingestion (`scripts/preview_smoke.py`): NX-04, NX-05, NX-33;
  - the production release and its secrets (`docs/DEPLOYMENT_PRODUCTION.md`): NX-02, NX-08, NX-12 and NX-13's
    workflows, NX-18 (one encryption secret for production), NX-26 (Supabase secret keys before the end of 2026).
- For the owner to accept or decide (recommendation in brackets):
  - NX-22: no PDF text layer or page splitting on the free plan (accept);
  - NX-25: the per-user limit is approximate; a strict one needs a Durable Object (accept for now);
  - NX-32: claims are safe while each environment has its own Supabase project (accept);
  - NX-33's remainder: RPCs take the Worker's context; moving reads to the user's token is long-term work (accept,
    once the two-account journey passes);
  - NX-35: Workers Free or Paid with the F8 figures, D5 (stay on Free until there is real usage);
  - NX-41: leaked-password protection does not apply to Google-only sign-in (accept);
  - NX-42's remainder: provisional limits, and an alert on `LEASE_EXHAUSTED` (accept until there is real usage);
  - NX-49: the container image scan is red on five OpenSSL CVEs that OpenSSL rates Low, in the optional
    self-managed image only. Their fix waits for OpenSSL 3.5.10, which has no release date (accept a dated
    exception, for example until 31 January 2027; the first build after Alpine ships the fix picks it up by itself);
  - NX-15: finish Procurement and Passport (Tier 3) or remove them, D11; NX-31: remove the Python backend, D4;
    NX-38: enable Dependabot for Actions; NX-40: remove the PR3 redirect URLs from rehearsal's Auth settings.
- The cleanup pull request after Tier 1, with the owner's approval (D13, D20 to D22): NX-29, NX-34, NX-37, NX-39,
  NX-44, NX-45, NX-46; it also splits `src/lib/api.ts`, which F8 found in every page's first load.

## Inventory (read-only, 2026-11-09, updated where noted)
- Gemini: `gemini-2.5-flash` and `gemini-2.5-pro` shut down on 2026-12-01 (calls reroute to
  `gemini-3.5-flash-lite` and `gemini-3.8-flash`); `gemini-embedding-001` is supported until 2028-05-14.
- Supabase production: ACTIVE_HEALTHY; 8 users, none signed in since 2026-09-22; 7 legacy documents with chunks
  but no version rows (NX-03) and 1 stuck in `deleting` (NX-27); 0 stored BYOK keys; advisors: only
  leaked-password protection off.
- Supabase rehearsal: ACTIVE_HEALTHY; 71 tables, each with row security and a policy; advisors: only
  leaked-password protection (an Auth setting).
- Cloudflare: six Workers; six queues (production, candidate and PR3, each with a DLQ; the PR3 queue has no
  consumer); both live gateways run a `*/5` cron; no R2, KV or D1. Workers subdomain `nexusrag-evidence-preview`.
- GitHub: PR #12 is a draft; merging is blocked by draft status and by the ruleset's provider checks, which need
  a trusted push (D2) and working provider keys.

## Tiers
- Tier 0: [~] 1 Gemini model policy (NX-06): built, tested offline, live on the preview gateway; the live calls
  with a key are pending [x] 2 CI green [x] 3 fresh database from the repository (NX-11) [x] 4 deploy workflows
  (NX-12, NX-13); the gateway path is proven live, the workflows run when first dispatched [x] 5 PR #12
  description rewritten [~] 6 inventories: Qdrant collections need the key (NX-07) [x] 7 Recovery salvage
- Tier 1: [x] workspace creation on hosted Supabase [x] provider approval and budgets work without SQL
  [x] specific provider errors and the key prompt (NX-14; live check needs a key) [x] two-account live journey
  script [x] document deletion finishes (NX-47) [x] NX-03 Ready only when answerable [x] NX-16 no control calls
  a missing endpoint [x] NX-21 real streaming (live for the no-evidence path) [x] NX-30 first run and plain wording [ ] ingestion → answer → delete on
  the preview (blocked: Gemini 402) [ ] frontend preview deploy (blocked: environment branch rule) [ ] NX-04,
  NX-05 verified live [ ] owner walkthrough (checklist: `docs/completion/OWNER_WALKTHROUGH.md`)
- Tier 4 pulled forward because of NX-07: [x] Qdrant keep-alive, `/ready` and typed index errors (D15, NX-23)
- Tier 2: [x] retention runs, scheduled and on demand (NX-16; verified live) [x] workspace deletion (NX-16; live
  after its migration) [x] CALCULATION as the twelfth run mode, with actionable review (NX-17; live check needs a
  Gemini key) [ ] the rest of Tier 2
- Tier 3: not started

## Done log
| Date | Item | Verified at level | Commit |
|---|---|---|---|
| 2026-11-09 | Recovery salvage; plan, progress log, `CLAUDE.md`; NexusRAG cloud environment; Cloudflare inventory | n/a | `763c288`, `4410c35` |
| 2026-11-09 | NX-10 Docker type-check; NX-09 audit gate and NX-01 Worker crash (next 16.4.5, OpenNext 1.20.16) | 2 (built Worker: real routes 200, unknown path 404) | `41eb758`, `5a28cd2` |
| 2026-11-09 | D4: legacy backend image built and scanned only on request | CI | `51e73ce` |
| 2026-11-09 | NX-06: model policy D24 (fallback chain, retirement detection, thinking settings, `/health`, daily and weekly checks) | 2; 4 for `/health` | `6b30a50` |
| 2026-11-11 | NX-11/NX-12: `scripts/migration_status.py` (name-based status, snapshot, apply, record) with a real-database test; a policy on every public table | 3 (local replay; applied to rehearsal) | `1c65c73` |
| 2026-11-12 | NX-12/NX-13: `scripts/release.py` (deploy, smoke test, automatic rollback); production workflow manual-only with snapshot, migrations, secrets shipped with the version, restore on failure; preview workflow from any branch | 4 for the gateway (five live releases); 1 for the workflows | `f55db81` |
| 2026-11-12 | Found live: workspace creation failed on hosted Supabase (`permission denied for table users`). Fixed; new assertions run as the service role and fail if a non-definer function reads `auth` tables | 4 (workspace created through the preview) | `4a2a6a3` |
| 2026-11-12 | Found live: no document could be processed anywhere, because provider approvals and budget rows had to be inserted by hand and expired after 30 days. Now: an operator review per provider (365 days), the workspace owner's approval of Gemini (until the terms change), budgets created from defaults and reset daily, and a named reason for every denial | 4 (approval, reservation and settlement through the preview) | `8de9765` |
| 2026-11-12 | Provider failures name the provider and the fix; a Gemini key on a prepaid project without credit reports `PROVIDER_CREDIT_EXHAUSTED`; a document whose ingestion fails for good is marked failed | 4 (the preview returns the message) | `0980174`, `83bf73e` |
| 2026-11-12 | Documents page shows when the workspace still needs processing approval | 1 (frontend tests, lint, type-check) | `80ed357` |
| 2026-11-12 | Provider Review workflow and `scripts/provider_review.py` (status, record) | 1; the RPCs at 4 | `67d3020` |
| 2026-11-12 | CI: build pgvector from a pinned tag when the packaged one cannot install (PostgreSQL release day) | CI | `3396cb0` |
| 2026-11-12 | Qdrant keep-alive in the daily cron; `/ready` probes database and index; typed index errors (`INDEX_NOT_ANSWERING`, `INDEX_KEY_REJECTED`, `INDEX_EMPTY`); releases roll back when the new gateway cannot use its database or index | 4 (released; `/ready` READY live) | `4864133` |
| 2026-11-13 | Found live: no document deletion could ever finish (NX-47). Now writers are stopped, index entries and the original are removed and verified, then one database function removes every row, blanks quoted passages and writes its receipts in the same transaction; the cron retries; Radar pages are refused; a legacy document's stored file is erased too | 3 (local replay with new assertions; 909 gateway and 748 frontend tests); live after the migration is applied | `845642f`, `b7c9eda` |
| 2026-11-13 | NX-16: retention and workspace deletion shown only when the gateway supports them; unused `/api/v1/auth/me` client removed; offline probe of all 66 paths the app calls | 1 | `387d791` |
| 2026-11-13 | NX-03: `ready` only with a published version; legacy documents show "Upload again"; re-uploading a held file explains failed, unsearchable or still-erasing copies | 1 | `a638075` |
| 2026-11-13 | NX-14 app side: provider errors shown as sent; key prompt on a rejected or out-of-credit key; key forms use the server's bounds | 1 | `9c1fef2` |
| 2026-11-13 | NX-21: real streaming from `streamGenerateContent`; the final event carries the checked and saved answer; errors before the first token keep their HTTP status | 1 (6 end-to-end tests on the real pipeline); 4 for the no-evidence path | `e50a239` |
| 2026-11-13 | NX-28 part: security headers on every page, file and error (Worker and `_headers`), checked on the built Worker; hostile-markdown test | 2 | `5262bff` |
| 2026-11-13 | NX-16 retention runs: owners and administrators set a number of days; every day (and on "Run now") documents uploaded before the cutoff go through the normal deletion, chat messages and research results from before it are removed, and conversations unused since are removed or closed; saved findings, what they cite and Radar pages stay. Turning it on asks for a second click that names the cutoff date | 3 (local replay with new assertions; 926 gateway and 776 frontend tests); 4 on 13 November (below) | `f589e7b` |
| 2026-11-16 | NX-22 ingestion limits. A PDF or image cut off at 8,192 output tokens (about a dozen pages; it used to fail with "split the document") is read again with the model's published limit: 65,536 tokens for both pinned models, roughly 100 pages (Google's model pages, read 16 November). The job's lease is renewed during the read. The shared key's budget counts a file at no more input than a request can hold; one token per byte had made every PDF over 4 MB impossible on the trial. Word text comes from the elements Word shows. Every way a read can end has its own plain message, and nothing partial is indexed. Not done: a PDF's own text layer and splitting by page (a PDF parser does not fit the free plan's CPU limit) | 1 (986 gateway tests; 12 new, eleven broken variants each refused). The long read has run against a stand-in only | `e0d3b60` |
| 2026-11-17 | NX-25, second half: a request must pass both the isolate's own counter (exact, but every isolate counts from zero) and Cloudflare's rate limiter (binding `USER_RATE_LIMITER`, 60 a minute per location; the preview and production use separate namespaces, which `release.py` checks). Cloudflare's count is approximate by design: live on the preview, 327 requests from one location in 45 seconds all passed it, and after both counters were required, 304 in 45 seconds still passed, because one client's requests are spread over many isolates, each counting from zero. The old per-isolate limit was never strict either. A strict per-user limit needs a Durable Object (not built; the ledger keeps this open for the owner to accept or ask for). A limiter that fails is logged and leaves the isolate's counter to decide | 1 (1,011 gateway and 30 release tests); 4 for the binding being accepted by the free plan and for the burst behaviour above | `b5125c9`, `b891b6e`, `8bcfc22` |
| 2026-11-17 | NX-25, first half: the gateway checks access tokens itself against the project's published ES256 key (both projects publish one and sign with it: checked on a real rehearsal token), instead of asking Supabase Auth on every request, which also saves one of the 50 outbound requests a free-plan invocation may make. Signature, issuer, audience, role, expiry and user id are checked; the key list is cached and re-read for a rotated key; a token signed otherwise, or an unreadable key list, still goes to Supabase Auth; a failing token is refused, never handed on. Trade-off, already stated on the security page: after signing out, an access token works until it expires (an hour); membership is still checked on every request | 1 (1,010 gateway tests; a real ES256 key pair; removing any one of seven checks fails a test); 4 on the preview gateway `6e1d540`: a real rehearsal token is accepted and reads the database, a tampered one is refused (401), and after a global sign-out Supabase Auth refuses the token (403) while the gateway accepts it until it expires, which shows the check runs in the Worker | `6e1d540` |
| 2026-11-18 | NX-48 resolved without a change, and NX-49 rechecked (the scheduled check, run at 20:55 UTC after a session restart). GitHub withdrew GHSA-fc5q-39xc-vjpf on 18 November, after the `picomatch` maintainers disputed it as not a vulnerability, and VulnCheck withdrew its record too; it had been published on 19 October and reviewed by GitHub on 17 November, when npm audit began reporting it. `npm audit` now reports nothing at any severity. NX-49 stays: OpenSSL published the five CVEs on 10 November and rates them Low (the scan reports NVD's scores); their fix is in OpenSSL's source for 3.5.10, which has no release date, so Alpine 3.24 still ships `3.5.9-r0`. Also corrected the dates recorded earlier ("published on 18 November") and added the trusted push (D2), which `main`'s protection reportedly needs, to the merge steps in the handoff and phase B | CI: the re-run of the failed jobs on `a30d62f` ([run 44309859367](https://github.com/Anupam0202/NexusRAG/actions/runs/44309859367), attempt 2) passed the audit gate with the lockfile unchanged; the image scan failed with the same ten OpenSSL findings | n/a (records only) |
| 2026-11-18 | Dependencies checked ahead of the scheduled check: `picomatch` 4.0.7 is still the latest release, so NX-48 stays open. Three moderate advisories published in October had fixes within the ranges `package.json` allows, but the audit gate fails only on high findings, so they had stayed: two in `@vitest/mocker` (fixed by vitest 4.1.12) and one in `minimatch`, which typescript-eslint reached (fixed by 8.73.0, which needs minimatch 11.0.1 or later). All 12 findings left are the one `picomatch` advisory. The lockfile is now written with npm 11 on Node 24, as in CI; npm 10 crashes in `npm update` on this tree | 1 (lint, type-check and the 839 frontend unit tests; `npm audit`: no moderate findings, 12 high, all GHSA-fc5q-39xc-vjpf) | `8315b8e` |
| 2026-11-18 | CI after NX-36: the research Worker harnesses CI runs from `frontend/scripts` named no collection, so the batch-transport step failed; they name a test collection now, and the status endpoint's `qdrant_configured` requires the name too. All ten Worker harness steps pass locally. The same run found NX-48 (a new `picomatch` advisory with no fix) | 1 (the ten harness steps; 1,018 gateway tests; `/ready` without a name is tested) | `7c11801` |
| 2026-11-18 | NX-36: new index entries no longer carry the passage text; answers and research already rebuilt every passage from the database and checked its hash, so the copy in Qdrant was never used and only duplicated people's text on another provider. A gateway without `QDRANT_COLLECTION` now reports the index as not configured: the fallback was production's collection, so a preview gateway deployed without the name would have written into it (`release.py` always sets it, so neither environment was affected) | 1 (1,018 gateway tests; both new tests fail on the previous code; every test fixture now names its collection); released to the preview at `cf9c862`, where `/ready` finds the index under its named collection and the workspace-deletion journey passed 19 of 19, its index cleanup included | `04d4e0c` |
| 2026-11-18 | NX-19: grants checked on both hosted projects' real roles (read-only). Every public table has row-level security; `anon` and `authenticated` hold no privilege on any public table or view (71 tables on rehearsal, 56 on production); none of the security-definer functions (28 and 12) is callable by them, and each pins its `search_path`; no bucket is public. Storage's policies are narrow: a member can read only the originals of ready documents in active workspaces, and can write only upload keys the gateway never allocates. Thirteen ordinary functions on rehearsal are still callable by `authenticated` but reach no data without table privileges (left for NX-44). A new replay assertion, `client-privilege-assertions.sql`, keeps all of this true for every future migration | 4 for the hosted check; 3 for the assertion (fresh local replay; seven broken variants each caught with their own message) | `49e782c` |
| 2026-11-17 | F8: a search no longer asks Qdrant about the collection before querying it. The query's own answer already says when the collection is missing (an empty index), the key is refused or the cluster does not answer, through the same typed errors, so each chat answer and research query saves a round trip to the cluster and a request (an answer now makes 28). Its budget reservation drops from two Qdrant requests to the one it makes | 1 (1,017 gateway tests; the typed-failure tests unchanged; the two new checks fail on the previous code) | `fb372a3` |
| 2026-11-17 | NX-42 reviewed: a job's database record, not the queue, decides whether it runs again, so a message the queue dead-letters is retried by the cron, and the job fails after three attempts. Found and fixed: when the attempts ran out because the Worker kept stopping mid-batch, the job and its version failed but a document that never had a usable version showed "processing" for ever; it now shows an error, and a document with a ready version keeps it | 1 (four new tests; the two that cover the fix fail without it); released to the preview (smoke test and `/ready` passed). On `c7eb61c` the live workspace-deletion journey passed 19 of 19, its upload failing at Gemini's 402 and its document marked failed within 5 s through the shared helper | `e9b23af` |
| 2026-11-17 | F8 budgets measured (table above): bundle sizes, first-load JavaScript, CPU per event type, subrequests, data sizes, orphans and CI time, before and after. The end-to-end test now counts the requests of an upload, each ingestion batch and a chat answer, and fails if a checked token reaches Supabase Auth, if chat falls back to the bounded keyword read, or if an invocation makes more than 40 of the 50 requests the free plan allows | 1 for the counts (two broken variants each fail the test); 4 for the live CPU, subrequest and data figures | `4881f01` |
| 2026-11-17 | Supabase advisors reviewed on both projects (NX-41): the only security warning is leaked-password protection (an Auth setting; sign-in is Google-only). The performance advisor's 21 foreign keys without a covering index on rehearsal get indexes (`20261117120000_foreign_key_indexes.sql`); deleting an account, a document or a research run no longer scans whole tables to check them. A new assertion names any foreign key left without one. Unused indexes are what a database without traffic shows | 3 (fresh local replay; the check fails before the migration, names a single dropped index, and passes after) | `11f3066` |
| 2026-11-17 | NX-20 for chat: keyword search ranked in the database over every passage of the chosen versions (`20261117090000_ranked_keyword_search.sql`: whole lower-cased words, weighted by rarity, published and non-sensitive versions of the workspace only, a GIN index; `keyword-search.js`). Chat used to score only the first 200 passages by identifier, so a clause code in passage 250 was never matched; now it is. Page or metadata filters keep the complete bounded read, and a database without the migration falls back to it; the answer's coverage says which ran. Research runs keep their fair bounded read | 3 for the database (fresh local replay on PostgreSQL 16, and on 17 in [CI](https://github.com/Anupam0202/NexusRAG/actions/runs/44041276126), with new assertions; eight broken variants of the function each fail them), 1 for the gateway (1,005 tests; a 250-passage end-to-end chat finds the code ranked and misses it on the fallback; two broken variants each fail). Not yet on any hosted database; the preview gateway runs it with the fallback | `c05f319` |
| 2026-11-17 | Plain public addresses, at the owner's request (no version, "preview" or "gateway" in them): a front door per environment, a Cloudflare Pages project whose code hands every request to the frontend Worker through a service binding (Pages is the only free Cloudflare product with a one-word address). It serves a build made for its address and sends the pages of any other build to the address that build names, so it switches over by itself at the next release and never breaks the app before. Builds name their address in `/_nexus-build.json` (`site_url`); the frontend Worker sends pages opened on its own `workers.dev` address to the public one, because sign-in returns only there; the gateway accepts a list of origins. `release.py` builds for the public address and smoke-tests through it. Cloudflare cleanup: the PR3 Workers and queues deleted | 1 (9 front-door, 9 deploy-script, 3 new release and 7 new frontend tests; CORS list matched exactly); 2 for the path that serves the app (the built frontend Worker behind the front door over a real service binding, locally: pages with their script policy, files, the document shell and a 404, and `release.py`'s frontend smoke passed; on its own `workers.dev` address the Worker sends pages on with a 302); 4 for the redirect path (outside scans of both addresses) and for the gateway's origin list (released to the preview at `6fb3123`: preflights from both preview origins allowed, from production's address and another site refused; the workspace-deletion journey passed 19 of 19 checks) | `6fb3123`, `ffbb53f` |
| 2026-11-16 | Preview gateway released at `cc3fc24`; NX-16 workspace deletion verified live (see the live checks below). `preview_smoke.py` has a second journey, `--journey workspace-deletion`, which needs no model key, so it can be run on the preview whatever the Gemini key's state | 4 for workspace deletion (19 of 19 live checks, then the database checked directly); 1 for the journey itself (five faults each fail exactly their own check against an in-memory gateway) | `d6b490c` |
| 2026-11-15 | NX-27 done: reconciliation of file storage and the search index with the database. Two read-only reports (`20261114120000_storage_reconciliation.sql`) find stored files no row names (older than an hour, so an upload in progress is left alone), documents whose original is gone, index entries of versions that no longer exist, and answerable documents the index holds nothing of. The gateway logs the counts in the first cron run of each day (`store_reconciliation`, a warning when anything is found). `scripts/reconciliation.py` and the manual Store Reconciliation workflow show them, printing counts only because workflow logs are public, and remove leftovers only when given the count of a fresh report; the index is not touched while documents are missing from it. The report's queries, run read-only on production: 7 stored files, none without a document, no original missing | 3 for the reports (fresh replay with nine broken variants each refused by the assertions), 1 for the rest (974 gateway tests; 18 tool tests with eight broken variants each refused) | `36114ce`, `2253a3a`, `b7e8250` |
| 2026-11-14 | NX-28 follow-up: the first CI run failed in Firefox only, on the test, not the app: a browser revalidates a page it has stored, the 304 it gets carries no policy by design, and Firefox reports that 304 where Chromium and WebKit report the stored page. The test now reads each page's policy from a fresh request and checks in the browser that an injected inline script and a request to another origin are refused, also on a stored page opened again | 2 ([CI](https://github.com/Anupam0202/NexusRAG/actions/runs/43602062101): Chromium, mobile Chrome, Firefox, WebKit and mobile WebKit; three broken variants each fail locally) | `7d45ec3` |
| 2026-11-14 | NX-28 done: every page gets `script-src 'self'` plus the hashes of the inline scripts in that response (the Worker computes them: OpenNext re-renders pages, so the build's HTML has different ones) and `connect-src 'self'` plus the gateway and Supabase origins of the build; static files get `script-src 'self'`; HEAD and 304 carry no policy so a revalidated page keeps its own. The 27 page copies reachable as `/<page>.html` without the Worker are no longer published (only the document shell), and the build fails if one reappears. `release.py` refuses a frontend without both directives | 2 (on the built Worker: sixteen public pages hydrate with no violation in Chromium and mobile Chrome, and fail with a wrong hash; 832 frontend unit, 26 release, 967 gateway tests) | `9d8a99a` |
| 2026-11-14 | Owner walkthrough checklist (`docs/completion/OWNER_WALKTHROUGH.md`): sixteen steps from Google sign-in to sign-out, covering the Tier 1 journey and the final regression list of section 13, with the exact labels the app shows | n/a | `f9b8286` |
| 2026-11-14 | NX-36: `workspace_id` indexed as the Qdrant tenant (`is_tenant`), falling back to a plain index on a cluster that refuses it; existing indexes are no longer requested again, which saves four requests per indexing batch under the Workers Free limit of 50 | 1 (new-collection, upgrade, refusal and failure tests; 967 gateway tests) | `e2b597a` |
| 2026-11-14 | NX-38: every GitHub Action pinned to the commit its major tag points to today (no change in what runs), version in a comment. NX-32 checked: claims are compare-and-swap, so a second sweep cannot double-process a job | CI | `933e649` |
| 2026-11-14 | NX-27: found in the upload path: the original was stored before its document row was written, and nothing removed it when that write failed, leaving a file no one could list or delete. It is now removed when the row cannot be written | 1 (a test with the row write refused; it fails without the fix; 964 gateway tests) | `25c4c72` |
| 2026-11-14 | NX-24: users' Gemini keys are sealed for their user (associated data names the user, the provider and the sealing secret's id), so a ciphertext copied into another row does not open; older keys still open. Rotation: a previous secret can be set while the daily cron re-seals keys with compare-and-swap, which never writes back a key replaced or deleted meanwhile; both deploy workflows ship the previous secret when it is set | 1 (sealing, binding, old format, rotation and sweep tests; 963 gateway tests; workflow scripts checked) | `c029b1d` |
| 2026-11-14 | NX-26: Supabase stops accepting the legacy service key at the end of 2026, and its secret keys are refused as Bearer tokens, which is how every gateway call, both deploy workflows and `provider_review.py` sent the key. They now send a secret key in `apikey` only and a legacy key as before (`supabase-keys.js`), so the key can be swapped without a code change (owner action 7) | 1 (helper, route-level and Python tests; 960 gateway tests; workflow scripts checked with `bash -n` and both key kinds) | `ebb460c` |
| 2026-11-14 | NX-17: CALCULATION is the twelfth run mode. Gemini only points at the figures the passages state (passage, number, unit in one or two pieces, period, each as written) and names operations; the gateway computes exactly (BigInt decimals, half to even) and the step function stores a step only when every figure stands where the step says and every result equals `nexus_calculate_binary`, so no number can come from the model. Results show the formula, units, rounding and marked passages, and can be saved as findings for a second member's review. Finished runs list the plan's completion criteria and say what to do next; stopped runs say why in words. The obligation-evidence assertions now find the Radar barrier anywhere in the finding view's chain of wrappers (NX-34) | 3 (real-SQL integration through the production executor: 420 arithmetic parity cases, a three-step run, nine tampered commits refused, second-member review, cancel/resume, provider failures; 956 gateway and 821 frontend tests; 204 research browser tests) | `8d650f6` |
| 2026-11-13 | README rewritten: what the app does, honest status and limits, architecture, layout, tests, configuration, deployment, security; the README contract tests keep their checks against the new sections | 1 (script tests) | `40f0860` |
| 2026-11-13 | NX-27 account deletion (security settings, typed confirmation): owned workspaces go through workspace deletion; in other workspaces private conversations and unshared findings are removed and uploaded documents and shared findings go to that workspace's owner; memberships and invitations go; then Supabase Auth removes the sign-in, profile, keys and usage. Each status check repeats the cleanup, so a workspace created meanwhile is deleted too. Found: the membership trigger and RESTRICT keys made every used account undeletable, even from the dashboard | 3 (assertions incl. an Auth-style user delete on fixtures-only and populated databases, 85 markers; 945 gateway and 797 frontend tests) | `9611537` |
| 2026-11-13 | Firefox logged "Acquiring an exclusive Navigator LockManager lock ... immediately failed" on every page (new Firefox reports the Supabase client's handled lock error as unhandled); a lock wrapper reports it outside the browser's callback | 1 (unit tests; CI's Firefox suite checks it) | `4fffc89` |
| 2026-11-13 | NX-30, NX-40: navigation follows the core journey; products in development are switched off by `NEXT_PUBLIC_FEATURES` (D10); plain overview page without placeholder statuses; error screens with a retry; plain wording; publishable key name first. Playwright 1.60 → 1.63 so CI and this container use the same Chromium; visual baselines regenerated | 2 (built app: 48 public smoke and 4 visual tests, Radar and Evidence API browser suites; 783 unit tests) | `cb90337` |
| 2026-11-13 | NX-16 workspace deletion: the owner types DELETE WORKSPACE; the workspace disappears for every member at once; jobs stop; its search index entries (by workspace filter, counted and verified) and stored originals (known keys, then anything left in its folder) are removed with receipts; one database function then removes every row of every table that has a `workspace_id`, checks that nothing is left and writes the last receipt; the cron finishes what a request could not. Members keep their accounts, Gemini keys and trial usage | 3 (assertions on a fixtures-only database and on the fully populated replay; 938 gateway and 777 frontend tests) | `73d950d` |

Live checks on the preview, 2026-11-16, gateway `cc3fc24`: `python3 scripts/preview_smoke.py --journey
workspace-deletion` passes 19 of 19 checks. Account A created a throwaway workspace, approved processing and stored
a document in it (its processing failed on the Gemini key, as expected); account B could neither open nor delete
it; a confirmation in the wrong letter case was refused and left it in place; the deletion answered HTTP 200
`DELETED` with three receipts; the workspace left its owner's list at once and its document could not be reached
through it or through another workspace. In the database: the operation is `verified` with receipts from Qdrant,
Supabase Storage and the database; the targets record one stored file removed, no index entries and the rows
(one document, one member); no table with a `workspace_id` holds a row of it, no file is stored under it, and the
audit trail has its `workspace.delete` event. The core journey passes 12 of 13 checks and stops at "ingestion
completes" with Gemini's credit message; its clean-up deleted the test document (HTTP 200 `DELETED`). Afterwards the
project holds no document, no stored file, no open deletion and no open job.

Live checks on the preview, 2026-11-13 evening: with the deletion migration applied (19:40 UTC), the cron finished
the three test documents stuck in `deleting` (19:45 and 19:50; all five cleanup targets verified, five receipts
each: Qdrant, Supabase Storage and three database ones; rows gone). Gateway `f589e7b`, account A: privacy settings
report retention as supported; turning it on with 1 day made a run due at once; "Run now" removed a test document
uploaded three days earlier (erased by the cron at 19:50 with three receipts; it had no stored file or index
entries), two three-day-old messages and the old conversation title, and moved the next run to the next day;
turning it off kept the day count; the three changes are in the audit trail.

Live checks on the preview, 2026-11-13, gateway `5262bff` (account B): a streamed question returns
`text/event-stream` with a `done` event; a document whose processing fails is listed as `error` with Gemini's
credit message; re-uploading it answers 409 `DUPLICATE_FAILED` with what to do; deleting it hides it at once and
answers 202 "still being erased" (the migration is not applied yet).

Live journey on the preview, 2026-11-12, gateway `3396cb0` (`python3 scripts/preview_smoke.py`): 11 of 12
checks pass — sign-in for both accounts, separate workspaces, processing policy, upload accepted (202). The
twelfth, "ingestion completes", fails with the gateway's own explanation: "Gemini refused the request because
the API key's project has no prepaid credit left."

## Blockers and owner decisions
Owner actions, most urgent first (none can be done from a cloud session):
1. **Gemini key.** Replace the shared key with one that works: create a key in Google AI Studio in a project
   without prepaid billing (free tier), or add credit to the current project. Put it in the candidate Worker
   secret `GOOGLE_API_KEY` and the GitHub environments' `GOOGLE_API_KEY`. Until then nothing that uses the
   shared key can be verified live. The key supplied on 17 November belongs to a prepaid project without credit
   too (HTTP 402 on both pinned models, checked twice that day).
1a. **Supabase Auth addresses** (Authentication → URL Configuration), before the first release made for the
   public addresses: production `fcjaomiceajcdownarel` — Site URL `https://nexusrag.pages.dev`, add redirect URL
   `https://nexusrag.pages.dev/**`; rehearsal `ukgjygzfhyvnrsecdcuu` — Site URL
   `https://nexusrag-preview.pages.dev`, add `https://nexusrag-preview.pages.dev/**`, and remove the retired PR3
   redirect URLs. Optional, same visit: rename the production project from its generated name
   (`supabase-camel-drawer`) to `NexusRAG`.
2. **Preview deploys from this branch** (this also applies the pending rehearsal migrations without the Supabase
   connector, if `SUPABASE_DB_URL` is set in that environment). In GitHub → Settings → Environments → `NexusRAG-Candidate-Preview`,
   allow `codex/runtime-manifest-008` (or all branches) under deployment branches. The frontend preview cannot
   be deployed any other way.
3. **Keys for this cloud environment** (environment menu → Edit → Network secrets): Gemini (host
   `generativelanguage.googleapis.com`, header `x-goog-api-key`) and Qdrant (host
   `fc0c77d2-d9fd-4648-8459-09fa74372f16.eu-west-2-0.aws.cloud.qdrant.io`, header `api-key`).
4. **Before the first production release:** add `SUPABASE_DB_URL` and `GEMINI_USER_KEY_ENCRYPTION_SECRET` to the
   GitHub `Production` environment (list in `docs/DEPLOYMENT_PRODUCTION.md`). After the release, run the Provider
   Review workflow with `record`, then approve processing in each workspace.
5. **Merge PR #12** when ready; the ruleset's provider checks need a trusted push (D2) and item 1.
6. **1 December fallback, only if production is not released by 28 November:** production's September gateway
   reads `env.GEMINI_MODEL` (default `gemini-2.5-flash`, which Google reroutes to `gemini-3.5-flash-lite` on
   1 December) and always sends `thinkingBudget: 0`. Setting the production gateway variable
   `GEMINI_MODEL=gemini-2.5-flash-lite` (no shutdown date announced; a 2.5 model, so it accepts that setting)
   keeps production chat working. Check afterwards that the active version is still the 23 September code
   (`cd25c30b`), because Cloudflare's settings view shows the rolled-back 25 September version. The release
   itself also stops production putting the Gemini key in request URLs.
7. **Supabase secret keys, before 31 December 2026.** Supabase stops accepting the legacy `service_role` and `anon`
   keys at the end of 2026. In each project (rehearsal `ukgjygzfhyvnrsecdcuu`, production `fcjaomiceajcdownarel`):
   Settings → API Keys → create the secret key, then put it in place of the old value of `SUPABASE_SERVICE_ROLE_KEY`
   in that project's Worker secret and GitHub environment. The code accepts either kind (done log, NX-26) once
   it is released; `/ready` shows at once whether the database accepts the new key. Check too that the gateway's
   `SUPABASE_PUBLISHABLE_KEY` and the frontend's `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are `sb_publishable_...`
   keys rather than the legacy `anon` key (the frontend still falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

Decisions (D25 delegates product and technical decisions; exceptions in `MASTER_PROMPT.md`, section 9):
- D24 Gemini model policy: `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-flash-latest`;
  embeddings pinned to `gemini-embedding-001`.
- 2026-11-12: Qdrant and Supabase Storage are infrastructure and need only the operator's review; Gemini also
  needs the workspace owner's approval. Reason: the owner chooses whether their documents go to a model
  provider, not which database the service runs on.
- 2026-11-12: approvals no longer lapse after 30 days. Reason: every workspace silently stopped working a month
  after sign-up. They end when the terms change, on revocation, or when the approver stops being an owner.
- 2026-11-12: default daily budgets live in `provider_budget_defaults` (sized to the free tiers).
- 2026-11-12: the rehearsal project's provider reviews are a staging attestation by a test account; production
  needs the owner's own review (item 4).

## Next steps (exact commands)
0. When the owner approves the Supabase connector's confirmation: apply `20261113210000_account_deletion.sql`, then
   `20261114090000_research_calculation_runs.sql`, then `20261114120000_storage_reconciliation.sql`, then
   `20261117090000_ranked_keyword_search.sql` and `20261117120000_foreign_key_indexes.sql`, to rehearsal
   (without their outer `begin`/`commit`), check `get_advisors` and run
   `select public.nexus_storage_reconciliation(3600, 0)` once. Workspace deletion is applied and verified (16
   November; rerun it with `python3 scripts/preview_smoke.py --journey workspace-deletion`). Account deletion:
   check it with a third, throwaway test account only (never A or B): create the account, give it a workspace with a
   conversation, delete the account under Settings → Security, then check `account_deletions` shows it `verified`,
   the sign-in is gone and no table holds its rows. CALCULATION: create a Calculation plan over a document that
   states two figures and run it (needs a working Gemini key).
1. Preview gateway release (works from a cloud session). Release from a clean checkout of the commit
   (`git worktree add --detach <dir> <sha>`): the script deploys whatever is in the working directory.
   `CLOUDFLARE_API_TOKEN=proxy-injected CLOUDFLARE_ACCOUNT_ID=84e80d9629e0a6e6e5b31dbe85146acf
   SUPABASE_URL=https://ukgjygzfhyvnrsecdcuu.supabase.co SUPABASE_PUBLISHABLE_KEY=<rehearsal publishable key>
   WRANGLER="$PWD/frontend/node_modules/.bin/wrangler" python3 scripts/release.py gateway --target candidate
   --sha "$(git rev-parse HEAD)"`
2. Live journey: reset the test accounts' trial counters on rehearsal (`update public.nexus_account_usage set
   lifetime_documents = 0, free_chat_queries = 0 where user_id in (<the two test users>)`), then
   `python3 scripts/preview_smoke.py --report <file>` with the variables in its docstring.
3. Once a Gemini key works: `python3 scripts/check_gemini_models.py`, then
   `LIVE_EXTERNAL_VALIDATION=true PROVIDER_UNDER_TEST=gemini python3 scripts/live_provider_validation.py`, then
   test whether `gemini-3.5-flash-lite` accepts `thinkingBudget: 0`. If it does not, production chat breaks on
   2026-12-01 unless this gateway is released first (delegated, D25).
4. Once the Qdrant key is added: `GET /collections` and `GET /cluster` on the cluster address; record
   collections, point counts, vector size and payload indexes here.
5. Frontend preview: Actions → Cloudflare Preview Deploy → Run workflow on this branch with "deploy candidate
   preview" ticked; then check `/research`, `/radar`, `/evidence-api` return 200 and an unknown path 404, and that
   signed-in pages show no Content-Security-Policy errors in the browser console (the release checks the home page's
   policy; signed-in use was checked offline only). This is the first build made for
   https://nexusrag-preview.pages.dev: check that the address now serves the app itself (no redirect), that Google
   sign-in returns there, and that the Worker's own address sends pages to it.
6. NX-20 is built for chat; apply `20261117090000_ranked_keyword_search.sql` with the other pending rehearsal
   migrations (item 0), then ask a question whose answer is in a late passage of a long document and check the
   answer's `coverage.lexical_search` is `RANKED`.
6b. Once a Gemini key works: upload a PDF of 40 to 80 pages on the preview and check that it becomes Ready with
   `read: full` in its version's extraction manifest (NX-22); the long read has only run against a stand-in. The
   preview gateway already runs it (since `739c7c2`).
6a. Once the Qdrant key is available (item 4): `python3 scripts/reconciliation.py report --target candidate`, which
   is the first run of the index part against a real cluster (it reads entries with the scroll API; the gateway's
   daily check uses one facet request and reports `NOT_COUNTABLE` if the cluster cannot answer it).
7. Hosted migration status: save `list_migrations` output to a file, then
   `python3 scripts/migration_status.py status --applied <file>`.
