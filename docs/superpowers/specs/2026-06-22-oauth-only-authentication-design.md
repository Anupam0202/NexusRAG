# NexusRAG OAuth-Only Authentication Design

Date: 2026-06-22
Status: Approved for implementation

## Objective

Replace public email/password and email-link authentication with a zero-cost OAuth-only flow using Google and GitHub through Supabase Auth. Google is the primary provider and GitHub is the secondary provider.

The change must remove NexusRAG's production dependency on transactional authentication email while preserving Supabase-issued sessions, backend JWT validation, workspace isolation, RLS, RBAC, onboarding, and sign-out behavior.

## Product Decisions

- `/auth/login` is the single public authentication gateway.
- Google is displayed first and GitHub second.
- `/auth/signup` redirects to `/auth/login` with signup intent and an onboarding destination.
- First successful OAuth sign-in creates the Supabase user and continues to onboarding when no workspace exists.
- Returning users continue to their requested safe destination.
- Public password sign-in, password signup, magic links, confirmation resend, forgot-password, password-reset, and password-change controls are retired.
- Existing Supabase users are not deleted. Supabase automatic identity linking joins a trusted OAuth identity to an existing user with the same verified email.
- Resend and custom SMTP are not required for this authentication model.

## Alternatives Considered

### Unified OAuth gateway (selected)

One page owns provider selection, redirect construction, loading state, and safe errors. This minimizes duplicated security logic and gives both new and returning users the same predictable flow.

### Separate OAuth login and signup pages

This communicates intent explicitly but duplicates provider controls and redirect behavior. OAuth itself does not need separate login and registration operations, so the duplication adds maintenance risk without improving security.

### OAuth with a hidden password fallback

This reduces migration risk for legacy users but keeps recovery email as an unresolved dependency and does not satisfy the approved OAuth-only scope.

## Authentication Architecture

Supabase Auth remains the sole identity, credential, and session authority. NexusRAG never receives Google or GitHub passwords and does not store OAuth client secrets in application code, Vercel variables, browser storage, or FastAPI.

The browser starts authentication with:

```ts
supabase.auth.signInWithOAuth({
  provider: "google" | "github",
  options: { redirectTo: safeCallbackUrl },
})
```

Provider credentials are stored only in the production Supabase Auth provider configuration. Supabase handles provider authorization and redirects the browser back to the existing NexusRAG callback route with an authorization code. The callback exchanges the code for a Supabase session, updates frontend auth state, resolves the current workspace, and redirects to the requested destination or onboarding.

FastAPI continues to receive only Supabase access tokens. Existing JWT signature validation, user resolution, workspace membership checks, RBAC, RLS, and route authorization remain unchanged.

## Route Behavior

### `/auth/login`

- Render a compact OAuth gateway with two full-width provider buttons.
- Display Google first and GitHub second.
- Use familiar provider marks and accessible provider names.
- Preserve a sanitized `next` query parameter.
- Use `/documents` as the returning-user fallback.
- Use `/onboarding` when signup intent is present.
- Disable both buttons while an OAuth request is being initiated to prevent duplicate submissions.
- Show only generic, actionable errors; never expose provider payloads, tokens, or internal Supabase details.
- Redirect authenticated users immediately to their safe destination.

### `/auth/signup`

- Redirect to `/auth/login?intent=signup&next=/onboarding`.
- Preserve an explicitly supplied safe `next` path when present.
- Do not render a second set of OAuth controls.

### `/auth/callback`

- Continue exchanging a returned authorization code for a Supabase session.
- Continue sanitizing `next` before navigation.
- Continue routing workspace-independent destinations directly.
- Continue sending users without a workspace to `/onboarding`.
- Replace email-link wording with provider-neutral sign-in wording.
- Never include provider errors or authorization codes in rendered details or telemetry.

### Retired email routes

The following public routes redirect safely to `/auth/login` while preserving an allowed destination where relevant:

- `/auth/forgot-password`
- `/auth/update-password`
- `/auth/confirm`

The token-consuming `/auth/confirm/verify` route remains secure during the migration but is no longer linked from public UI. It may be removed in a later cleanup after production OAuth verification and rollback confidence are established.

## Account Security Settings

`/settings/security` remains authenticated and provides:

- signed-in email address;
- linked Google and GitHub identities returned by Supabase;
- provider-neutral account verification status;
- current-session sign-out;
- all-session sign-out;
- guidance when only one identity is linked.

Password fields, password policy controls, and password-update calls are removed from this page. The page must not display access tokens, refresh tokens, provider subject identifiers, session identifiers, or raw identity metadata.

## Existing User Migration

No auth users, workspaces, documents, memberships, or audit records are rewritten.

Supabase automatic identity linking is relied on only when the OAuth provider returns the same verified email as an existing user. This preserves the existing Supabase user ID and therefore preserves workspace ownership and membership references.

Users whose OAuth email differs from their existing NexusRAG email will create a separate account. NexusRAG will not implement automatic cross-email account merging because that could enable account takeover. Manual identity linking remains outside this implementation slice.

The email provider may remain enabled in Supabase during initial rollout for rollback safety, but the production NexusRAG UI exposes only Google and GitHub. After both production OAuth providers pass end-to-end verification and legacy access is confirmed, password and email-link sign-in can be disabled at the Supabase provider level.

