# NexusRAG completion progress
Last updated: 2026-11-14 — document deletion and retention verified live on the preview; workspace and account
deletion built and green in CI (live once their migrations are applied); README rewritten; CALCULATION runs built
(NX-17); the live journey still stops at ingestion on the shared Gemini key's HTTP 402

## Current state
- main: `85b14f1`; working branch: `codex/runtime-manifest-008` (draft PR #12, owner-approved for direct
  commits on 2026-11-09); open PRs: #12
- Plan: `docs/completion/MASTER_PROMPT.md`; repository notes: `CLAUDE.md`
- Candidate preview: gateway `f589e7b` (version `cb022eae`), released 2026-11-13 19:46 UTC (smoke test and `/ready`
  passed: database reachable, search index ready, collection `nexusrag-v6-candidate` empty). Frontend is still the old
  build `2fbc5c9`, whose `/research`, `/radar`, `/evidence-api` and unknown paths return 500 (NX-01): a cloud
  session cannot upload frontend assets, and the preview workflow rejects this branch (environment branch rule).
- Rehearsal Supabase (`ukgjygzfhyvnrsecdcuu`): 53 migrations applied (document deletion and retention on
  2026-11-13); pending: `20261113190000_workspace_deletion` (its apply waits for the owner to answer the Supabase
  connector's confirmation; asked on 13 and 14 November, both timed out unanswered),
  `20261113210000_account_deletion` and `20261114090000_research_calculation_runs`. No document is left in `deleting`. Advisors: only leaked-password protection
  (an Auth setting). Test account A has used its trial upload and B its trial upload; reset both before the next
  journey. Provider reviews recorded for Gemini, Qdrant and Supabase Storage (staging attestation by test account
  A, valid to 2027-11-12). Two test accounts (`nexus-e2e-a@nexusrag.test`, `nexus-e2e-b@nexusrag.test`), each
  with an approved workspace.
- Production: `nexusrag-v6-frontend-preview` v29 → `nexusrag-v6-preview-gateway` v52, both from 23 September,
  on Supabase `fcjaomiceajcdownarel` (35 migrations applied, 38 pending from 035 onward) and collection
  `nexusrag-v6-preview`. The live gateway still defaults to `gemini-2.5-flash` with `thinkingBudget: 0`, has no
  `GEMINI_USER_KEY_ENCRYPTION_SECRET`, and nothing has been changed there.
- Gemini: the candidate Worker's shared key answers **HTTP 402** (its Google project is prepaid and has no
  credit; Google enforces this since March 2026). Every ingestion and every chat on the shared key fails.
