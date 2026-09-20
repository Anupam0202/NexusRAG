# NexusRAG Evidence Intelligence OS architecture

## Active preview platform

- **Cloudflare Workers + Static Assets:** OpenNext frontend, public gateway, security headers, request normalization, provider readiness, and bounded orchestration.
- **Supabase:** OAuth identities, PostgreSQL authority, RLS, private Storage, jobs, outbox, usage, evidence, reviews, exports, audit, and deletion lifecycle.
- **Qdrant Cloud:** reconstructible vector index with workspace, source-version, and index-generation filters.
- **Gemini API:** bounded generation and OCR through fail-closed quota and privacy controls.
- **Computer Worker:** heavy extraction, DuckDB/bulk processing, and queued ingestion where an edge runtime is unsuitable.

Vercel and Render are retired from the active deployment configuration. Their repository blueprints have been removed.

## Request flow

1. The OpenNext frontend obtains a Supabase session and sends its access token plus workspace context to the Cloudflare gateway.
2. The gateway validates request shape, environment identity, capabilities, budgets, and rights before admitting work.
3. Supabase remains authoritative for tenant membership and durable business records.
4. Qdrant stores only reconstructible embeddings and payloads fenced by workspace, version, and generation.
5. Gemini receives only the minimum selected context after rights, privacy, and budget admission.
6. Heavy operations are queued for the Computer Worker; customer evidence is never treated as reconstructible cache data.

## Deployment artifacts

- `frontend/open-next.config.ts`
- `frontend/wrangler.jsonc`
- `packages/cloudflare/wrangler.preview.jsonc`
- `.github/workflows/cloudflare-preview-deploy.yml`
- `.github/workflows/v6-live-provider-validation.yml`
- `supabase/baseline/001_v6_zero_cost_baseline.sql`

## Failure posture

Unknown rights, undocumented quotas, unavailable providers, paused Supabase, and stale vector generations fail closed with typed states. Export and deletion remain essential-priority operations. There is no hidden paid fallback.
