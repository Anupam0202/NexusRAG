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
FRONTEND_URL=<production-frontend-url>
```

## Production Controls

- Apply all Supabase migrations before deployment.
- Keep service role keys backend-only.
- Configure CORS to the production frontend domains only.
- Run ingestion through a worker or scheduled job runner instead of depending only on background tasks in web instances.
- Keep local FAISS disabled in production.
- Back up Supabase Postgres and storage.
- Monitor Render memory, Gemini quota failures, Qdrant latency, ingestion job failures, and upload error rates.
- Persist quota enforcement decisions in durable tables before billing users.

## Upgrade Path

1. Start with Qdrant Cloud Free and Supabase Free for a demo.
2. Upgrade Supabase first when auth, storage, or database limits are reached.
3. Upgrade Qdrant when vector count, latency, or availability becomes a bottleneck.
4. Upgrade backend compute when ingestion or OCR exceeds Render Free memory and cold-start limits.
5. Add durable worker infrastructure when ingestion volume grows beyond occasional uploads.
