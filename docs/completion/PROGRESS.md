# NexusRAG completion progress
Last updated: 2026-11-09 — plan saved and live platforms checked; no application code changed yet

## Current state
- main: `85b14f1`; working branch: `codex/runtime-manifest-008` (draft PR #12, owner-approved for direct
  commits on 2026-11-09); open PRs: #12
- Plan: `docs/completion/MASTER_PROMPT.md`; repository notes: `CLAUDE.md`
- Candidate preview: frontend `2fbc5c9`, gateway `46bb14f` (rehearsal database). `/research`, `/radar`,
  `/evidence-api` and unknown paths return 500 (NX-01)
- Production: shared Preview Workers (`nexusrag-v6-frontend-preview` → `nexusrag-v6-preview-gateway`), a
  25 September build on the production Supabase project; `/health` says READY without probing
- Qdrant: cluster `fc0c77d2-d9fd-4648-8459-09fa74372f16` (AWS eu-west-2) exists; running state and
  collections unknown until the API key is provided

## Live check, 2026-11-09 (read-only)
- Gemini (aistudio.google.com/docs deprecations, models and pricing pages): `gemini-2.5-flash` and
  `gemini-2.5-pro` shut down on 2026-12-01 (calls then reroute to `gemini-3.5-flash-lite` and
  `gemini-3.8-flash`); `gemini-2.0-*` shut down on 2026-06-01; `gemini-embedding-001` is supported until
  2028-05-14. Stable: `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`; `gemini-3.8-flash`
  is new. All have a free tier.
- Supabase production (`fcjaomiceajcdownarel`): ACTIVE_HEALTHY; 35 applied migrations (latest
  `20260926195204`); 8 users, none signed in since 2026-09-22; 7 legacy documents with chunks but no version
  rows (NX-03) and 1 document stuck in `deleting` (NX-27); 7 Storage objects (374 KB); security advisors: only
  leaked-password protection off; health advisors clean; no edge functions; only traffic is the gateway's
  five-minute cron (about 288 requests a day).
- Supabase rehearsal (`ukgjygzfhyvnrsecdcuu`): ACTIVE_HEALTHY; 42 applied migrations (latest
  `20261025091432`); 2 users; 4 `research_*` tables with RLS but no policies; leaked-password protection off.
- Cloudflare: six Workers unchanged since October (candidate pair, shared Preview pair, PR3 pair); R2 not
  enabled; no KV or D1; `nexusrag-v6-gateway` does not exist (1042).
- GitHub: PR #12 draft, merge blocked by branch protection; 9 checks pass, 3 fail (runtime images, dependency
  review, required summary), 2 deploy jobs skipped.

## Tiers
- Tier 0: [ ] Gemini defaults and live test (NX-06, before 2026-12-01) [ ] CI green (NX-09, NX-10, summary)
  [ ] replayable migrations (NX-11) [ ] deploy workflows (NX-12, NX-13) [ ] PR #12 description rewritten and
  handed over [ ] Qdrant running state and collections (NX-07) [x] Recovery salvage (NX-43)
- Tier 1: not started
- Tier 2: not started
- Tier 3: not started
- Tier 4: not started

## Done log
| Date | Item | PR | Verified at level | Link |
|---|---|---|---|---|
| 2026-11-09 | Recovery salvage; owner deleted `NexusRAG-Recovery` | — | n/a | `MASTER_PROMPT.md`, Part 2 F2 |
| 2026-11-09 | Plan, progress log, `CLAUDE.md` and the 065 patch saved to the branch | #12 | n/a (documents) | this commit |

## Blockers and owner decisions
- Credentials needed through `request_credential`: Qdrant API key (host
  `fc0c77d2-d9fd-4648-8459-09fa74372f16.eu-west-2-0.aws.cloud.qdrant.io`, header `api-key`), a Cloudflare API
  token, and a test Gemini key.
- Owner decisions D1–D22 are open with recommended defaults (`MASTER_PROMPT.md`, Part 2, section I); D19 and
  D23 are decided.

## Next steps (exact commands)
1. Request the three credentials; then `curl -sS -H 'api-key: dummy' "https://fc0c77d2-d9fd-4648-8459-09fa74372f16.eu-west-2-0.aws.cloud.qdrant.io/collections"`.
2. Fix NX-10: exclude test files from the frontend production type-check; reproduce with a `frontend/`-only build.
3. Fix NX-09: upgrade `next` and the flagged packages; build the OpenNext Worker and check that an unknown path
   returns 404 and `/research` returns 200.
4. NX-06: centralize Gemini defaults on `gemini-3.6-flash`; test generation, embedding and PDF extraction live.
