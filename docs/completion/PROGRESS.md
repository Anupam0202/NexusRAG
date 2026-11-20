# NexusRAG completion progress
Last updated: 2026-11-20 (late: front doors redeployed from `main`, master goal version 2). The goal and the ordered
remaining work are in `docs/completion/GOAL.md`.

## Handoff 2026-11-20 (late)
`main` has every pull request through the master goal's version 2 (`docs/completion/GOAL.md`, which says what is
left and in what order); each merge had every required check green on its exact head. Released: production runs
`2845818` at https://nexusrag.pages.dev and the preview runs `c56ec45` at https://nexusrag-preview.pages.dev, both
`/ready` READY; `main` differs from them only in release tooling, Worker configs and documents.
Done since the evening Handoff:
- the one-address pull request merged (`ce70830`); both front doors redeployed from `main`, their stale
  `FALLBACK_ORIGIN` variable removed (a deploy now removes the settings it no longer sets) and their older
  deployments deleted;
- the Provider Review workflow masks the reviewer's email before any step runs (the repository's logs are public);
- the owner signed in with Google on production and wrote "I have read the terms and accept best recommendations"
  (their decisions are under "Ledger status");
- found live: NX-50, erasure waits on the provider review. Production's document `6e799056`, marked for deletion on
  23 September, is still stored; every cron attempt logs `document_deletion_open` with `PROVIDER_REVIEW_REQUIRED`.
Agent work next (GOAL.md phase 1): record production's provider review unless a session already has, check that the
stuck deletion finishes, fix NX-50, release `main` to both targets and rerun both journeys; then phase 2.
Owner actions (GOAL.md section 5): the walkthrough after phase 2; the Supabase secret keys before the end of 2026;
the repository's website and branch settings; revoking the Supabase tokens pasted into the chat; whether the 13:37
snapshot schema may be dropped.

## Current state
- `main`: every pull request through the master goal's version 2 (20 November); new work goes on a branch from
  `main` and a pull request.
- Production, https://nexusrag.pages.dev: gateway `nexusrag-v6-preview-gateway` and frontend
  `nexusrag-v6-frontend-preview` at `2845818` (Production Deploy run 44751846631, 20 November); Supabase
  `fcjaomiceajcdownarel` with every migration (81 recorded, the last `20261120133842`); 8 accounts; 8 documents from
  June to September 2026: seven without a published version (shown as "Upload again", NX-03) and `6e799056`, marked
  for deletion on 23 September (operation `dbcc76fa`, blocked by NX-50); Qdrant collection `nexusrag-v6-preview`; no
  provider review recorded yet; snapshot schema `backup_20261120133700_2845818` kept until the owner decides.
- Preview, https://nexusrag-preview.pages.dev: gateway `nexusrag-v6-candidate-gateway` and frontend
  `nexusrag-v6-candidate-frontend` at `c56ec45` (Cloudflare Preview Deploy run 44756110282); Supabase
  `ukgjygzfhyvnrsecdcuu`, built from the baseline, with every later migration (59 recorded, the last
  `20261120135522`); 4 accounts, no documents; provider reviews: a staging attestation by test account A, valid until
  2027-11-12; Qdrant collection `nexusrag-v6-candidate`. Test accounts `nexus-e2e-a@nexusrag.test` and
  `nexus-e2e-b@nexusrag.test`, each with an approved workspace; account A has used its trial document.
- Front doors: Pages projects `nexusrag` (deployment `13344750`) and `nexusrag-preview` (deployment `e2434644`),
  deployed from `main` with `scripts/front_door.py` on 20 November. Each binds its frontend Worker as `APP` and its
  gateway Worker as `GATEWAY`, has one variable (`PUBLIC_ORIGIN`) and keeps only that deployment, whose own
  `<id>.<project>.pages.dev` address answers 308 to the public one.
- Cloudflare: Workers `nexusrag-v6-preview-gateway`, `nexusrag-v6-frontend-preview`, `nexusrag-v6-candidate-gateway`
  and `nexusrag-v6-candidate-frontend`, none with a `workers.dev` or version preview address (error 1042); queues
  `nexusrag-v6-preview-ingestion`, `nexusrag-v6-candidate-ingestion` and their DLQs; the two Pages projects. No KV,
  D1, R2, Hyperdrive or zones.
