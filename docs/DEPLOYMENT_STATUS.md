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

## Next Deployment Checks

1. Confirm Vercel production variables point to the intended Supabase project and Render backend URL.
2. Confirm Render has the same Supabase project variables, service role key, JWT secret or JWKS URL, and Qdrant variables.
3. Apply Supabase migrations, including pgvector only if fallback is needed.
4. Deploy backend and frontend from the same Git commit.
5. Run the smoke test from `docs/DEPLOYMENT_FREE.md`.
