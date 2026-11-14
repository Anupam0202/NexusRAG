# NexusRAG — notes for Claude

## Commands
- Gateway tests (repo root): `npm run test:cloudflare`; bundle check: `npx wrangler deploy --dry-run --config apps/gateway/wrangler.preview.jsonc`
- Script tests: `python3 -m unittest discover -s tests/scripts -p 'test_*.py'` (needs PyYAML; `test_offline_network` fails only in sandboxes without IPv6)
- Backend (legacy, not deployed): `pip install -r backend/requirements-test.txt && python3 backend/scripts/run_full_tests.py`
- Gemini models still served: `GOOGLE_API_KEY=... python3 scripts/check_gemini_models.py`
- Frontend: `cd frontend && npm ci --ignore-scripts && npm run lint && npx tsc --noEmit && npm test && npm run build && npm run cf:build`
- Database replay: install PostgreSQL 17 + pgvector as in `.github/workflows/v6-database-rehearsal.yml`, then `bash tests/postgres/local-rehearsal.sh`
- Release a Worker (deploy, smoke test, automatic rollback): `python3 scripts/release.py gateway|frontend --target candidate|production --sha <commit>`; `plan` prints a target. Runbooks: `docs/DEPLOYMENT_FREE.md`, `docs/DEPLOYMENT_PRODUCTION.md`
- Provider reviews (needed before any document can be processed): `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/provider_review.py status|record`, or the Provider Review workflow
- Live two-account journey test on the preview: `python3 scripts/preview_smoke.py` (environment variables in its docstring)
- Hosted migration status: `python3 scripts/migration_status.py status --applied <list_migrations JSON>`; with a database URL, `apply --snapshot-label <label>` snapshots, applies and records pending files

