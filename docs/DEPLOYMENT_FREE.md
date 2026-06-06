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
```

Vercel Marketplace Supabase variables are frontend-only. Mirror the matching Supabase server variables into Render manually.

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
```

Use `ENABLE_PGVECTOR_FALLBACK=true` only when the Supabase `005_pgvector_fallback.sql` and `006_pgvector_retrieval_filters.sql` migrations have been applied and Qdrant is intentionally unavailable.

Apply `007_security_hardening.sql`, `008_provider_health_state.sql`, and
`009_supabase_advisor_hardening.sql`, followed by
`010_move_vector_extension.sql`, to the same Supabase project used by both
Vercel and Render before treating a public deployment as production-ready.

## Free-Tier Limits To Show Users

- Upload cap: backend `MAX_UPLOAD_SIZE_MB`, currently surfaced by `/api/v1/status`.
- Large/scanned PDFs may take longer on Render Free and should use async ingestion.
- Render Free can cold-start after inactivity.
- Gemini free-tier quotas can be exhausted; users should use workspace BYOK for continued generation.

## Smoke Test

1. Open the frontend public URL.
2. Confirm the backend badge becomes live.
3. Sign up or sign in.
4. Upload a small PDF or TXT file.
5. Wait for ingestion to reach ready.
6. Ask a question that should cite the uploaded document.
7. Confirm analytics, audit events, and usage pages load.
