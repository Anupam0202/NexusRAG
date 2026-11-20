# NexusRAG: continuation prompt (18 November 2026)

This prompt replaces the session goal set on 9 November ("follow MASTER_PROMPT.md until every item in section 13 is
satisfied"). That goal could not stop while the remaining items waited on the repository owner, so every stop was
refused in a loop. The plan, the issue ledger and the acceptance criteria stay in `docs/completion/MASTER_PROMPT.md`,
and the live state stays in `docs/completion/PROGRESS.md`. This file says what is left, in what order, who does each
step, and when a session may stop.

## Goal

Set this as the session goal, in place of the old one:

> Finish NexusRAG on branch `codex/runtime-manifest-008` (PR #12) of `Anupam0202/NexusRAG` by following
> `docs/completion/CONTINUATION_PROMPT.md`, resuming from `docs/completion/PROGRESS.md`. The goal is met when every
> item of its acceptance checklist (section 8) is done, with evidence recorded in PROGRESS.md. A session may also
> stop when every open item waits only on an owner action that the latest Handoff in PROGRESS.md names step by step,
> and no step an agent can do is left. That stop is a pause, not completion: the next session resumes here.

## 1. Where things stand on 18 November

- **Code.** Everything in MASTER_PROMPT Tiers 0 to 2 is built and tested offline. Section 4 of PROGRESS.md lists
  each change with its commit and verification level. The gateway has 1,018 tests, the frontend 839 unit tests and
  204 research browser tests, and a fresh replay of the database migrations passes every assertion.
- **CI.** Every job passes (19 November). The two scans that turned red on 18 November were cleared upstream with
  no change here: GitHub withdrew the `picomatch` advisory (NX-48), and Alpine shipped an OpenSSL update (NX-49).
- **Preview.** The gateway Worker `nexusrag-v6-candidate-gateway` runs the branch (`81bab63` at the time of
  writing). Its smoke test, `/ready` and the live workspace-deletion journey (19 of 19) pass. The frontend Worker
  still runs an October build, because the preview workflow refuses this branch (environment branch rule). The
  public address https://nexusrag-preview.pages.dev forwards to that Worker until a build made for it is released.
- **Rehearsal database** (`ukgjygzfhyvnrsecdcuu`). 54 migrations are applied. Five are pending:
  `20261113210000_account_deletion`, `20261114090000_research_calculation_runs`,
  `20261114120000_storage_reconciliation`, `20261117090000_ranked_keyword_search` and
  `20261117120000_foreign_key_indexes`. The Supabase connector's approval prompt for them went unanswered on 15,
  16, 17 and 18 November.
- **Production.** The Workers are from 23 September. The database (`fcjaomiceajcdownarel`) is 46 migrations behind
  by name. Its gateway still defaults to `gemini-2.5-flash`, which Google shuts down on **1 December 2026**, so
  production has to be released before then. https://nexusrag.pages.dev forwards to the September frontend.
- **Gemini.** Both keys supplied so far answer HTTP 402 (prepaid projects with no credit), so no document can be
  ingested and no answer generated on the shared key.
- **Ledger.** PROGRESS.md "Ledger status" sorts every NX item: closed; fixed but waiting on a named owner step for
  its live check; for the owner to accept or decide; or the cleanup pull request.

## 2. Rules that do not change

- Commit as `Anupam Roy <42176802+Anupam0202@users.noreply.github.com>`, with Conventional Commits. No AI
  attribution or branding in commits, pull requests, code or documents. Never force-push or rewrite history.
  PR #12 stays a draft until the live journey passes, and only the owner merges.
- Never print, log, commit or paste a secret, and check `git diff --cached` before every commit. Ask for
  credentials only through the environment's secret mechanisms (the session's credential request, or the owner's
  GitHub environment secrets), never in chat.
- Never skip, disable or loosen a test or a CI gate. A new advisory without a fix stays red until the fix lands or
  the owner accepts a dated exception. Never spend money.
- Owner checkpoints (MASTER_PROMPT section 9). Ask first before deleting anything that holds data, spending money,
  rotating credentials or adding secrets, changing GitHub rulesets, branch protection, environments, collaborators
  or visibility, and merging. No need to ask for: preview releases (with smoke test and automatic rollback),
  read-only checks, offline code and test work, and resetting the test accounts' trial counters on rehearsal.
- The Supabase connector's `apply_migration` asks the owner to approve. If the request times out, do not send it
  again in that turn: say so, and wait for the owner's reply.
- Claim only the verification level actually reached (MASTER_PROMPT section 7). Record the level and the commit in
  PROGRESS.md's done log.

## 3. Facts that save a session time

- **Preview gateway release** works from a cloud session. Release from a clean checkout of the commit
  (`git worktree add --detach <dir> <sha>`):
  `CLOUDFLARE_API_TOKEN=proxy-injected CLOUDFLARE_ACCOUNT_ID=84e80d9629e0a6e6e5b31dbe85146acf
  SUPABASE_URL=https://ukgjygzfhyvnrsecdcuu.supabase.co SUPABASE_PUBLISHABLE_KEY=<rehearsal publishable key>
  WRANGLER=<repo>/frontend/node_modules/.bin/wrangler python3 scripts/release.py gateway --target candidate --sha <sha>`.
- **Frontend releases.** The frontend cannot be released from a cloud session, because the proxy overwrites its
  asset-upload token. Use the Cloudflare Preview Deploy workflow, and Production Deploy for production.
- **Public addresses.** The session cannot open `*.pages.dev`. Check the public addresses with Cloudflare's URL
  scanner (`/urlscanner/v2/scan`, visibility Unlisted).
- **Waiting.** Read Actions status with the GitHub MCP tools; the unauthenticated GitHub API rate-limits. Foreground
  `sleep` is blocked, so wait with a background timer and check when it fires.
- **Test accounts** on rehearsal: `nexus-e2e-a@nexusrag.test` and `nexus-e2e-b@nexusrag.test`.
  - Their passwords exist only in a session's scratchpad (`smoke.env`). A new session sets new ones as a bcrypt
    hash in `auth.users.encrypted_password`, and keeps them only in its scratchpad.
  - Every journey uses account A's free trial document. Reset the counters before each run:
    `update public.nexus_account_usage set lifetime_documents = 0, free_chat_queries = 0 where user_id in (<A>, <B>)`.
- **Index collection.** The gateway has no default collection (NX-36). `release.py` sets `QDRANT_COLLECTION`, and
  test fixtures name `nexusrag-test`.
- **Wiring a new SQL file.** A new assertion goes into `tests/postgres/local-rehearsal.sh`, and its pass marker into
  `v6-database-rehearsal.yml`. A new migration must also be added to that workflow's `cp` list.
- **Migrations on rehearsal** are recorded under their full file name, for example
  `20261113210000_account_deletion`. Apply them without their outer `begin`/`commit`. Hosted status:
  `python3 scripts/migration_status.py status --applied <list_migrations JSON>`.
- **Uploads.** The gateway accepts plain text, Markdown, CSV, JSON, PDF, DOCX, ZIP and PNG, JPEG, WebP and TIFF
  images, up to 10 MB (`SUPPORTED_WORKER_MIME` in `worker-pipeline.js`).
- **Lockfile changes.** Use CI's Node 24 and npm 11: `PATH=/opt/node24/bin:$PATH`. The container's default npm 10
  crashes in `npm update` on this tree (`Cannot read properties of null (reading 'edgesOut')`). The audit gate fails
  only on high and critical advisories, so also look for moderate ones whose fix is within range.

## 4. Owner actions, in order

1. **Gemini key, due before 1 December.**
   - Use a key from a Google AI Studio project that has credit, or a free-tier project without prepaid billing.
   - Put it in `GOOGLE_API_KEY` in both GitHub environments: `NexusRAG-Candidate-Preview` and `Production`.
2. **Preview environment.**
   - In `NexusRAG-Candidate-Preview`, allow branch `codex/runtime-manifest-008` under deployment branches.
   - Add `SUPABASE_DB_URL` there: the rehearsal project's session-pooler connection string.
   - The preview workflow then applies the five pending migrations itself and releases both Workers.
3. **Supabase Auth URLs** (`docs/DEPLOYMENT_PRODUCTION.md`, "The public address").
   - Production: Site URL `https://nexusrag.pages.dev`, redirect URL `https://nexusrag.pages.dev/**`.
   - Rehearsal: the same with `nexusrag-preview`, and remove the old PR3 redirect URLs (NX-40).
4. **Ledger decisions in chat.** The recommendations are in PROGRESS.md, "Ledger status".
   - Accept, or refuse: NX-22, NX-25, NX-32, NX-33's remainder, NX-35, NX-41 and NX-42's remainder.
   - Decide:
     - NX-15: finish Procurement and Passport, or remove them.
     - NX-31: remove the Python backend.
     - NX-38: turn on Dependabot for Actions.
5. **Production environment.** Confirm that `Production` holds these secrets:
   - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_DB_URL`.
   - `SUPABASE_SERVICE_ROLE_KEY`, preferably an `sb_secret_` key (NX-26).
   - `GEMINI_USER_KEY_ENCRYPTION_SECRET`: the base64 form of 32 random bytes. Set it once and never replace it
     (NX-18).
   - `GOOGLE_API_KEY`, `QDRANT_URL` and `QDRANT_API_KEY`.
6. **Release, after the preview journey passes, CI is green and the agent has made the trusted push (D2).**
   - Review and merge PR #12. Settings → Rules shows what `main` requires; it reportedly includes the provider
     checks and a `Preview` deployment, which the trusted push records.
   - Run Production Deploy with the merge commit as `release_sha`, and approve it.
   - Do the walkthrough in `docs/completion/OWNER_WALKTHROUGH.md` and confirm it in chat.
7. **Credential rotation** (MASTER_PROMPT section F6), when the owner chooses. The agent prepares the list.

## 5. Agent work, in order

### Phase A: any time

1. **Dependencies.** NX-48 is resolved: GitHub withdrew the `picomatch` advisory on 18 November. If `npm audit`
   reports a new advisory with a fix in range, update it with Node 24's npm (section 3), run
   `npm audit --audit-level=high`, lint, type-check and the unit tests, and commit it as `chore(deps)`.
2. **Image scan.** NX-49 is resolved: Alpine shipped OpenSSL `3.5.9-r1` on 18 November and the scan passes. If it
   reports a new finding, record it in the ledger, and re-run the failed jobs once Alpine ships the fix (the
   Dockerfile's `apk upgrade` takes it); only the owner can accept a dated exception.
3. Keep CI green on every push, and fix failures at their cause.
4. Keep PROGRESS.md current (Handoff, Current state, Ledger status, done log), and keep PR #12's description current.

### Phase B: the preview, after owner steps 1 to 3

1. **Release.** Run "Cloudflare Preview Deploy" on the branch with "Deploy this branch to the candidate preview"
   ticked. Check its log: the five migrations applied by name, both Workers released and both smoke tests passed.
2. **Rehearsal checks.**
   - Run `get_advisors` (security and performance).
   - Run the NX-19 client-privilege checks as read-only SQL: the same rules as
     `tests/postgres/client-privilege-assertions.sql`.
   - Run `select public.nexus_storage_reconciliation(3600, 0)`.
3. **Public address.** Use Cloudflare's URL scanner on https://nexusrag-preview.pages.dev and check:
   - The page is served there, with no redirect, and every file answers 200.
   - `/research`, `/radar` and `/evidence-api` answer 200, and an unknown path answers 404.
   - Google sign-in returns to that address. The owner checks this in a browser if the scanner cannot.
4. **Gemini.**
   - Run `python3 scripts/check_gemini_models.py`.
   - Run `LIVE_EXTERNAL_VALIDATION=true PROVIDER_UNDER_TEST=gemini python3 scripts/live_provider_validation.py`.
   - Confirm that `gemini-3.5-flash-lite` accepts the thinking settings the gateway sends.
5. **Full live journey.** Reset the trial counters first.
   - `python3 scripts/preview_smoke.py`: both accounts sign in, a workspace is created and approved, an upload
     becomes Ready, and the answer streams, is grounded and cites its sources, with isolation between accounts.
   - `python3 scripts/preview_smoke.py --journey workspace-deletion`.
   - Account deletion, with a third throwaway account (never A or B). Check that `account_deletions` shows
     `verified`, the sign-in is gone and no table holds its rows.
   - A CALCULATION plan over a document that states two figures.
   - A question answered from a late passage, where the answer's `coverage.lexical_search` is `RANKED`.
   - A 40 to 80 page PDF that becomes Ready with `read: full` (NX-22).
   - Qdrant's `payload_schema`, and new entries that carry no passage text (NX-36).
   - Saving a BYOK key, and each of its error messages (NX-24, NX-14).
6. **Two-user isolation** on the preview (NX-04, NX-05, NX-33): two accounts in two tabs, trying to cross
   workspaces and to use a stale document selection.
7. **F8 timing.** Measure chat time to first token and total time, p50 and p95, over at least 20 answers. Record
   them beside PROGRESS.md's budget table.
8. **Records.** Move the ledger items these checks close, and update PROGRESS.md and PR #12.
9. **Trusted push (D2).** Once steps 1 to 7 pass and CI is green, push the head to `release/production-<date>`.
   This runs the provider checks with the platform keys and records the `Preview` deployment on that commit,
   which `main` reportedly requires. Then mark PR #12 ready for review and tell the owner.

### Phase C: production, after the owner merges and approves

1. **Before the release.**
   - Confirm the names of the `Production` environment's secrets.
   - List production's pending migrations with `migration_status.py`.
   - Check that the workflow snapshots the database first.
2. **The release.** The owner runs Production Deploy with `release_sha` set to the merge commit. Follow it through
   the snapshot, migrations, secrets, release and smoke test, and roll back if it fails.
3. **Public address.** https://nexusrag.pages.dev serves the new build itself, and Google sign-in returns there.
4. **Regression pass** (MASTER_PROMPT section 13):
   - Google sign-in.
   - Saving a BYOK key, and each of its error messages.
   - Uploading each supported file type.
   - Grounded chat with citations, and findings.
   - Document deletion: the production document stuck since 22 September must finish.
   - Workspace switching.
   - Two-user isolation, with test accounts the owner approves.
5. **Production checks.**
   - Advisors, and the NX-19 grants checks.
   - `python3 scripts/reconciliation.py report --target production` (with the Qdrant key) shows no orphans.
   - `/ready` shows READY.
6. **Finish.**
   - The owner confirms the walkthrough in chat, and credential rotation (F6) is done.
   - CI is green on `main`, and the README still matches the app.
   - PROGRESS.md ends with a release summary: what shipped, how it was verified, the known limits and how to roll
     back.

### Phase D: the cleanup pull request, after the release and with the owner's approval

Start a new branch from `main` after the merge (for example `chore/cleanup-after-release`) and open one draft PR
(MASTER_PROMPT section F) covering:
- NX-29: the pgvector column.
- NX-34: independent assertions and the fixture flakiness.
- NX-37: split `preview-worker.js`, and remove stubs and dead code.
- NX-39: stale documents.
- NX-44: unused tables and functions. Forward migrations only, and only drops the owner approves.
- NX-45: a lean CI pipeline, and consistent environment and secret names.
- NX-46: Codex process material.
- Split `frontend/src/lib/api.ts` by domain, which takes about 10.5 KiB of research, Radar and evidence-package code
  out of every page's first load (F8).

## 6. How each session works

1. Read PROGRESS.md (Handoff, Current state, Ledger status, Next steps) and this file. Check CI on the branch and on
   `main`, and the preview's `/ready`.
2. Take the first step in section 5 that is not blocked. If none is left, go to step 4.
3. For each change:
   - Write the failing test first, then make the smallest fix.
   - Run the repository's own checks:
     - gateway: `npm run test:cloudflare`;
     - frontend: lint, type-check, tests and build;
     - script tests;
     - the local database replay whenever SQL changes.
   - Commit, push, and release to the preview when gateway code changed.
   - Record the evidence.
4. If only owner actions are left: bring the Handoff up to date with each owner action as exact steps, post the
   same summary once, and stop. Do not repeat the summary at every stop.

## 7. Records

- **Done log.** One row per change in PROGRESS.md: the date, what changed, the verification level reached and the
  commit.
- **Handoff.** Keep it to about 40 lines, and update Ledger status whenever an item moves.
- **PR #12 description.** Problem, Solution, Test evidence (link the latest CI runs) and Not verified yet. No AI
  attribution.

## 8. Acceptance checklist (when the goal is met)

1. **Ledger.** Every NX item is fixed and verified at its level, or the owner accepted it in chat with a reason.
   Record the owner's words and the date in PROGRESS.md.
2. **CI.** Green on PR #12, and after the merge on `main`, including the npm audit gate and the image scan.
3. **Rehearsal.** No pending migration, no fixable advisor warning, and the grants checks pass.
4. **Preview.** Both Workers run the branch head, the public address serves the app itself, and every phase B check
   passes live (level 4).
5. **Production.** Released through Production Deploy with the owner's approval before 1 December 2026, and:
   - no pending migration;
   - the public address serves the app;
   - the phase C regression pass and two-user isolation pass;
   - the reconciliation finds no orphans, and the advisors and grants checks are clean.
6. **Inventories and credentials.** Credential rotation (F6) is done, and the inventories are reconciled
   (MASTER_PROMPT section F).
7. **Walkthrough.** The owner confirms the walkthrough in chat.
8. **Documents.** The README is honest, the F8 budgets are measured including chat timing, and PROGRESS.md ends with
   the release summary.
