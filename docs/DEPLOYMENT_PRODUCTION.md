# Production release

People open production at **https://nexusrag.pages.dev**. Behind that address it runs on Cloudflare Workers
(`nexusrag-v6-preview-gateway` and `nexusrag-v6-frontend-preview`; the names are historical), Supabase project
`fcjaomiceajcdownarel`, the Qdrant collection `nexusrag-v6-preview` and Gemini. A release is one manual run of the
**Production Deploy** workflow.

## The public address

`https://nexusrag.pages.dev` is the front door: a Cloudflare Pages project, `nexusrag`, whose only code
(`apps/front-door/worker.js`) hands the gateway's API and probes (`/api/*`, `/health`, `/ready`) to the gateway Worker
and everything else to the frontend Worker, each through a service binding. The browser keeps the plain address for
the app and its API, while both keep running and releasing as their Workers. Every other address of the project
(each deployment's own `<id>.nexusrag.pages.dev`, and plain `http://`) is sent to `https://nexusrag.pages.dev` with a
308, so the app has exactly one address. Pages is the only free Cloudflare product with a one-word address; a custom
domain would replace it later without changing the app.

Before a page is served, the front door reads the build's `/_nexus-build.json`. A build made for the public address
(`site_url`) is served there. Any other build, including the one production ran before the front door existed, has
its pages sent on to the Worker's own address, so the switch happens by itself when the first release made for the
public address goes live. From then on the Worker sends pages opened on its own address to the public one, because
sign-in returns only to the address the build names. The gateway accepts both origins (`FRONTEND_ORIGIN`).

The app is built to call its API at the public address (`NEXT_PUBLIC_API_URL`), and the release smoke tests use it
too, so `scripts/release.py` refuses to build or release while the address does not answer `/health` as the target's
gateway. The front door is set up once, and again whenever its code changes:

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... python3 scripts/front_door.py deploy --target production
```

The token needs Pages edit access (the Workers token in the GitHub environment does not need it). The script
creates the project if it is missing, binds the frontend Worker as `APP` and the gateway Worker as `GATEWAY`, refuses
a project whose address Cloudflare gave differently, uploads only the front door's code, and then waits until the
address answers `/health` as the gateway.

In Supabase (project `fcjaomiceajcdownarel` → Authentication → URL Configuration), before the first release made
for the public address:

- **Site URL:** `https://nexusrag.pages.dev`
- **Redirect URLs:** add `https://nexusrag.pages.dev/**`. The Worker's own `workers.dev` entry can be removed once
  a release made for the public address has run.

## Before the first release

Add these to the GitHub `Production` environment (Settings → Environments → Production):

| Kind | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Token that can edit Workers and Queues |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | A secret key (`sb_secret_...`, Settings → API Keys) of the production project; the legacy `service_role` key also works until Supabase retires it at the end of 2026 |
| Secret | `SUPABASE_DB_URL` | Session-pooler connection string of the production database (Supabase → Connect) |
| Secret | `GEMINI_USER_KEY_ENCRYPTION_SECRET` | Base64 of 32 random bytes (`openssl rand -base64 32`). Keep a copy: it decrypts every stored user key. Never just replace it: to rotate, see the next row |
| Secret (optional) | `GEMINI_USER_KEY_ENCRYPTION_SECRET_PREVIOUS` | Only while rotating: the old encryption secret, so keys it sealed still open. The daily cron re-seals them with the new one and logs `byok_reencryption`; remove this once it reports nothing left |
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
4. Builds and deploys the frontend for the public address, then checks, through that address, the home page, the
   build identity, `/research`, `/radar`, `/evidence-api` and that an unknown path returns 404, followed by the
   browser smoke tests. If any of these fail, it restores the previous frontend version and then the previous
   gateway version.

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

## Leftovers and losses in file storage and the index

Uploads and deletions touch file storage, the search index and the database in steps. A crash between two steps,
or a store that lost data, leaves them out of step. Four things can then be true:

| Finding | What it means | What to do |
|---|---|---|
| Stored files that no document names | A deleted document's file, or one whose upload never finished, is still stored | Remove them (below) |
| Index entries of versions that no longer exist | A deleted document's passages are still in the index | Remove them (below) |
| Documents whose original file is gone | They can be read and asked about, but not downloaded or re-indexed | Their uploaders delete them and upload the files again |
| Answerable documents the index holds nothing of | Questions about them find nothing | Open each in Documents and choose Re-index |

The gateway counts these in the first cron run of every day and writes one line to its log
(`store_reconciliation`, a warning when anything is found; Cloudflare dashboard → the gateway Worker → Logs). To
see the counts at any time, run **Actions → Store Reconciliation → Run workflow** with action `report`: it changes
nothing, prints counts only (that log is public; file names are not) and fails when anything is out of step.

To remove leftovers, run the same workflow with action `remove-files` or `remove-index-entries` and, in
`expect`, the count the report showed. A removal makes a fresh report first and stops if its count differs, so it
deletes exactly what you looked at; it also refuses to touch the index while documents are missing from it,
because a database compared with the wrong index looks like that. To see file names and identifiers, run the
report in your own terminal:

```bash
python3 scripts/reconciliation.py report --target production --details
```

with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `QDRANT_URL` and `QDRANT_API_KEY` set to the production values.

## Model retirements

`/health` reports the Gemini models in use. The weekly **Gemini Model Check** workflow fails when Google stops
listing a configured model; the gateway falls back automatically for answers and extraction (see README,
"Model Failover Chain"). Embeddings never fall back: changing the embedding model means a re-index.
