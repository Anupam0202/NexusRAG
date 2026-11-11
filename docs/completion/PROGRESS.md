# NexusRAG completion progress
Last updated: 2026-11-11 — Qdrant cluster stopped serving (owner must reactivate); rehearsal database migrated to head; CI green on `6b30a50`

## Current state
- main: `85b14f1`; working branch: `codex/runtime-manifest-008` (draft PR #12, owner-approved for direct
  commits on 2026-11-09); open PRs: #12
- Plan: `docs/completion/MASTER_PROMPT.md`; repository notes: `CLAUDE.md`
- Cloud environment: personal `NexusRAG` (limited network; see the master prompt, section 5)
- Candidate preview: frontend `2fbc5c9`, gateway `46bb14f` (rehearsal database, collection `nexusrag-v6-candidate`).
  `/research`, `/radar`, `/evidence-api` and unknown paths return 500 (NX-01)
- Production: `nexusrag-v6-frontend-preview` v29 → `nexusrag-v6-preview-gateway` v52, both from 23 September
  (a 25 September deploy was rolled back), on production Supabase and the default collection `nexusrag-v6-preview`;
  the live gateway still defaults to `gemini-2.5-flash` with `thinkingBudget: 0` until the NX-06 code is deployed
- Qdrant: cluster `fc0c77d2-d9fd-4648-8459-09fa74372f16` (AWS eu-west-2) **stopped serving between 2026-11-09 and
  2026-11-11**: its address answered 403 without a key on 9 November and now answers 503 (from outside) or resets
  the TLS handshake (from the sandbox); status.qdrant.io shows no incident. Qdrant suspends free clusters after
  1 week unused and deletes them after 4 weeks unless reactivated. Search and chat cannot work anywhere until
  the owner reactivates it in the Qdrant Cloud console. Collections and point counts are still unknown.

## Live check, 2026-11-09 (read-only)
- Gemini (aistudio.google.com/docs deprecations, models and pricing pages): `gemini-2.5-flash` and
  `gemini-2.5-pro` shut down on 2026-12-01 (calls then reroute to `gemini-3.5-flash-lite` and
  `gemini-3.8-flash`); `gemini-2.0-*` shut down on 2026-06-01; `gemini-embedding-001` is supported until
  2028-05-14. Stable: `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`; `gemini-3.8-flash`
  is new. All have a free tier.
- Supabase production (`fcjaomiceajcdownarel`): ACTIVE_HEALTHY; 35 applied migrations (latest
  `20260926195204`); 8 users, none signed in since 2026-09-22; 7 legacy documents with chunks but no version
  rows (NX-03) and 1 document stuck in `deleting` (NX-27); 0 stored BYOK keys; security advisors: only
  leaked-password protection off; health advisors clean; only traffic is the production gateway's cron.
- Supabase rehearsal (`ukgjygzfhyvnrsecdcuu`): ACTIVE_HEALTHY; 42 applied migrations (latest
  `20261025091432`); 2 users; 4 `research_*` tables with RLS but no policies; a signed-in browser session polls
  it every ~70 seconds (probably a tab left open on the candidate app).
  **Update 2026-11-11:** the name-based status tool showed six pending files, not three: 040, 041 and 042 had
  never been applied either. All six were applied (checksums verified in the database against the repository
  files), then `20261111213000_explicit_deny_service_only_tables`; 49 applied, 0 pending; the security advisor
  now reports only leaked-password protection (an Auth setting) and the temporary objects below.
- Cloudflare (API token): six Workers unchanged since October; six queues (production, candidate and PR3, each
  with a DLQ; the PR3 queue has no consumer); both live gateways run a `*/5` cron; R2 not enabled; no KV or D1.
  The script `settings` endpoint shows the rolled-back version's bindings; read active versions instead.
- GitHub: PR #12 draft, merge blocked by branch protection; after the docs commit `763c288`, 9 checks pass,
  3 fail (runtime images, dependency review, required summary) and 2 deploy jobs are skipped — unchanged.

## Tiers
- Tier 0: [~] Gemini model policy (NX-06): implemented and tested offline; live test and production release
  pending (before 2026-12-01) [x] NX-10 frontend Docker type-check [x] NX-09 audit gate and NX-01 Worker crash
  (built Worker verified; deploy pending) [x] CI green on `6b30a50`: all 12 checks pass, including the required
  summary (the two deploy jobs are skipped by design)
  [x] replayable migrations (NX-11): fresh build proven in CI and locally; harness and workflow lists are tested
  against the forward chain; 065 stays out [~] deploy workflows (NX-12, NX-13): migration tool done, workflow
  rewrite next [ ] PR #12 description rewritten and handed over [~] Qdrant (NX-07): state known — not serving;
  collections unknown [x] Recovery salvage (NX-43) [x] Cloudflare inventory with the API token
- Tier 1: not started
- Tier 2: not started
- Tier 3: not started
- Tier 4: not started