- Qdrant: cluster `fc0c77d2-d9fd-4648-8459-09fa74372f16` (AWS eu-west-2) stopped serving between 9 and 11
  November and serves again since 12 November. The preview gateway reaches it with its own key (`/ready`:
  READY). The daily keep-alive is live on the preview from `4864133`; production gets it with the release.

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
| 2026-11-14 | Owner walkthrough checklist (`docs/completion/OWNER_WALKTHROUGH.md`): sixteen steps from Google sign-in to sign-out, covering the Tier 1 journey and the final regression list of section 13, with the exact labels the app shows | n/a | this commit |
| 2026-11-14 | NX-36: `workspace_id` indexed as the Qdrant tenant (`is_tenant`), falling back to a plain index on a cluster that refuses it; existing indexes are no longer requested again, which saves four requests per indexing batch under the Workers Free limit of 50 | 1 (new-collection, upgrade, refusal and failure tests; 967 gateway tests) | this commit |
| 2026-11-14 | NX-38: every GitHub Action pinned to the commit its major tag points to today (no change in what runs), version in a comment. NX-32 checked: claims are compare-and-swap, so a second sweep cannot double-process a job | CI | this commit |
| 2026-11-14 | NX-27: found in the upload path: the original was stored before its document row was written, and nothing removed it when that write failed, leaving a file no one could list or delete. It is now removed when the row cannot be written | 1 (a test with the row write refused; it fails without the fix; 964 gateway tests) | `25c4c72` |
| 2026-11-14 | NX-24: users' Gemini keys are sealed for their user (associated data names the user, the provider and the sealing secret's id), so a ciphertext copied into another row does not open; older keys still open. Rotation: a previous secret can be set while the daily cron re-seals keys with compare-and-swap, which never writes back a key replaced or deleted meanwhile; both deploy workflows ship the previous secret when it is set | 1 (sealing, binding, old format, rotation and sweep tests; 963 gateway tests; workflow scripts checked) | `c029b1d` |
| 2026-11-14 | NX-26: Supabase stops accepting the legacy service key at the end of 2026, and its secret keys are refused as Bearer tokens, which is how every gateway call, both deploy workflows and `provider_review.py` sent the key. They now send a secret key in `apikey` only and a legacy key as before (`supabase-keys.js`), so the key can be swapped without a code change (owner action 7) | 1 (helper, route-level and Python tests; 960 gateway tests; workflow scripts checked with `bash -n` and both key kinds) | `ebb460c` |
| 2026-11-14 | NX-17: CALCULATION is the twelfth run mode. Gemini only points at the figures the passages state (passage, number, unit in one or two pieces, period, each as written) and names operations; the gateway computes exactly (BigInt decimals, half to even) and the step function stores a step only when every figure stands where the step says and every result equals `nexus_calculate_binary`, so no number can come from the model. Results show the formula, units, rounding and marked passages, and can be saved as findings for a second member's review. Finished runs list the plan's completion criteria and say what to do next; stopped runs say why in words. The obligation-evidence assertions now find the Radar barrier anywhere in the finding view's chain of wrappers (NX-34) | 3 (real-SQL integration through the production executor: 420 arithmetic parity cases, a three-step run, nine tampered commits refused, second-member review, cancel/resume, provider failures; 956 gateway and 821 frontend tests; 204 research browser tests) | `8d650f6` |
| 2026-11-13 | README rewritten: what the app does, honest status and limits, architecture, layout, tests, configuration, deployment, security; the README contract tests keep their checks against the new sections | 1 (script tests) | `40f0860` |
| 2026-11-13 | NX-27 account deletion (security settings, typed confirmation): owned workspaces go through workspace deletion; in other workspaces private conversations and unshared findings are removed and uploaded documents and shared findings go to that workspace's owner; memberships and invitations go; then Supabase Auth removes the sign-in, profile, keys and usage. Each status check repeats the cleanup, so a workspace created meanwhile is deleted too. Found: the membership trigger and RESTRICT keys made every used account undeletable, even from the dashboard | 3 (assertions incl. an Auth-style user delete on fixtures-only and populated databases, 85 markers; 945 gateway and 797 frontend tests) | `9611537` |
| 2026-11-13 | Firefox logged "Acquiring an exclusive Navigator LockManager lock ... immediately failed" on every page (new Firefox reports the Supabase client's handled lock error as unhandled); a lock wrapper reports it outside the browser's callback | 1 (unit tests; CI's Firefox suite checks it) | `4fffc89` |
| 2026-11-13 | NX-30, NX-40: navigation follows the core journey; products in development are switched off by `NEXT_PUBLIC_FEATURES` (D10); plain overview page without placeholder statuses; error screens with a retry; plain wording; publishable key name first. Playwright 1.60 → 1.63 so CI and this container use the same Chromium; visual baselines regenerated | 2 (built app: 48 public smoke and 4 visual tests, Radar and Evidence API browser suites; 783 unit tests) | `cb90337` |
| 2026-11-13 | NX-16 workspace deletion: the owner types DELETE WORKSPACE; the workspace disappears for every member at once; jobs stop; its search index entries (by workspace filter, counted and verified) and stored originals (known keys, then anything left in its folder) are removed with receipts; one database function then removes every row of every table that has a `workspace_id`, checks that nothing is left and writes the last receipt; the cron finishes what a request could not. Members keep their accounts, Gemini keys and trial usage | 3 (assertions on a fixtures-only database and on the fully populated replay; 938 gateway and 777 frontend tests) | `73d950d` |

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
   shared key can be verified live.
2. **Preview deploys from this branch.** In GitHub → Settings → Environments → `NexusRAG-Candidate-Preview`,
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
0. When the owner approves the Supabase connector's confirmation: apply `20261113190000_workspace_deletion.sql`, then
   `20261113210000_account_deletion.sql`, then `20261114090000_research_calculation_runs.sql`, to rehearsal (without
   their outer `begin`/`commit`), check `get_advisors`,
   release the gateway from a clean checkout of the commit (step 1), then as test account A create a throwaway
   workspace, give it a conversation, delete it with the typed confirmation, and check that `deletion_operations`
   shows it verified with three receipts and that no table holds its rows. Account deletion: check it with a third,
   throwaway test account only (never A or B).
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
   preview" ticked; then check `/research`, `/radar`, `/evidence-api` return 200 and an unknown path 404.
6. Build next, none of which needs the keys: a Postgres/Storage/Qdrant reconciliation job (rest of NX-27); a
   nonce-based script policy (rest of NX-28).
7. Hosted migration status: save `list_migrations` output to a file, then
   `python3 scripts/migration_status.py status --applied <file>`.