## External Provider Configuration

### Shared Supabase callback

Both provider applications use:

```text
https://fcjaomiceajcdownarel.supabase.co/auth/v1/callback
```

### Google

- Create a Google Cloud OAuth web client at no cost.
- Configure the OAuth consent screen for NexusRAG.
- Request only `openid`, `email`, and `profile` scopes through Supabase defaults.
- Add the Supabase callback as an authorized redirect URI.
- Publish the consent screen for public use once configuration is verified.
- Store the client ID and client secret only in Supabase Auth.

### GitHub

- Create a GitHub OAuth App at no cost.
- Use `https://nexusrag.vercel.app` as the homepage URL.
- Use the shared Supabase callback as the authorization callback URL.
- Store the client ID and client secret only in Supabase Auth.

### Supabase URL configuration

- Site URL: `https://nexusrag.vercel.app`
- Production redirect: `https://nexusrag.vercel.app/auth/callback`
- Local redirect: `http://localhost:3000/auth/callback`
- Do not allow wildcard external origins.

## Security Requirements

- Preserve `sanitizeAuthNextPath` for every user-controlled destination.
- Reject protocol-relative, cross-origin, encoded external, and malformed redirect destinations.
- Never log OAuth authorization codes, provider tokens, Supabase access or refresh tokens, OAuth client secrets, or full provider error objects.
- Keep provider secrets exclusively in Supabase dashboard configuration.
- Keep backend authorization independent of frontend route guards.
- Retain generic public authentication errors to prevent information leakage.
- Prevent duplicate OAuth starts while a request is pending.
- Do not request offline provider access because NexusRAG does not call Google or GitHub APIs on users' behalf.
- Do not weaken RLS, JWT validation, workspace membership checks, or API authorization.
- Do not disable existing authentication methods in Supabase until production OAuth verification and rollback readiness are complete.

## UX and Accessibility

- Authentication controls work at mobile, tablet, laptop, and wide-desktop sizes.
- Provider buttons retain stable dimensions and clear keyboard focus states.
- Loading state identifies the selected provider without shifting layout.
- Errors use an accessible live region and preserve focus.
- Provider controls have explicit accessible names.
- The page follows existing NexusRAG light and dark themes.
- Authentication copy explains that the provider supplies a verified identity without exposing implementation details.

## Test Strategy

### Unit and component tests

- Google is rendered before GitHub.
- Each button calls `signInWithOAuth` with the correct provider.
- OAuth redirects use the sanitized requested destination.
- Signup intent defaults to onboarding.
- Both buttons are disabled while a provider request is pending.
- Provider errors are replaced with a generic safe message.
- Authenticated users are redirected without starting a new OAuth flow.
- Retired email routes redirect to OAuth login.
- Security settings render linked providers and no password controls.
- Sign-out scope behavior remains unchanged.

### Local integration and browser tests

- Login and signup-intent routes render correctly at desktop and mobile widths.
- Legacy routes redirect safely.
- Callback errors show provider-neutral recovery guidance.
- Unsafe `next` values cannot produce external redirects.
- Session persistence and protected-route behavior continue to work with a mocked or controlled Supabase session.

### Production end-to-end tests

- Google sign-in creates or restores a Supabase session.
- GitHub sign-in creates or restores a Supabase session.
- First-time users reach onboarding and can create a workspace.
- Returning users reach the requested protected route.
- Existing same-email users retain their workspace memberships.
- Reload preserves the session.
- Current-session and all-session sign-out work.
- Valid JWTs reach Render and invalid JWTs are rejected.
- Cross-workspace access remains rejected.

Provider login, consent, CAPTCHA, 2FA, or security challenges may require the account owner to complete the provider-controlled step. NexusRAG verification will not claim those scenarios passed unless they are actually executed.

## Verification Gates

Implementation is ready to deploy only when:

- focused frontend tests pass;
- full frontend Vitest passes;
- frontend lint passes;
- frontend production build passes;
- backend regression tests pass;
- security checks find no introduced high-severity issue;
- public Playwright smoke tests pass on desktop and mobile;
- both provider configurations are enabled in production Supabase;
- real production Google and GitHub flows are exercised through the Vercel application;
- protected Render API access is verified with a resulting Supabase JWT.

## Rollout and Rollback

Roll out frontend OAuth controls before disabling Supabase email/password provider support. If either OAuth provider fails in production, keep the other provider available and restore the previous frontend authentication release if both fail.

No database migration is required. Rollback does not modify users, identities, workspaces, memberships, or documents.

## Acceptance Criteria

- NexusRAG exposes Google and GitHub as its only public authentication methods.
- Google appears first and GitHub second.
- Authentication requires no transactional email sender or paid domain.
- New and returning users receive Supabase sessions through OAuth.
- Existing same-email accounts retain their Supabase user identity and workspace access.
- Email-dependent routes no longer advertise unusable workflows.
- Account security settings reflect OAuth identities and retain session controls.
- All redirect, error-handling, JWT, RLS, RBAC, and workspace-isolation requirements remain intact.
- No provider secrets or tokens enter the repository, Vercel public variables, frontend bundles, logs, or FastAPI.