- Supabase Auth: each project's Site URL and redirect list name only its `pages.dev` address (set by the owner on
  20 November; the probe refuses the old `workers.dev`, `vercel.app` and PR3 addresses).
- Providers: Gemini answers with the owner's key of 20 November in all three GitHub environments (live validation on
  `main`; the preview journey used `gemini-3.5-flash-lite` and `gemini-embedding-001`). Qdrant cluster
  `fc0c77d2-d9fd-4648-8459-09fa74372f16` (AWS eu-west-2), with the owner's key of 20 November, is READY on both
  gateways and kept awake by the daily cron.
- Live journeys on the preview, 20 November: core 26 of 26 (Ready in 10 s, a cited answer, isolation, deletion with
  receipts); workspace deletion stopped at account A's free-trial limit (BYOK_REQUIRED), as expected.
- Plan: `docs/completion/MASTER_PROMPT.md`; goal: `docs/completion/GOAL.md`; repository notes: `CLAUDE.md`.

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
| Orphans | — | rehearsal none; production: no file without a document, one document whose file is gone | 0 | That document is the one marked for deletion on 23 September (NX-47); on 20 November its deletion still waited on the provider review (NX-50). Qdrant points not counted: this session has no key for the cluster |
| CI wall-clock | 19m41s to 23m52s for V6 Foundation CI (12 October) | V6 Foundation CI 20m56s, V6 Database Rehearsal 7m30s (`729c4ec`) | — | No regression |
| Chat time to first token and total time, p50 and p95 | — | not measured | — | The key works since 20 November; measured over 20 answers in GOAL.md phase 2 |

## Ledger status, 2026-11-20
Section 13 needs every ledger item (MASTER_PROMPT Part 2, section D) fixed and verified, or accepted by the owner
in chat with a reason. Where each one stands:
- Closed, fixed and verified live: NX-02 (both targets released on 20 November), NX-07, NX-08 (production has every
  migration), NX-12 and NX-13 (both deploy workflows ran end to end on 20 November), NX-16, NX-23, NX-40 (both Auth
  allow-lists name only `pages.dev`), and NX-47 on the preview. Fixed and verified in CI: NX-09, NX-10, NX-11.
  Checked on both hosted projects, with a replay assertion that keeps it so: NX-19 (re-run after each migration
  batch). Resolved: NX-43, NX-48, NX-49.
- Released on both targets and passing the releases' browser tests; GOAL.md phase 2's check of every page closes
  them: NX-01, NX-28, NX-30.
- Released; the live check is in GOAL.md phase 2: NX-03, NX-04, NX-05 (the core journey's isolation checks passed on
  20 November; the two-tab check is left), NX-06 (live validation passed; production runs the model policy before
  1 December), NX-14, NX-17, NX-18 (each release installs its environment's encryption secret, and Production Deploy
  refuses to run without it), NX-20, NX-21, NX-22's long PDF, NX-24, NX-27, NX-36.
- Open: NX-50 (erasure waits on the provider review; GOAL.md phase 1); NX-47 on production (finishes once the review
  is recorded); NX-26 (the Supabase secret keys, an owner input before the end of 2026).
