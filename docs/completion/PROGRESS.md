# NexusRAG completion progress
Last updated: 2026-11-09 — NX-10 and NX-09/NX-01 fixed on PR #12 (verified at level 2); Gemini and Qdrant keys pending

## Current state
- main: `85b14f1`; working branch: `codex/runtime-manifest-008` (draft PR #12, owner-approved for direct
  commits on 2026-11-09); open PRs: #12
- Plan: `docs/completion/MASTER_PROMPT.md`; repository notes: `CLAUDE.md`
- Cloud environment: personal `NexusRAG` (limited network; see the master prompt, section 5)
- Candidate preview: frontend `2fbc5c9`, gateway `46bb14f` (rehearsal database, collection `nexusrag-v6-candidate`).
  `/research`, `/radar`, `/evidence-api` and unknown paths return 500 (NX-01)
- Production: `nexusrag-v6-frontend-preview` v29 → `nexusrag-v6-preview-gateway` v52, both from 23 September
  (a 25 September deploy was rolled back), on production Supabase and the default collection `nexusrag-v6-preview`;
  the gateway reads `GEMINI_MODEL` and defaults to `gemini-2.5-flash`
- Qdrant: cluster `fc0c77d2-d9fd-4648-8459-09fa74372f16` (AWS eu-west-2) exists; running state and collections
  unknown until the owner adds the API key

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
- Cloudflare (API token): six Workers unchanged since October; six queues (production, candidate and PR3, each
  with a DLQ; the PR3 queue has no consumer); both live gateways run a `*/5` cron; R2 not enabled; no KV or D1.
  The script `settings` endpoint shows the rolled-back version's bindings; read active versions instead.
- GitHub: PR #12 draft, merge blocked by branch protection; after the docs commit `763c288`, 9 checks pass,
  3 fail (runtime images, dependency review, required summary) and 2 deploy jobs are skipped — unchanged.

## Tiers
- Tier 0: [ ] Gemini defaults and live test (NX-06, before 2026-12-01) [x] NX-10 frontend Docker type-check
  [x] NX-09 audit gate and NX-01 Worker crash (built Worker verified; deploy pending) [ ] CI green (runtime image
  scans and summary still to confirm)
  [ ] replayable migrations (NX-11) [ ] deploy workflows (NX-12, NX-13) [ ] PR #12 description rewritten and
  handed over [ ] Qdrant running state and collections (NX-07) [x] Recovery salvage (NX-43)
  [x] Cloudflare inventory with the API token
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

## Blockers and owner decisions
- The owner adds two keys under the NexusRAG environment's Network secrets (environment menu → Edit): Qdrant
  (host `fc0c77d2-d9fd-4648-8459-09fa74372f16.eu-west-2-0.aws.cloud.qdrant.io`, header `api-key`) and Gemini
  (host `generativelanguage.googleapis.com`, header `x-goog-api-key`). The secure form cannot save either.
- Owner decisions D1–D22 are open with recommended defaults (`MASTER_PROMPT.md`, Part 2, section I); D19 and
  D23 are decided. D18 (production `GEMINI_MODEL` stopgap) is feasible: the live gateway reads the variable.

## Next steps (exact commands)
1. Check PR #12 CI on `5a28cd2`: dependency review should pass; the runtime-image job now builds the frontend
   image, so its vulnerability scan (and the Python backend image, decision D4) is the likely next blocker.
2. NX-06: confirm Gemini 3 thinking configuration (`thinkingBudget` vs `thinkingLevel`) in Google's docs, centralize
   defaults on `gemini-3.6-flash`, and test live once the owner adds the Gemini key.
3. Candidate preview (normal development work): apply the three missing migrations to rehearsal, then deploy the
   current gateway and frontend with wrangler and the saved Cloudflare token; check `/health` reports the SHA and
   `/research`, `/radar`, `/evidence-api` return 200 live.
4. Once the Qdrant key is added: `curl -sS -H 'api-key: x' "https://fc0c77d2-d9fd-4648-8459-09fa74372f16.eu-west-2-0.aws.cloud.qdrant.io/collections"`.
