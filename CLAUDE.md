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
- Gemini model policy (D24): generation `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-flash-latest` with fallback on model-unavailable errors; embeddings pinned to `gemini-embedding-001` (768) per index generation. `gemini-2.5-flash` shuts down on 2026-12-01.
- The model chain lives only in `apps/gateway/src/gemini-models.js`; `scripts/gemini_model_policy.py` and the deploy workflows read it from there. Keep the Python backend's defaults in step by hand.
- Embeddings are `gemini-embedding-001` at 768 dimensions; changing model or dimension needs a new Qdrant collection and a re-index. The Python backend's embeddings are a different space and must never share a collection.
- `GEMINI_USER_KEY_ENCRYPTION_SECRET` must never change without a re-encryption plan.
- Qdrant Free clusters suspend when idle; Supabase Free projects pause after a week of low activity. The gateway's first cron run of each day probes the index (`search-index.js`), which keeps it awake.
- `/health` is static and calls nothing; `/ready` probes the database and the search index and is what releases check. A suspended cluster and a restarting one look the same, so the state is `NOT_ANSWERING`.
- Processing needs three records, all created without SQL: the operator's provider review (365 days), the workspace owner's approval of Gemini processing (until the terms change), and budget rows (created from `provider_budget_defaults`, reset daily). The gateway reports which one is missing (`PROVIDER_REVIEW_REQUIRED`, `WORKSPACE_APPROVAL_REQUIRED`).
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