- The owner's decisions, 20 November ("I have read the terms and accept best recommendations"):
  - accepted as they are: NX-22's remainder (no PDF text layer or page splitting on the free plan), NX-25 (the
    per-user limit is approximate; a strict one needs a Durable Object), NX-32 (claims are safe while each
    environment has its own Supabase project), NX-33's remainder (RPCs take the Worker's context; moving reads to
    the user's token is long-term work), NX-41 (leaked-password protection does not apply to Google-only sign-in)
    and NX-42's remainder (provisional limits; an alert on `LEASE_EXHAUSTED` once there is real usage);
  - NX-35: stay on Workers Free until there is real usage (D5);
  - NX-15: remove Procurement and Passport for now (D11); NX-31: remove the Python backend (D4); NX-38: add
    Dependabot for GitHub Actions;
  - the cleanup pull requests (D13, D20 to D22): NX-29, NX-34, NX-37, NX-39, NX-44 with its table drops, NX-45,
    NX-46, and the split of `src/lib/api.ts`;
  - production is verified with the preview's test accounts plus the owner's own walkthrough; no test accounts are
    created in production.

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
| 2026-11-20 | Found live: NX-50, erasure waits on the operator's provider review. Production's document `6e799056`, marked for deletion on 23 September, was still stored after the release: operation `dbcc76fa` is `blocked`, its two index targets verified in September, the original files and the database rows left; every five-minute cron attempt logs `document_deletion_open` with `PROVIDER_REVIEW_REQUIRED`, because index deletions go through the same metered admission as processing (`worker-lifecycle.js` `del` → `metered` → `v6_reserve_budget`), which refuses without a current review. Workspace and account deletion and retention runs share the path, on every deployment, whenever a review is missing or lapses | 4 (found live) | GOAL.md phase 1 |
| 2026-11-20 | Master goal version 2 (`docs/completion/GOAL.md`): what complete means, the owner's grant and the 20 November decisions, the credentials a session reaches, the owner's remaining inputs, phases 1 to 5 and the acceptance checklist. The owner's ledger decisions recorded under "Ledger status" | n/a | this change |
| 2026-11-20 | The Provider Review workflow masks the reviewer's email: it is read from the event payload and masked before any step runs, and is never an `env:` value, which each step's public log prints in clear. `front_door.py deploy` removes the variables and bindings it no longer sets (Cloudflare merges a PATCH into the project's settings, so `FALLBACK_ORIGIN` had stayed on both projects) | 2; 4 for the front doors | this change |
| 2026-11-20 | PR #18 merged (`ce70830`): the four Workers stay off `workers.dev`. Both front doors redeployed from `main` (deployments `e2434644` preview and `13344750` production), without `FALLBACK_ORIGIN`, and their four older deployments deleted. Checked: `/ready` READY on both, home pages 200 served directly, a deployment's own address 308 to the public one, the four `workers.dev` addresses error 1042 | 4 | `ce70830` |
| 2026-11-20 | One address per target, finished (GOAL.md phase B2): the owner set both Supabase projects' Site URL and redirect list to their `pages.dev` address only (probe: `pages.dev` returns accepted, the old `workers.dev`, `vercel.app` and PR3 returns refused); `workers_dev` and `preview_urls` are off in the four Wrangler configs and `release.py` refuses a config that turns either on; the four Workers' `workers.dev` addresses were turned off live (error 1042); `FRONTEND_ORIGIN` names only the public address and the front door no longer gets a `workers.dev` fallback. Both public addresses stayed READY. | 3 (Supabase probes; the four old addresses answer 1042; both public addresses READY) | the one-address pull request |
| 2026-11-20 | Released both targets. Production: Production Deploy run 44751846631 (`2845818`; database already migrated; gateway and frontend smoke tests and 52 browser tests passed). The attempt before it, run 44750151552, was rolled back automatically because production's `QDRANT_API_KEY` was refused; the owner replaced it. The preview: runs 44750157831 (`2845818`) and 44756110282 (`c56ec45`, after the owner's new Qdrant key, the first release through `release.py preflight`). In Chromium every main page of https://nexusrag.pages.dev renders at that address with no console error, failed request or policy violation; `/research` and unknown paths no longer crash on the preview (NX-01 live). The owner's new `GOOGLE_API_KEY` answers real requests (live validation on `main`). | 3 | runs 44751846631, 44756110282 |
| 2026-11-20 | Incident: Cloudflare Preview Deploy run 44745817620 (13:37 UTC) applied 35 migrations, `035_atomic_workspace_management_and_finding_exports` to `20261117120000_foreign_key_indexes`, to the production database: `NexusRAG-Candidate-Preview`'s `SUPABASE_DB_URL` named `fcjaomiceajcdownarel`, and nothing compared the database address with the target. The snapshot `backup_20261120133700_2845818` was taken first; the production log shows no error afterwards and the September gateway still answers. The run then stopped at the candidate's Cloudflare token (HTTP 401) before deploying. Fix: `release.py preflight`, run in both workflows' configuration step before any snapshot or migration, refuses a database address that names another project (or none), a Cloudflare token Cloudflare refuses (now named as such), and a public address that does not answer as the gateway. | 2 (unit and workflow-order tests); the incident facts from the run log and both projects' migration lists | the release-preflight pull request |
| 2026-11-20 | Owner inputs arrived: `SUPABASE_DB_URL` in `Production` and `NexusRAG-Candidate-Preview`, `main` allowed in `NexusRAG-Candidate-Preview` (its old rules removed), a new `GOOGLE_API_KEY` in all three environments. Gemini Model Check run 44744223496 with the new key: all four configured models served. The 10:13 UTC check before them found nothing changed (Production Deploy run 44717418506 stopped at its configuration check; Cloudflare Preview Deploy run 44717423796 was refused). | n/a | n/a |
| 2026-11-20 | One address per target, at the owner's request (only https://nexusrag.pages.dev and https://nexusrag-preview.pages.dev): the front doors hand `/api/*`, `/health` and `/ready` to the gateways through a `GATEWAY` binding and send every other address of their Pages project (each deployment's own `<id>.<project>.pages.dev`, plain `http://`) to the public one with a 308; `scripts/release.py` builds the app for its public address and refuses to build or release while that address does not answer `/health` as the target's gateway, and `scripts/front_door.py deploy` waits for that answer. Both front doors deployed; their older deployments, which still served the app at their own addresses, deleted (four on the preview, two on production). | 3 (preview: `/health` and `/ready` from the gateway, signed-out API 401, CORS preflight from the public origin allowed, the test account's signed-in `/api/v2/capabilities` 200 as at the gateway's own address, the deployment's own address 308 to the public one; production: `/health` from the production gateway, signed-out API 401; its September gateway answers `/ready` with 401 and allows only its own frontend's origin, the same at its own address, until its release) | PR #14, `e7eda08` |
| 2026-11-20 | Phase C checks while waiting on the owner: Workers logs show no error event in the last day for either gateway and none in six hours for the production frontend; the preview frontend's only exceptions are NX-01's (`Unexpected loadManifest(/.next/server/preview-props.json)`), raised by bots probing paths such as `/phpinfo.php`, and fixed on `main` for its next release. Supabase Auth still sends both `pages.dev` returns to the old Site URLs (probe), the saved Supabase token is still refused (401), and the repository's website still names the candidate's `workers.dev` address (owner action 6). | n/a | n/a |
| 2026-11-20 | PR #12 merged into `main` as `90d1b80` (squash, 217 commits), at the owner's request. The merge first named two missing requirements, "Bounded gemini validation" and a successful `Preview` deployment; the trusted push of the exact head to `release/production-20261120` (D2) ran V6 Live Provider Validation, whose Gemini and Qdrant checks passed (the `Preview` environment's Gemini key works) and recorded the deployment, and the merge then went through | CI on the head ([foundation](https://github.com/Anupam0202/NexusRAG/actions/runs/44495098342), [rehearsal](https://github.com/Anupam0202/NexusRAG/actions/runs/44495098492)) and [live provider validation](https://github.com/Anupam0202/NexusRAG/actions/runs/44667324802); the merge commit's tree equals the head's | `90d1b80` |
| 2026-11-20 | Production Deploy of `90d1b80` stopped safely at its configuration check: `SUPABASE_DB_URL` is missing from the `Production` environment; nothing was changed. Cloudflare Preview Deploy from `main` was refused because its environment does not allow `main`. In Chromium, production (September build) shows "Backend offline" and GitHub-only sign-in, and the preview's October frontend still crashes with Error 1101 off the prerendered pages. Neither Supabase project accepts its `pages.dev` address as a sign-in return | [production run](https://github.com/Anupam0202/NexusRAG/actions/runs/44669070315), [preview run](https://github.com/Anupam0202/NexusRAG/actions/runs/44669231783); browser screenshots in the session; the Auth probe in GOAL.md section 4 | n/a (records only) |
| 2026-11-19 | NX-49 fixed without a change here, found by the scheduled check: Alpine 3.24 published OpenSSL `3.5.9-r1` (`libssl3` and `libcrypto3`, built 18 November 23:31 UTC), the Dockerfile's `apk upgrade` took it, and the scanner no longer matches the five CVEs. OpenSSL's own 3.5.10 is still unreleased. V6 Foundation CI is green in full again, with both of 18 November's red scans cleared upstream and neither gate loosened. The same check found `npm audit` clean and the saved Supabase access token still refused | CI: the re-run of the failed jobs on `9ba33ef` ([run 44408142054](https://github.com/Anupam0202/NexusRAG/actions/runs/44408142054), attempt 2): every job passes; the image scan reports `Findings: {}` with no match ignored | n/a (records only) |
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
Owner actions, in order (GOAL.md section 5 has each step):
1. The walkthrough on production once GOAL.md phase 2 passes (checklist: `docs/completion/OWNER_WALKTHROUGH.md`),
   confirmed in chat.
