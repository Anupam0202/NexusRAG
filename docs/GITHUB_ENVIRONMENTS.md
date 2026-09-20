# GitHub environments

## Active environments

`Preview` is the only deployment environment required before this branch can
merge. Do not create a `Production` environment until a production domain,
cutover plan, and separate release approval exist.

## Preview secrets

Store only credentials as environment secrets:

| Name | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Scoped Workers Scripts edit token |
| `QDRANT_API_KEY` | Qdrant Cloud credential |
| `GEMINI_API_KEY` | Gemini API credential |

`GOOGLE_API_KEY` remains a temporary compatibility alias. Prefer one Gemini
secret and remove the duplicate after confirming `GEMINI_API_KEY` works.

## Preview variables

Store identifiers, endpoints, public client configuration, and feature flags as
environment variables:

| Name | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| `NEXT_PUBLIC_API_URL` | Cloudflare gateway origin |
| `NEXT_PUBLIC_SITE_URL` | Canonical Cloudflare frontend origin |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project API origin |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe Supabase publishable key |
| `NEXT_PUBLIC_OAUTH_PROVIDERS` | Comma-separated enabled providers, currently `github` unless Google is configured |
| `QDRANT_URL` | Qdrant cluster endpoint |
| `QDRANT_COLLECTION_PREFIX` | Disposable validation collection prefix |

The workflows accept a few older aliases so rotations are non-disruptive, but
new configuration should use the canonical names above.

## Protection and ownership

- Require approval for `Production` when it is eventually created.
- Keep `Preview` automatic while the branch is under active validation.
- Restrict each token to the smallest required external scope.
- Never store service-role keys, database passwords, or private provider keys
  in repository variables.
- Keep public frontend configuration in variables, not secrets.
- Rotate a credential in one canonical secret rather than duplicating it at
  repository and environment scope.
- A missing required value must fail the deployment before build or upload.

## Current merge gate

`Cloudflare Preview Deploy` must build, deploy, and smoke-test:

1. the frontend homepage;
2. the Evidence OS route;
3. the gateway `ZERO_COST_LOW_TRAFFIC` health contract.

The pull request remains draft and unmerged until that protected job and all
foundation checks succeed on the same commit.