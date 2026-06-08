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

Set the canonical frontend URL in Vercel:

```txt
NEXT_PUBLIC_SITE_URL=https://nexusrag.vercel.app
```

In the same Supabase project referenced by `NEXT_PUBLIC_SUPABASE_URL`, open
**Authentication > URL Configuration** and set:

```txt
Site URL: https://nexusrag.vercel.app
Redirect URL: https://nexusrag.vercel.app/auth/callback
Redirect URL: https://nexusrag.vercel.app/auth/confirm
```

Add local callback URLs only as additional development redirects, never as the
production Site URL. Supabase falls back to the Site URL when an
`emailRedirectTo` destination is absent from the allowlist, so a localhost Site
URL causes production confirmation emails to send users back to localhost.

Because `@supabase/ssr` uses PKCE, do not use `{{ .ConfirmationURL }}` for the
hosted **Confirm sign up** or **Magic link or OTP** templates. That URL returns
an authorization code which depends on a verifier stored in the browser that
requested the email. Instead, copy the committed templates from
`supabase/templates/confirm-sign-up.html` and
`supabase/templates/magic-link.html` into the matching Supabase dashboard
templates. They send `{{ .TokenHash }}` to `/auth/confirm`, where an explicit
POST verifies the one-time token, stores the session in cookies, and safely
redirects through `/auth/callback`. This works across browsers/devices and
prevents email link scanners from consuming the token with a GET request.

Install the committed `supabase/templates/recovery.html` template for password
recovery as well. It sends a `recovery` token hash to `/auth/confirm` and then
routes the verified recovery session to `/auth/update-password`.

In **Authentication > Providers > Email** and the Auth settings:

- enable email/password signups and password sign-in;
- require email confirmation before first sign-in;
- keep magic links enabled as an optional secondary sign-in method;
- configure a minimum password policy compatible with NexusRAG's 12-character
  client policy and enable leaked-password protection when available;
- keep signup, sign-in, verification-email, magic-link, and recovery rate limits
  enabled;
- configure production SMTP for reliable branded delivery.

Supabase Auth stores and verifies password hashes. Do not add passwords or
password hashes to NexusRAG tables, Vercel variables, Render variables, logs, or
FastAPI routes.

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