2. Supabase secret keys before 31 December 2026 (NX-26): in each project (rehearsal `ukgjygzfhyvnrsecdcuu`,
   production `fcjaomiceajcdownarel`), Settings → API Keys → create a secret key and put it in place of
   `SUPABASE_SERVICE_ROLE_KEY` in that project's GitHub environment. The agent releases and verifies both targets;
   then the legacy keys can be disabled.
3. Repository settings: Website `https://nexusrag.pages.dev`; "Automatically delete head branches"; delete the merged
   branches the agent lists (a session cannot delete branches).
4. Revoke the Supabase access tokens pasted into the chat on 20 November; say whether production's snapshot schema
   `backup_20261120133700_2845818` may be dropped.

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
  needs the owner's own review (GOAL.md phase 1).
- 2026-11-20: the owner's ledger decisions ("Ledger status").
- 2026-11-20: erasure never waits on the operator's provider review (NX-50). Reason: the review decides what may be
  sent to a provider, not whether data already stored there may be removed.

## Next steps (exact commands)
GOAL.md section 6 sets the order; these are the commands.
1. Provider review (production): Actions → Provider Review → target `production`, action `status`. If a provider is
   not current: action `record`, `reviewer_email` = the owner's account (the most recent Google sign-in in
   production's `auth.users`; never repeat it anywhere), `i_have_read_the_terms` ticked. Then the stuck deletion:
   `select state, verified_at from public.deletion_operations where id = 'dbcc76fa-f348-46a3-91b3-83b879f353e8'`
   (read-only, through the connector), until it is `verified`.
