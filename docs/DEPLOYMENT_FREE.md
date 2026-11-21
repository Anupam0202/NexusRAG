# Candidate preview

The candidate preview is the place to test a branch on real services at no cost: Workers
`nexusrag-v6-candidate-gateway` and `nexusrag-v6-candidate-frontend`, their own queue, the Qdrant collection
`nexusrag-v6-candidate`, and the rehearsal Supabase project `ukgjygzfhyvnrsecdcuu`. It never shares a Worker,
queue, collection or database with production; `scripts/release.py` refuses any other combination.

Its public address is **https://nexusrag-preview.pages.dev**, a front door like production's (see "The public
address" in `docs/DEPLOYMENT_PRODUCTION.md`; `python3 scripts/front_door.py deploy --target candidate`). In the
rehearsal project's Authentication → URL Configuration, add `https://nexusrag-preview.pages.dev/**` to the
redirect URLs and make it the Site URL.

## Deploying a branch

Run **Actions → Cloudflare Preview Deploy → Run workflow**, choose the branch and tick "Deploy this branch to
the candidate preview". The workflow applies pending migrations to the rehearsal database (when
`SUPABASE_DB_URL` is set), deploys the gateway with its secrets, builds and deploys the frontend, smoke-tests
both (restoring the previous version on failure) and runs the browser tests against the preview.

The GitHub environment `NexusRAG-Candidate-Preview` needs the same names as production (see
`docs/DEPLOYMENT_PRODUCTION.md`), with the rehearsal project's values. `SUPABASE_DB_URL` is optional there; when
set it must be the rehearsal project's session-pooler string (user `postgres.ukgjygzfhyvnrsecdcuu`), and the release
refuses any other project's before it changes anything.

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

The release checks `/health` and `/ready` on the new version and rolls back when either fails; `/ready` shows
whether the gateway reached its database and its search index. Add `--allow-index-down` to release while the
index does not answer.

## Checking users' own Gemini keys

Run **Actions → BYOK Check → Run workflow** with a test account and a question that one of that account's ready
documents answers. `scripts/byok_check.py` signs the account in through Supabase Auth's admin API (its password is
not changed), marks its five free chats as used, and checks the following:

1. A question is refused with `BYOK_REQUIRED`.
2. The environment's own Gemini key, stored as the account's key, answers at the account's cost
   (`provider_cost_owner: USER_GOOGLE_PROJECT`).
3. Questions are refused again once the key is removed.

It always removes the key and restores the usage count, refuses any gateway but the preview's and any account
outside `@nexusrag.test`, and prints statuses only.

Free-tier limits to remember: Qdrant suspends a free cluster after a week without use and deletes it after
four weeks (the gateway's daily cron run asks the index one question, which counts as use); Supabase pauses a
free project after a week of low activity; Cloudflare Queues keep messages for 24 hours.
