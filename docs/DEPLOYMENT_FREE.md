# Free Deployment

This path is for a free-first public demo. It is suitable for validation and portfolio use, not unlimited production traffic.

## Services

- Frontend: Vercel Hobby
- Backend: Render Free web service
- Auth, Postgres, Storage: Supabase Free
- Vector database: Qdrant Cloud Free
- LLM: Gemini server key plus workspace BYOK when users hit quota

## Vercel Frontend

Set these variables in the Vercel project:

```txt
NEXT_PUBLIC_API_URL=https://nexusrag-backend-wv2f.onrender.com
NEXT_PUBLIC_SUPABASE_URL=<supabase-project-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
NEXT_PUBLIC_SITE_URL=https://nexusrag.vercel.app
NEXT_PUBLIC_OAUTH_PROVIDERS=github
```

Vercel Marketplace Supabase variables are frontend-only. Mirror the matching Supabase server variables into Render manually.
Switch `NEXT_PUBLIC_OAUTH_PROVIDERS` to `google,github` only after both
OAuth providers are configured and verified in Supabase.

In that Supabase project, set **Authentication > URL Configuration > Site URL**
to `https://nexusrag.vercel.app` and allow
`https://nexusrag.vercel.app/auth/callback`. Keep localhost callbacks only as
additional development redirects.

Create free Google and GitHub OAuth applications. Configure both applications
with the Supabase callback:

```txt
https://<supabase-project-ref>.supabase.co/auth/v1/callback
```

Use `https://nexusrag.vercel.app` as the GitHub homepage and Google application
origin where requested. Store provider credentials only in Supabase
**Authentication > Providers**. Google uses the standard `openid email profile`
scopes. This OAuth-only path requires no SMTP provider, auth sender, or custom
domain.

## Render Backend

Set these variables in Render:

```txt
GOOGLE_API_KEY=<gemini-server-key>
FRONTEND_URL=https://nexusrag.vercel.app
SUPABASE_URL=<supabase-project-url>
SUPABASE_ANON_KEY=<supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
SUPABASE_JWT_SECRET=<jwt-secret-or-use-jwks-url>
SUPABASE_JWKS_URL=<optional-jwks-url>
SUPABASE_STORAGE_BUCKET=documents
ENABLE_QDRANT=true
QDRANT_URL=<qdrant-url>
QDRANT_API_KEY=<qdrant-api-key>
QDRANT_COLLECTION=nexusrag_chunks
ENABLE_LOCAL_FAISS=false
ENABLE_PGVECTOR_FALLBACK=false
ENABLE_ASYNC_INGESTION=true
AUTH_REQUIRED=true
ENABLE_ANONYMOUS_DEMO=false
LLM_INPUT_COST_USD_PER_MILLION=0
LLM_OUTPUT_COST_USD_PER_MILLION=0
```

Use `ENABLE_PGVECTOR_FALLBACK=true` only when the Supabase `005_pgvector_fallback.sql` and `006_pgvector_retrieval_filters.sql` migrations have been applied and Qdrant is intentionally unavailable.

Apply `007_security_hardening.sql`, `008_provider_health_state.sql`, and
`009_supabase_advisor_hardening.sql`, followed by
`010_move_vector_extension.sql`, to the same Supabase project used by both
Vercel and Render, then apply `011_durable_queue_billing_retention.sql`, before
treating a public deployment as production-ready.

Render Free does not provide an always-on background worker. The durable queue
and retention leases prevent duplicate work, but production automation still
requires a paid worker/cron service or equivalent external scheduler running:

```txt
python scripts/process_jobs.py --poll
python scripts/process_retention.py
```

## Free-Tier Limits To Show Users

- Upload cap: backend `MAX_UPLOAD_SIZE_MB`, currently surfaced by `/api/v1/status`.
- Large/scanned PDFs may take longer on Render Free and should use async ingestion.
- Render Free can cold-start after inactivity.
- Gemini free-tier quotas can be exhausted; users should use workspace BYOK for continued generation.

## Smoke Test

1. Open the frontend public URL.
2. Confirm the backend badge becomes live.
3. Sign in with Google, then repeat the smoke test with GitHub.
4. Upload a small PDF or TXT file.
5. Wait for ingestion to reach ready.
6. Ask a question that should cite the uploaded document.
7. Confirm analytics, audit events, and usage pages load.
