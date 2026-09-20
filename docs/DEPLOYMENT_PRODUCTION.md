# Production promotion

Preview verification does not authorize production or DNS cutover.

Before promotion:

1. Require all protected CI checks.
2. Re-run Supabase RLS and private Storage isolation with controlled multi-user fixtures.
3. Verify Qdrant workspace/version/generation isolation and reconstruction.
4. Verify Gemini quota, privacy, and cache fences.
5. Configure Cloudflare frontend/gateway URLs in Supabase Auth allowlists and OAuth applications.
6. Run desktop/mobile E2E, accessibility, canary, rollback, restore, export, and deletion rehearsals.
7. Confirm zero-cost limits remain hard and no billing fallback is configured.

Production must use Cloudflare for the frontend/gateway, Supabase for durable authority, Qdrant for reconstructible vectors, Gemini for admitted model calls, and the Computer Worker for heavy queued processing.
