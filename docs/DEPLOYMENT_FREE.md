# Zero-cost preview deployment

The active `ZERO_COST_LOW_TRAFFIC` preview uses Cloudflare Workers, Supabase Free, Qdrant Cloud Free, and Gemini recurring free allowance.

## GitHub Preview environment

Required secrets: `CLOUDFLARE_API_TOKEN`, `QDRANT_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY`, and `SUPABASE_PUBLISHABLE_KEY`.

Required variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_URL`, `CLOUDFLARE_FRONTEND_URL`, `SUPABASE_URL`, and `QDRANT_URL`.

Optional variables: `QDRANT_COLLECTION_PREFIX` and `NEXT_PUBLIC_OAUTH_PROVIDERS`.

The workflow fails when required configuration is absent. It does not fall back to Vercel, Render, Railway, a paid model, or an unscoped local vector store.

```bash
cd frontend
npm ci --ignore-scripts
npm run cf:build
npm run cf:deploy
```

Run live provider verification through `V6 Live Provider Validation`. Its Qdrant collection is disposable and deleted in a `finally` path; its Gemini request contains synthetic data only.
