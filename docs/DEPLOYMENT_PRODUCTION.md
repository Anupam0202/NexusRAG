# Production Deployment

Production should keep the backend stateless and move all durable user data into managed services.

## Recommended Services

- Frontend: Vercel Pro or Cloudflare Pages
- Backend: paid Render, Fly, Cloud Run, or Railway
- Auth and Postgres: Supabase Pro
- Storage: Supabase Storage, S3, or Cloudflare R2
- Vector database: Qdrant paid cluster
- Observability: platform logs plus a trace/log drain
- Billing: Stripe or another billing provider fed by `llm_usage_events`

## Production Backend Variables

```txt
AUTH_REQUIRED=true
ENABLE_ANONYMOUS_DEMO=false
ENABLE_ASYNC_INGESTION=true
ENABLE_QDRANT=true
ENABLE_LOCAL_FAISS=false
ENABLE_PGVECTOR_FALLBACK=false
SUPABASE_URL=<production-supabase-url>
SUPABASE_ANON_KEY=<production-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<production-service-role-key>
SUPABASE_JWT_SECRET=<production-jwt-secret-or-jwks>
SUPABASE_JWKS_URL=<production-jwks-url>
SUPABASE_STORAGE_BUCKET=documents
QDRANT_URL=<production-qdrant-url>
QDRANT_API_KEY=<production-qdrant-key>
QDRANT_COLLECTION=nexusrag_chunks
GOOGLE_API_KEY=<server-default-gemini-key>
LLM_INPUT_COST_USD_PER_MILLION=<current-estimated-input-rate>
LLM_OUTPUT_COST_USD_PER_MILLION=<current-estimated-output-rate>
FRONTEND_URL=<production-frontend-url>
```

## Production Authentication

NexusRAG exposes Google OAuth first and GitHub OAuth second. Supabase Auth remains
the session authority, and FastAPI continues to validate only Supabase-issued
JWTs. The frontend and backend never receive provider passwords or OAuth client
secrets.

### Vercel

Set the canonical frontend and matching public Supabase project:

```txt
NEXT_PUBLIC_SITE_URL=https://nexusrag.vercel.app
NEXT_PUBLIC_SUPABASE_URL=https://fcjaomiceajcdownarel.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<production-anon-or-publishable-key>
NEXT_PUBLIC_OAUTH_PROVIDERS=github
```

Do not place Google or GitHub client secrets in Vercel variables.
Use `NEXT_PUBLIC_OAUTH_PROVIDERS=google,github` only after Google and GitHub
are both enabled in Supabase Auth.

### Supabase URL Configuration

In the same Supabase project referenced by `NEXT_PUBLIC_SUPABASE_URL`, set:

```txt
Site URL: https://nexusrag.vercel.app
Redirect URL: https://nexusrag.vercel.app/auth/callback
Local redirect URL: http://localhost:3000/auth/callback
```

Allowlist only deliberate application origins. Do not use wildcard external
origins and do not leave localhost as the production Site URL.

### Provider Applications

Both provider applications use the Supabase callback:

```txt
https://fcjaomiceajcdownarel.supabase.co/auth/v1/callback
```

Google configuration:

- Create an OAuth web client for NexusRAG.
- Configure the consent screen for the application.
- Use only the standard `openid email profile` scopes requested by Supabase.
- Add the Supabase callback as an authorized redirect URI.
- Store the client ID and client secret only in Supabase
  **Authentication > Providers > Google**.

GitHub configuration:

- Create a GitHub OAuth App.
- Homepage URL: `https://nexusrag.vercel.app`.
- Authorization callback URL: the Supabase callback above.
- Store the client ID and client secret only in Supabase
  **Authentication > Providers > GitHub**.

OAuth-only authentication does not require Resend, custom SMTP, or a paid
domain. Leave email authentication enabled only for a deliberate rollback
window. The production NexusRAG UI must expose Google and GitHub only. Disable
email authentication after both OAuth providers and existing-user access have
passed production verification and the rollback window is closed.

Existing users are preserved. Supabase may automatically link a trusted OAuth
identity when it returns the same verified email as an existing user. Never
merge accounts automatically when emails differ.

### Verification

For each provider, verify:

1. A first-time user reaches onboarding and creates a workspace.
2. A returning user reaches the requested protected route.
3. Reload preserves the Supabase session.
4. Current-session and all-session sign-out work.
5. The resulting Supabase JWT reaches Render successfully.
6. Invalid JWTs and cross-workspace access remain rejected.

Do not report provider consent, CAPTCHA, 2FA, or existing-user linking as passed
unless those scenarios were actually executed.

## Production Controls

- Apply all Supabase migrations before deployment.
- Keep service role keys backend-only.
- Configure CORS to the production frontend domains only.
- Run ingestion through a worker or scheduled job runner instead of depending only on background tasks in web instances.
- Keep local FAISS disabled in production.
- Back up Supabase Postgres and storage.
- Monitor Render memory, Gemini quota failures, Qdrant latency, ingestion job failures, and upload error rates.
- Persist quota enforcement decisions in durable tables before billing users.
- Run `python scripts/process_jobs.py --poll` as a continuously running worker.
- Schedule `python scripts/process_retention.py` daily.
- Treat reconciled cost as an estimate until it is matched against provider invoices.

## Upgrade Path

1. Start with Qdrant Cloud Free and Supabase Free for a demo.
2. Upgrade Supabase first when auth, storage, or database limits are reached.
3. Upgrade Qdrant when vector count, latency, or availability becomes a bottleneck.
4. Upgrade backend compute when ingestion or OCR exceeds Render Free memory and cold-start limits.
5. Add durable worker infrastructure when ingestion volume grows beyond occasional uploads.