## Done log
| Date | Item | PR | Verified at level | Link |
|---|---|---|---|---|
| 2026-11-09 | Recovery salvage; owner deleted `NexusRAG-Recovery` | — | n/a | `MASTER_PROMPT.md`, Part 2 F2 |
| 2026-11-09 | Plan, progress log, `CLAUDE.md` and the 065 patch saved to the branch | #12 | n/a (documents) | `763c288` |
| 2026-11-09 | NexusRAG environment created; Cloudflare token saved; live Cloudflare inventory | #12 | n/a (read-only) | `4410c35` |
| 2026-11-09 | NX-10: production builds type-check app code only (`tsconfig.build.json`) | #12 | 2 (frontend-only `next build`) | `41eb758` |
| 2026-11-09 | NX-09/NX-01: next 16.4.5 + @opennextjs/cloudflare 1.20.16, vite 8.3.6, undici/zod/glob patched; assets `html_handling: none` | #12 | 2 (audit gate 0; lint, tsc, 731 tests, cf:build; local Worker: real routes 200, unknown 404; 14 routing tests) | `5a28cd2` |
| 2026-11-09 | D4: the legacy Python backend image is built and scanned only when `include_backend` is set; the frontend image scan still gates CI | #12 | CI (runtime-images job green) | `51e73ce` |
| 2026-11-09 | NX-06: Gemini model policy D24 — fallback chain with retirement detection, per-model thinking settings, `/health` models, daily cron check, weekly `Gemini Model Check` workflow, live probe on the primary model, deploys set the models explicitly; Python backend and README moved off retired models | #12 | 2 (879 gateway tests incl. 13 new; 161 script tests, only the sandbox-only IPv6 test fails; backend 64 + 664; wrangler dry-run); CI green | `6b30a50` |
| 2026-11-11 | NX-11/NX-12: `scripts/migration_status.py` (name-based status; `apply` snapshots every public table, applies pending files one transaction each, records history) with a real-database test in the rehearsal harness; guard test ties the harness and workflow lists to the forward chain; every public table now has an explicit policy (new migration + invariant) | #12 | 3 (full local replay on PostgreSQL 16 incl. the tool test; schema identical whether applied in file order or hosted order; applied to the hosted rehearsal project) | this commit |

## Blockers and owner decisions
- **Urgent — Qdrant:** reactivate cluster `fc0c77d2-d9fd-4648-8459-09fa74372f16` in the Qdrant Cloud console
  (free clusters are deleted after 4 weeks suspended). If it has already been deleted, say so: the index is
  rebuilt from the chunks stored in Supabase (a re-index), and a new cluster URL and key go into the Worker
  secrets and GitHub environments.
- **Rehearsal cleanup waiting for the owner's confirmation:** the Supabase connector asks before destructive
  SQL and its question timed out on 2026-11-11. Still to drop on rehearsal `ukgjygzfhyvnrsecdcuu`, both created
  by this work and holding only copies of repository migration files: table `public.migration_upload_tmp`
  (insert-only with a token) and schema `nexus_tmp_migrate` (one function, no grants).
- The owner adds two keys under the NexusRAG environment's Network secrets (environment menu → Edit): Qdrant
  (host `fc0c77d2-d9fd-4648-8459-09fa74372f16.eu-west-2-0.aws.cloud.qdrant.io`, header `api-key`) and Gemini
  (host `generativelanguage.googleapis.com`, header `x-goog-api-key`). The secure form cannot save either.
- Decided 2026-11-09: D24 Gemini model policy (`gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` →
  `gemini-flash-latest`, automatic fallback, daily and weekly availability checks; embeddings pinned to
  `gemini-embedding-001`), and D25: the owner delegated product and technical decisions; the exceptions are in
  `MASTER_PROMPT.md`, Part 1, section 9. Other defaults in section I now count as decided.

## Next steps (exact commands)
1. NX-06 live test once the owner adds the Gemini key: `python3 scripts/check_gemini_models.py`, then
   `LIVE_EXTERNAL_VALIDATION=true PROVIDER_UNDER_TEST=gemini python3 scripts/live_provider_validation.py`, then
   check whether `gemini-3.5-flash-lite` accepts the old production request (`thinkingBudget: 0`). If it does not,
   production chat breaks on 2026-12-01 unless the NX-06 gateway is released first (delegated, D25).
2. NX-12/NX-13: fix the deploy workflows. Found 2026-11-09: production `/health` is checked for
   `status == "READY"` but the gateway reports `CONFIGURED`, so that step can never pass; the workflow sets
   `RELEASE_SHA` while the gateway reads `SOURCE_COMMIT`; secrets are installed after the deploy; and the config
   deploys `nexusrag-v6-gateway`, not the `*-preview` Workers that serve production today.
3. Candidate preview (normal development work): rehearsal is at head, so deploy the current gateway and
   frontend with wrangler and the saved Cloudflare token; check `/health` reports the SHA and the models, and
   `/research`, `/radar`, `/evidence-api` return 200 live.
4. Once Qdrant is reactivated and its key is added: `curl -sS -H 'api-key: x' "https://fc0c77d2-d9fd-4648-8459-09fa74372f16.eu-west-2-0.aws.cloud.qdrant.io/collections"`.
5. Migration status of a hosted project: save `list_migrations` output to a file, then
   `python3 scripts/migration_status.py status --applied <file>`. Production on 2026-11-11: legacy base, 36 files
   pending (035 onward). Applying them belongs to the production release, after a snapshot.
6. PR #12 merge is blocked by draft status and the ruleset's provider checks, which need a trusted push (D2)
   and a working Qdrant cluster.
