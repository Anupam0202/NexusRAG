# Production release

Production runs on Cloudflare Workers (`nexusrag-v6-preview-gateway` and `nexusrag-v6-frontend-preview`; the
names are historical), Supabase project `fcjaomiceajcdownarel`, the Qdrant collection `nexusrag-v6-preview` and
Gemini. A release is one manual run of the **Production Deploy** workflow.

## Before the first release

Add these to the GitHub `Production` environment (Settings → Environments → Production):

| Kind | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Token that can edit Workers and Queues |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | A secret key (`sb_secret_...`, Settings → API Keys) of the production project; the legacy `service_role` key also works until Supabase retires it at the end of 2026 |
| Secret | `SUPABASE_DB_URL` | Session-pooler connection string of the production database (Supabase → Connect) |
| Secret | `GEMINI_USER_KEY_ENCRYPTION_SECRET` | Base64 of 32 random bytes (`openssl rand -base64 32`). Keep a copy: it decrypts every stored user key, and changing it makes them unreadable |
| Secret | `GOOGLE_API_KEY` | Platform Gemini key (trial chats and the daily model check) |
| Secret | `QDRANT_URL`, `QDRANT_API_KEY` | Qdrant cluster URL and key |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| Variable | `NEXT_PUBLIC_SUPABASE_URL` | `https://fcjaomiceajcdownarel.supabase.co` |
| Variable | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key of the production project |
| Variable | `NEXT_PUBLIC_OAUTH_PROVIDERS` | For example `google,github` |
| Variable (optional) | `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL` | Override the default model policy |
| Variable (optional) | `NEXT_PUBLIC_FEATURES` | Products in development to show, for example `radar,evidence-api`; empty hides them |

## Releasing

1. Merge the change into `main` and wait for CI to pass.
2. Run **Actions → Production Deploy → Run workflow** with the full SHA of the current `main` commit.

The workflow then:

1. Checks that the SHA is the current `main` commit and that every setting above is present.
2. Copies every `public` table into a new schema `backup_<timestamp>_<sha>` and applies pending migrations, one
   transaction per file (`scripts/migration_status.py`). A failing migration rolls back and stops the release
   before any Worker changes.
3. Deploys the gateway together with its secrets, then checks `/health` (commit, models, providers), that an
   unauthenticated API call is refused, and `/ready`: the new version must reach its database and its search
   index with its own credentials. If a check fails, it restores the previous gateway version.
4. Builds and deploys the frontend, then checks the home page, the build identity, `/research`, `/radar`,
   `/evidence-api` and that an unknown path returns 404, followed by the browser smoke tests. If any of these
   fail, it restores the previous frontend version and then the previous gateway version.

## After the first release: allow processing

No document can be processed until two things are on record. Neither needs SQL.

1. **The operator's provider review.** Read the current terms of the Gemini API, Qdrant Cloud and Supabase,
   then run **Actions → Provider Review → Run workflow** with target `production`, action `record`, your own
   signed-in account's email, and the confirmation box ticked. The review is valid for 365 days; the same
   workflow with action `status` shows when it lapses. If a provider's terms have changed since the last
   review, workspace owners are asked to approve again.
2. **Each workspace owner's approval.** The documents page shows a notice with a link to
   Settings → Privacy until the owner approves Google Gemini processing for non-sensitive documents. The
   approval stays in place until the reviewed terms change or the owner revokes it.

Daily usage limits come from the `provider_budget_defaults` table (per workspace and for the whole
deployment); budget rows are created and reset automatically. Change a limit with an `UPDATE` on that table
and on the matching `resource_budgets` rows.

The shared `GOOGLE_API_KEY` only serves the free trial (five chats and one document per account) and the
daily model check; everyone else uses their own key. Use a key from a Google project without prepaid billing,
or keep its balance topped up: a prepaid project with no credit answers every request with HTTP 402, which
the app reports as "no prepaid credit left".

## Rolling back by hand

```bash
python3 scripts/release.py rollback --target production --component frontend --version <version-id>
```

```bash
python3 scripts/release.py rollback --target production --component gateway --version <version-id>
```

Version IDs are in each run's summary ("Previous version") and in the Cloudflare dashboard under the Worker's
Deployments. Migrations are forward-only. If an older gateway cannot work with the newer schema, restore the
affected tables from the `backup_…` schema created by that release; drop old backup schemas once a release has
been confirmed good.

## The search index

`/ready` on the gateway reports what it reached: the database, and the search index with its collection and
point count. The gateway asks the index one question in the first cron run of every day, which is also what
keeps a free Qdrant cluster from being suspended after a week without use.

If the index stops answering, uploads and questions fail with "The search index is not answering" and `/ready`
answers HTTP 503 with `NOT_ANSWERING`. Reactivate the cluster in the Qdrant Cloud console; nothing is lost while
it sleeps, but Qdrant deletes a suspended free cluster after four weeks. A release during that time is rolled
back unless it is run from a terminal with `--allow-index-down`. `KEY_REJECTED` means `QDRANT_API_KEY` is wrong.

## Model retirements

`/health` reports the Gemini models in use. The weekly **Gemini Model Check** workflow fails when Google stops
listing a configured model; the gateway falls back automatically for answers and extraction (see README,
"Model Failover Chain"). Embeddings never fall back: changing the embedding model means a re-index.
