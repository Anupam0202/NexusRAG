# Candidate preview

The candidate preview is the place to test a branch on real services at no cost: Workers
`nexusrag-v6-candidate-gateway` and `nexusrag-v6-candidate-frontend`, their own queue, the Qdrant collection
`nexusrag-v6-candidate`, and the rehearsal Supabase project `ukgjygzfhyvnrsecdcuu`. It never shares a Worker,
queue, collection or database with production; `scripts/release.py` refuses any other combination.

## Deploying a branch

Run **Actions → Cloudflare Preview Deploy → Run workflow**, choose the branch and tick "Deploy this branch to
the candidate preview". The workflow applies pending migrations to the rehearsal database (when
`SUPABASE_DB_URL` is set), deploys the gateway with its secrets, builds and deploys the frontend, smoke-tests
both (restoring the previous version on failure) and runs the browser tests against the preview.

The GitHub environment `NexusRAG-Candidate-Preview` needs the same names as production (see
`docs/DEPLOYMENT_PRODUCTION.md`), with the rehearsal project's values. `SUPABASE_DB_URL` is optional there.

## Deploying the gateway from a terminal

```bash
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
export SUPABASE_URL=https://ukgjygzfhyvnrsecdcuu.supabase.co SUPABASE_PUBLISHABLE_KEY=...
python3 scripts/release.py gateway --target candidate --sha "$(git rev-parse HEAD)"
```

Existing Worker secrets are kept. The frontend is deployed the same way after
`SOURCE_COMMIT=$(git rev-parse HEAD) node scripts/write-build-info.mjs && npm run cf:build` in `frontend/`:

```bash
python3 scripts/release.py frontend --target candidate --sha "$(git rev-parse HEAD)"
```

Free-tier limits to remember: Qdrant suspends a free cluster after a week without use and deletes it after
four weeks; Supabase pauses a free project after a week of low activity; Cloudflare Queues keep messages for
24 hours.
