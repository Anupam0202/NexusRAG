# Deployment Status

This file tracks the current deployment-critical roadmap state.

## Implemented

- Vercel frontend and Render backend are configured as separate public services.
- Render backend status exposes Supabase, Qdrant, upload limit, async ingestion, local FAISS, pgvector, cache, and provider health settings.
- Vercel frontend points directly to the Render backend for REST and WebSocket traffic.
- Supabase variables are supported in both frontend and backend, but server secrets must be mirrored into Render.
- Qdrant variables are supported by Render through `ENABLE_QDRANT`, `QDRANT_URL`, `QDRANT_API_KEY`, and `QDRANT_COLLECTION`.
- Pgvector fallback is implemented but optional and should only be enabled after the migration is applied.
- Migration `011_durable_queue_billing_retention.sql` adds atomic leased job claims, durable usage reconciliation, retention scheduling, and full workspace lifecycle support.
- The repository contains standalone leased ingestion and retention workers. A continuously running worker and scheduled retention command still require paid Render worker/cron capacity or an equivalent external scheduler.

## Known Production Blocker

Authenticated public E2E depends on the frontend Supabase project matching the Supabase admin/project available to the test environment. If the deployed frontend targets a different Supabase project than the one exposed to automation, signup/upload/chat cannot be verified end to end without user-side credentials or project alignment.

Verified historical deployment identifiers have been removed from the repository.

Current Cloudflare, Supabase, Qdrant, Gemini, Vercel, and Render mappings must be discovered at deployment time and recorded only in protected environment configuration or sanitized evidence. Do not infer production parity from this document.

## Next Deployment Checks

1. Confirm Vercel production variables point to the intended Supabase project and Render backend URL.
2. Confirm Render has the same Supabase project variables, service role key, JWT secret or JWKS URL, and Qdrant variables.
3. Apply all Supabase migrations through `011_durable_queue_billing_retention.sql` to
   the intended production project; enable pgvector only if fallback is needed.
4. Provision `python scripts/process_jobs.py --poll` as a continuously running
   worker and schedule `python scripts/process_retention.py` daily on production infrastructure.
5. Configure current provider-rate estimates with
   `LLM_INPUT_COST_USD_PER_MILLION` and `LLM_OUTPUT_COST_USD_PER_MILLION`.
6. Deploy backend and frontend from the same Git commit.
7. Run the smoke test from `docs/DEPLOYMENT_FREE.md` and the authenticated
   isolation suite with dedicated accounts.
