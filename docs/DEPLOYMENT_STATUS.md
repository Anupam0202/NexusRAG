# Deployment status

Status: `PREVIEW_VERIFIED`

## Verified

- The Next.js 16 application builds successfully with OpenNext for Cloudflare.
- Cloudflare gateway secret bindings exist without exposing their values.
- Bounded live Qdrant validation passed create, payload-index, upsert, workspace/version-filtered query, and cleanup.
- Bounded live Gemini validation passed with synthetic content, thinking disabled, no customer data, and no paid fallback.
- The clean Supabase baseline rehearsal, migration integrity, RLS contracts, private Storage contracts, frontend build, dependency review, SBOM, and licence inventory pass in CI.
- Vercel and Render deployment blueprints are removed from the active branch.

## Active deployment path

1. GitHub `Preview` supplies Cloudflare credentials and public Supabase/gateway/frontend configuration.
2. `.github/workflows/cloudflare-preview-deploy.yml` builds with OpenNext and deploys to Cloudflare Workers.
3. Supabase remains the durable authority.
4. Qdrant remains reconstructible and tenant/version fenced.
5. Gemini is admitted only through bounded validation and runtime quota controls.

## Deliberately unchanged

- Supabase leaked-password protection remains disabled by explicit operator decision.
- No custom-domain DNS cutover is claimed because the connected Cloudflare account has no zone.
- Production verification and release remain separate from preview verification.