2. Releases: Actions → Cloudflare Preview Deploy → branch `main`, `deploy_candidate_preview` ticked; then Actions →
   Production Deploy → `release_sha` = the current `main` commit. Check `/ready` on both addresses afterwards.
3. Journeys: on rehearsal, delete the two test accounts' rows in `public.nexus_account_operations` and
   `public.nexus_account_usage`; then, with the variables in `scripts/preview_smoke.py`'s docstring and
   `SMOKE_GATEWAY_URL=https://nexusrag-preview.pages.dev`, run
   `python3 scripts/preview_smoke.py --journey workspace-deletion --report <file>` and `--journey core`.
4. Hosted migration status: save the connector's `list_migrations` output to a file and run
   `python3 scripts/migration_status.py status --applied <file>`, or with `SUPABASE_DB_URL` set, without `--applied`.
5. Reconciliation: Actions → Store Reconciliation → each target, action `report`.
6. Front doors: `CLOUDFLARE_API_TOKEN=proxy-injected CLOUDFLARE_ACCOUNT_ID=84e80d9629e0a6e6e5b31dbe85146acf
   python3 scripts/front_door.py deploy --target candidate|production`, then delete the project's older deployments.
7. Workers logs: `POST https://api.cloudflare.com/client/v4/accounts/84e80d9629e0a6e6e5b31dbe85146acf/workers/observability/telemetry/query`
   with a filter on `$metadata.service`; warnings such as `document_deletion_open` are in each event's `source`.
