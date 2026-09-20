# Archived implementation planning records

The files in this directory preserve historical design and execution plans. They
are not deployment runbooks and may refer to providers, domains, assumptions,
or procedures that have since been retired.

Current operational authority lives in:

- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT_STATUS.md`
- `docs/DEPLOYMENT_FREE.md`
- `docs/DEPLOYMENT_PRODUCTION.md`
- `.github/workflows/`

For the active V6 profile, Cloudflare is the frontend and gateway deployment
boundary, Supabase is the durable authority, Qdrant is reconstructible, and
Gemini calls are quota admitted. Vercel and Render are not active deployment
paths.