## Facts the code does not make obvious
- The real gateway is `apps/gateway/src/preview-worker.js`, also used in production; `apps/gateway/src/index.ts` is an unused stub.
- Fresh databases come from `supabase/baseline/001_v6_zero_cost_baseline.sql` plus migrations 026 onward; numbered 001–025 do not replay. Hosted projects record different version numbers, so match migrations by name.
- A new migration file must also be added to `tests/postgres/local-rehearsal.sh` and the `cp` list in `v6-database-rehearsal.yml`; `tests/scripts/test_migration_status.py` fails otherwise. Every public table needs row security and at least one policy (`security-assertions.sql`).
- `next` is pinned because the OpenNext adapter must support Next's manifest format; after changing either, build the Worker and check that an unknown path returns 404.
- `NEXT_PUBLIC_*` values are baked in at build time; a build without them deploys a broken app.
- Every page gets its Content-Security-Policy from the frontend Worker (`security-headers.ts`, NX-28): `script-src 'self'` plus the page's own inline scripts by hash, computed per response (OpenNext re-renders pages, and their inline scripts differ from the build's HTML), and `connect-src 'self'` plus the gateway and Supabase origins the build used (`.open-next/page-policy.json`, written by `scripts/write-page-policy.mjs`). Only the document shell is published as a static page; the build fails if another HTML file would be served without the Worker. HEAD and 304 responses carry no policy, because browsers copy a 304's headers onto the stored page. A third-party script or a new API origin needs a policy change, and `release.py` refuses a frontend whose home page lacks either directive.
- Products still in development (Radar, Evidence API, Evaluations) are hidden from navigation unless `NEXT_PUBLIC_FEATURES` names them (`frontend/src/lib/features.ts`, decision D10); the deploy workflows pass it from a repository variable.
- Visual baselines (`frontend/src/e2e/baselines/*.b64`) must come from the Chromium build CI installs. The frontend pins Playwright 1.63.0, which matches the Chromium preinstalled in Claude cloud containers; with another version, baselines made there fail in CI. Regenerate with `npx playwright test visual-regression.spec.ts --update-snapshots=all` against `npm run start` of a CI-style build, then `base64 -w 0` each PNG into `baselines/`.
- Gemini model policy (D24): generation `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-flash-latest` with fallback on model-unavailable errors; embeddings pinned to `gemini-embedding-001` (768) per index generation. `gemini-2.5-flash` shuts down on 2026-12-01.
- The model chain lives only in `apps/gateway/src/gemini-models.js`; `scripts/gemini_model_policy.py` and the deploy workflows read it from there. Keep the Python backend's defaults in step by hand.
- Embeddings are `gemini-embedding-001` at 768 dimensions; changing model or dimension needs a new Qdrant collection and a re-index. The Python backend's embeddings are a different space and must never share a collection.
- `GEMINI_USER_KEY_ENCRYPTION_SECRET` seals users' Gemini keys, each bound to its user and to the secret's id (`v2:<id>:...`; unprefixed keys are the older format). To rotate it, put the new secret there and the old one in `GEMINI_USER_KEY_ENCRYPTION_SECRET_PREVIOUS`; the daily cron re-seals keys (`reencryptUserGeminiKeys`, logged as `byok_reencryption`), then the old one can go. Never just replace it.
- `SUPABASE_SERVICE_ROLE_KEY` may hold a secret key (`sb_secret_...`) or the legacy `service_role` JWT, which Supabase stops accepting at the end of 2026. A secret key is refused as a Bearer token, so build service headers only with `serviceHeaders` (`supabase-keys.js`); the deploy workflows and `provider_review.py` follow the same rule.
- Qdrant Free clusters suspend when idle; Supabase Free projects pause after a week of low activity. The gateway's first cron run of each day probes the index (`search-index.js`), which keeps it awake.
- `/health` is static and calls nothing; `/ready` probes the database and the search index and is what releases check. A suspended cluster and a restarting one look the same, so the state is `NOT_ANSWERING`.
- Processing needs three records, all created without SQL: the operator's provider review (365 days), the workspace owner's approval of Gemini processing (until the terms change), and budget rows (created from `provider_budget_defaults`, reset daily). The gateway reports which one is missing (`PROVIDER_REVIEW_REQUIRED`, `WORKSPACE_APPROVAL_REQUIRED`).
- Deleting a document: the tombstone hides it at once; `document-deletion.js` stops writers, removes index entries and the original, then `nexus_purge_document` removes every row and writes its receipts in that transaction. The cron retries what could not finish. Test fakes must create the same five cleanup targets as the real `tombstone_document`.
- Retention (`retention.js`, `nexus_retention_sweep`): runs under the lease from `claim_workspace_retention` or `claim_retention_schedules`; the cron takes one due workspace per run. Documents go through `tombstone_document` and the deletion cron; an unused chat is deleted outright (the next question recreates it, so an open chat never breaks), a workbench conversation is closed; saved findings, what they cite and Radar pages are kept.
- CALCULATION runs (`research-calculation-runs.js`, `20261114090000_research_calculation_runs.sql`): Gemini only quotes figures and names operations; `calculateBinary` mirrors `nexus_calculate_binary` exactly (a parity check runs in `research-calculation-run-integration.mjs`), and the step function refuses any result the database does not compute itself. Change both together.
- Deleting a workspace (`workspace-deletion.js`): `nexus_begin_workspace_deletion` hides it at once (membership requires an active workspace); index entries go by a `workspace_id` filter and originals by known keys plus a walk of the workspace's Storage folder; `nexus_purge_workspace` (security definer, because `workspace_invitations` is closed to the service role) deletes from every table with a `workspace_id`, found in the catalog, so a new table is covered without code changes. Deletion records and receipts are kept.
- Deleting an account (`account-deletion.js`, `nexus_begin_account_deletion`): owned workspaces first, then Supabase Auth's admin API removes the sign-in. The membership and document identity triggers only allow the service role when `request.jwt.claim.role` is set, which Supabase Auth's own session does not do; the function sets it locally and removes memberships itself, so the cascade from the sign-in never meets the trigger.
- Database functions run as the service role on hosted Supabase, which cannot read `auth` tables; functions that need them must be `security definer` (`hosted-privilege-assertions.sql` enforces this). Assertions that run as the database owner cannot see such failures.
- A Gemini key on a prepaid project with no credit answers HTTP 402 (since March 2026); the app reports `PROVIDER_CREDIT_EXHAUSTED`.
- In vitest, `beforeEach(() => mock.mockReset())` returns the mock, which vitest then calls as a cleanup hook; use a block body.
- The Workers named `*-preview` serve production; the `*-candidate-*` Workers are the preview. `scripts/release.py` holds both targets and refuses to mix their resources.
- From a Claude cloud session the gateway can be released with the saved Cloudflare token (`CLOUDFLARE_API_TOKEN=proxy-injected`), but the frontend cannot: its asset upload sends a short-lived upload token in the header the proxy overwrites. Deploy the frontend with the Cloudflare Preview Deploy workflow.
- Tests must not depend on the wall clock: pass `now` explicitly (a fixed date in a test broke the suite a day later).
- `NexusRAG-Recovery` was deleted on 2026-11-09; never reference it.
- The plan is `docs/completion/MASTER_PROMPT.md`; progress is in `docs/completion/PROGRESS.md`.

## Conventions
- Commit as `Anupam Roy <42176802+Anupam0202@users.noreply.github.com>`; no AI attribution or branding anywhere.
- Work on `codex/runtime-manifest-008` (PR #12) until the owner merges it.
- Conventional Commits; draft PRs with Problem / Solution / Test evidence; the owner merges.
- Check `git diff --cached` for secrets before every commit.
- Progress lives in `docs/completion/PROGRESS.md`.
