# Deployment Status

This file tracks the current deployment-critical roadmap state.

## Implemented

- Vercel frontend and Render backend are configured as separate public services.
- Render backend status exposes Supabase, Qdrant, upload limit, async ingestion, local FAISS, pgvector, cache, and provider health settings.
- Vercel frontend points directly to the Render backend for REST and WebSocket traffic.
- Supabase variables are supported in both frontend and backend, but server secrets must be mirrored into Render.
- Qdrant variables are supported by Render through `ENABLE_QDRANT`, `QDRANT_URL`, `QDRANT_API_KEY`, and `QDRANT_COLLECTION`.
- Pgvector fallback is implemented but optional and should only be enabled after the migration is applied.

## Known Production Blocker

Authenticated public E2E depends on the frontend Supabase project matching the Supabase admin/project available to the test environment. If the deployed frontend targets a different Supabase project than the one exposed to automation, signup/upload/chat cannot be verified end to end without user-side credentials or project alignment.

Verified on June 6, 2026:

- Vercel production JavaScript targets Supabase project `fcjaomiceajcdownarel`.
- The connected Supabase administration plugin exposes project `hvmmfwteawrzxzusnndf`.
- Migrations `001` through `009` exist on the connected project. Migration
  `010_move_vector_extension.sql` is pending, and no migration should be treated
  as production-applied until the connected project is confirmed as the intended
  production database.

## Next Deployment Checks

1. Confirm Vercel production variables point to the intended Supabase project and Render backend URL.
2. Confirm Render has the same Supabase project variables, service role key, JWT secret or JWKS URL, and Qdrant variables.
3. Apply all Supabase migrations through `010_move_vector_extension.sql` to
   the intended production project; enable pgvector only if fallback is needed.
4. Deploy backend and frontend from the same Git commit.
5. Run the smoke test from `docs/DEPLOYMENT_FREE.md`.
