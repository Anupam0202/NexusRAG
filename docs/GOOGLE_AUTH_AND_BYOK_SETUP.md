# Google sign-in and Gemini account-key setup

## Application behavior

- Google and GitHub are offered on the sign-in page. Both use Supabase Auth OAuth; enabling a button in the frontend does not activate the provider at Supabase or Google.
- Each authenticated Supabase user account receives five chat admissions and one initial document admission. The counters are atomic, account-scoped across workspaces, and do not reset when a document is deleted.
- Chat after the fifth admission and uploads after the first document require that account's own Gemini API key. There is a hard lifetime cap of 10 documents per account. Re-indexing an existing document does not consume another document slot.
- Account keys are validated against Google's model-list endpoint, encrypted with AES-256-GCM before persistence, never returned to the browser, never put in job messages or provider URLs, and sent to Gemini using the `x-goog-api-key` request header.
- The first trial document and first five chat requests use the configured platform Gemini key and still require the existing provider-budget admission. After that, Gemini calls use the user's key. Qdrant and Supabase remain application services and still require their own non-paid/free-tier capacity.
- Google, Supabase, Cloudflare, and Qdrant free-plan availability and billing are controlled by those providers. The application cannot guarantee that any user-owned Google key is free; users must review their Google AI Studio/Cloud plan, quota, terms, and billing settings.

## Preview prerequisites

1. Apply migrations 032 and 033 only to the isolated zero-cost rehearsal project `ukgjygzfhyvnrsecdcuu` after checking the exact target and successful migrations through 031. Migration 033 adds explicit restrictive client-deny policies for the service-only account tables. Do not apply to production as part of this setup.
2. Add a GitHub Actions **Preview** environment secret named `GEMINI_USER_KEY_ENCRYPTION_SECRET`. Generate 32 cryptographically random bytes and base64-encode them. Example (run locally; never commit or paste the result into chat):

   ```sh
   openssl rand -base64 32
   ```

   The deployment workflow validates and installs this secret as a Cloudflare Worker secret. Keep the same value across deployments; rotating it without a controlled re-encryption procedure makes stored user keys unreadable. Back it up in the approved secret manager.
3. Configure the Supabase Auth Google provider with an OAuth Client ID and Client Secret. In Google Cloud, add the exact Supabase Auth callback URL shown in Supabase's provider settings as an authorized redirect URI. In Supabase Auth URL Configuration, add the exact Preview frontend callback/origin to the allowed redirect list. Keep GitHub enabled as the second provider.
4. Configure the GitHub `Preview` environment with only the disposable rehearsal project's public URL, publishable key, and service-role secret, plus the account-key encryption secret and the owner-reviewed free-tier Gemini/Qdrant credentials. Confirm those provider accounts are on the intended free plans and below limits; no provider secrets are read by the workflow. The candidate Worker uses a separate vector collection and separate ingestion/DLQ queues. The workflow has an explicit project-ID allowlist and fails closed otherwise.
5. Apply migration 032 in Preview, set `NEXUSRAG_CANDIDATE_PREVIEW_DEPLOY=true` only after the Preview secret and OAuth configuration are present, then deploy from the exact PR head. Test with synthetic accounts and a Gemini key whose owner has explicitly reviewed its terms and quota.

## Verification criteria

- Google and GitHub OAuth each complete sign-in and callback to `/auth/callback`, then land on the requested safe application route.
- Two synthetic identities each have independent trial counters. Parallel requests cannot admit more than five platform-trial chat operations or more than one platform-trial document per user.
- The sixth chat attempt and second document attempt deny before invoking a provider when no key is configured. A valid account key unlocks follow-up chat and additional document admissions; a second account's key cannot unlock or decrypt the first account's data.
- Invalid keys are rejected and not persisted. Database rows contain ciphertext, nonce, and a masked fingerprint only. Logs, URLs, queue messages, usage events, browser storage, and responses never include the raw key.
- The 11th document admission is denied. Deletion does not restore trial/document allowance. Job retry/replay does not silently select the platform key for jobs marked `user_byok`.
- All above is tested on Preview only, with provider-call counts and database state inspected, then test users, uploads, and vectors are cleaned up.

## Not yet represented as verified

The source changes implement the application-side flow, but a repository change cannot enable external OAuth credentials, install Preview secrets, apply the migration, validate a real Google API key, or prove Google plan/billing terms. Those items must remain unverified until the Preview prerequisites and synthetic end-to-end tests above pass.