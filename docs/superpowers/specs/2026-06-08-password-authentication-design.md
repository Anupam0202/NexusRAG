# Production Password Authentication Design

**Date:** 2026-06-08
**Status:** Proposed for implementation
**Scope:** NexusRAG frontend authentication UX, Supabase Auth configuration, account-security controls, and verification

## 1. Objective

Make email and password the primary NexusRAG sign-in method while preserving secure email magic links as an optional secondary method.

Users must be able to sign in repeatedly with their verified email address and password without requesting a new email each time. Authentication rate limits, lockout protections, and abuse controls must remain enabled. "Unlimited sign-in" means the product does not impose a usage quota on legitimate sign-ins; it does not mean unlimited unauthenticated attempts.

The implementation must:

- require email verification for new accounts;
- support secure forgot-password and password-reset flows;
- provide clear password-strength validation;
- preserve session persistence through the existing Supabase SSR integration;
- provide account-security controls for password changes and session sign-out;
- retain magic-link sign-in as an optional fallback;
- preserve all existing JWT validation, workspace isolation, RLS, and backend authorization;
- avoid account enumeration, open redirects, token leakage, and credential logging.

## 2. Security Boundary

Supabase Auth remains the sole credential and session authority.

NexusRAG must never:

- store plaintext passwords;
- store password hashes in application tables;
- send passwords to the FastAPI backend;
- log passwords, password fields, access tokens, refresh tokens, verification tokens, or full authentication request bodies;
- implement a separate password database or custom password-verification endpoint.

Supabase Auth stores password credentials in its managed auth schema using secure password hashing. The NexusRAG backend continues to receive and validate only Supabase-issued JWTs. Existing workspace membership checks, RBAC, RLS, and route authorization remain unchanged.

## 3. User-Facing Authentication Model

### 3.1 Primary Sign-In

The default sign-in form uses:

- email address;
- password;
- a submit action;
- a forgot-password link;
- a secondary option to request a magic sign-in link;
- a link to create an account.

The form calls `supabase.auth.signInWithPassword({ email, password })`.

All invalid credential outcomes display a generic message such as:

> We could not sign you in with those credentials.

The UI must not reveal whether an email address exists, is unverified, uses a different provider, or has an incorrect password.

### 3.2 Signup

The signup form uses:

- email address;
- password;
- confirm password;
- visible password requirements;
- a submit action;
- a link to sign in.

The form calls `supabase.auth.signUp({ email, password, options })`. Supabase email confirmation remains mandatory. The confirmation email routes through the existing prefetch-safe `/auth/confirm` flow, then sends the verified user to onboarding or the requested safe destination.

The signup success screen must clearly state that the account is not active until the email address is confirmed.

### 3.3 Optional Magic-Link Sign-In

Magic-link sign-in remains available as a secondary method from the sign-in page. It calls `supabase.auth.signInWithOtp` with `shouldCreateUser: false`.

Magic-link signup is removed from the primary signup experience. Account creation requires a password so new users immediately have the primary repeat sign-in method requested for NexusRAG.

The existing token-hash confirmation architecture remains in place so magic links can be opened in a different browser or device without depending on a PKCE verifier stored in the initiating browser.

### 3.4 Forgot Password

The `/auth/forgot-password` page accepts an email address and calls:

```ts
supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${origin}/auth/confirm?next=/auth/update-password`,
})
```

The public response is identical whether or not the account exists:

> If an account exists for that email, a password-reset link has been sent.

The recovery email must use a token-hash confirmation URL whose type is `recovery`. It must not rely on a browser-local PKCE verifier.

### 3.5 Password Reset

The existing `/auth/confirm` flow is extended to accept only explicitly allowed OTP types:

- `email` for signup confirmation and magic-link sign-in;
- `recovery` for password recovery.

The confirmation route continues to:

- require an explicit same-origin POST before consuming the token;
- use a strict no-referrer policy;
- validate and sanitize the destination path;
- reject unsupported token types;
- avoid placing authentication tokens in application logs or client-visible error details.

After successful recovery verification, the user is redirected to `/auth/update-password`, which requires:

- new password;
- confirm password;
- password-policy validation.

The page calls `supabase.auth.updateUser({ password })`. On success, it redirects to `/settings/security` or a safe authenticated destination with a clear confirmation message.

### 3.6 Account Security

A new `/settings/security` page provides:

- the signed-in email address;
- email verification status where available;
- change-password form;
- sign out of the current session;
- sign out of other sessions or all sessions when supported by the installed Supabase SDK;
- clear reauthentication guidance if Supabase requires a recent session for a sensitive operation.

The page is available only to authenticated users. It does not display password values, tokens, session identifiers, or internal auth metadata.

## 4. Password Policy

NexusRAG provides client-side guidance and validation while Supabase project policy remains authoritative.

The application policy is:

- minimum 12 characters;
- maximum 128 characters;
- at least one uppercase letter;
- at least one lowercase letter;
- at least one number;
- at least one symbol;
- password and confirmation must match;
- leading and trailing spaces are preserved rather than silently changed.

Password inputs use the correct autocomplete values:

- sign in: `current-password`;
- signup, reset, and change: `new-password`;
- email: `email`.

Password visibility controls use an icon button with an accessible label. Password requirements are announced accessibly and update without shifting the surrounding layout.

The client policy improves usability but does not replace server-side enforcement. Supabase Auth configuration must enforce a compatible minimum password policy and leaked-password protection when available for the selected Supabase plan.

## 5. Session and Routing Design

The existing `@supabase/ssr` browser and server clients remain the session mechanism.

- Browser sessions persist through Supabase-managed cookies/storage.
- `AuthProvider` continues to synchronize initial and changed auth state.
- Protected frontend screens continue to require an authenticated session.
- The backend continues to validate Supabase JWTs and workspace membership.
- Password authentication does not introduce a separate backend session.

All authentication destinations pass through `sanitizeAuthNextPath`. Only same-origin application paths are allowed. External URLs, protocol-relative URLs, encoded redirect attacks, and unsafe fallback paths are rejected.

## 6. Components and Routes

### 6.1 New Frontend Files

- `frontend/src/app/auth/forgot-password/page.tsx`
- `frontend/src/app/auth/update-password/page.tsx`
- `frontend/src/app/settings/security/page.tsx`
- `frontend/src/components/auth/PasswordField.tsx`
- `frontend/src/components/auth/PasswordRequirements.tsx`
- `frontend/src/lib/password-policy.ts`
- focused unit and component tests for these modules

### 6.2 Modified Frontend Files

- `frontend/src/app/auth/login/page.tsx`
  - make password sign-in the default;
  - keep magic-link sign-in as a secondary mode;
  - use generic errors and double-submit protection.
- `frontend/src/app/auth/signup/page.tsx`
  - replace magic-link signup with password signup;
  - require password confirmation and policy validation.
- `frontend/src/app/auth/confirm/page.tsx`
  - recognize recovery confirmation without exposing token details.
- `frontend/src/app/auth/confirm/verify/route.ts`
  - safely allow `email` and `recovery` OTP types;
  - preserve same-origin POST, no-referrer, and safe redirects.
- `frontend/src/app/auth/callback/page.tsx`
  - retain compatibility for valid OAuth or PKCE callbacks if used later;
  - keep safe destination handling.
- `frontend/src/components/auth/AuthMenu.tsx`
  - expose account-security navigation for authenticated users.
- `frontend/src/app/settings/page.tsx`
  - link to account-security settings.
- frontend route-title and navigation helpers as needed.

### 6.3 Supabase Email Templates

- Keep the committed confirmation template for signup and magic links.
- Add a recovery template that routes to `/auth/confirm` with a token hash, `type=recovery`, and `next=/auth/update-password`.
- Ensure email links use the production application origin.

Custom SMTP may be configured for production deliverability and branding, but it is not part of password storage or verification logic.

### 6.4 Backend

No new password endpoints are added to FastAPI.

The backend remains responsible for:

- validating Supabase-issued JWTs;
- resolving authenticated users and workspaces;
- enforcing RBAC and workspace isolation;
- applying existing API rate limits and audit behavior.

Existing backend authentication and authorization tests must continue to pass unchanged.

## 7. Error Handling and Abuse Protection

### 7.1 Public Error Rules

- Sign-in failures use one generic invalid-credentials message.
- Forgot-password requests always display the same success response.
- Signup must not expose internal Supabase errors or database details.
- Confirmation and recovery failures provide a safe action to restart the relevant flow.
- Network failures provide a retryable, user-friendly message without claiming success.

### 7.2 Rate Limiting

Supabase Auth rate limits remain enabled for:

- password sign-in;
- signup;
- verification email requests;
- magic-link requests;
- password-recovery requests.

The UI prevents accidental duplicate submissions and respects provider retry guidance where available. The application must not add an insecure bypass to make sign-in appear unlimited.

### 7.3 Logging and Telemetry

Authentication telemetry may record:

- operation name;
- success or failure category;
- request ID;
- coarse latency;
- environment.

It must not record:

- passwords;
- email-link token hashes;
- access or refresh tokens;
- full Supabase error payloads when they may contain sensitive data;
- raw form bodies.

## 8. Supabase and Deployment Configuration

### 8.1 Supabase Auth

Production configuration must:

- enable email/password signups;
- require email confirmation;
- keep password sign-in enabled;
- keep magic-link sign-in enabled as the secondary method;
- set the Site URL to `https://nexusrag.vercel.app`;
- allowlist only required production and local-development callback URLs;
- configure compatible password-strength requirements;
- keep authentication rate limits enabled;
- configure production SMTP when reliable delivery is required.

### 8.2 Vercel

Vercel continues to provide the public Supabase URL and anon/publishable key to the frontend. No service-role key or password credential may be exposed to the browser.

After implementation:

- deploy the frontend;
- verify auth environment variables;
- verify production routes and security headers;
- confirm confirmation and recovery links use the production domain.

### 8.3 Render

Render configuration does not receive or process passwords. The backend continues to use the configured Supabase JWT verification settings and service-role access only for authorized server operations.

After implementation:

- verify backend health;
- verify valid password-authenticated JWTs work;
- verify invalid and cross-workspace JWT access remains rejected.

## 9. Testing Strategy

### 9.1 Unit Tests

- password policy accepts and rejects each rule correctly;
- confirmation accepts only allowed OTP types;
- confirmation rejects unsafe destinations and cross-origin submissions;
- public auth errors are sanitized;
- password values are never included in telemetry helpers.

### 9.2 Frontend Component Tests

- sign-in defaults to password mode;
- users can switch to optional magic-link mode;
- signup validates password strength and matching confirmation;
- forgot-password uses a generic response;
- update-password validates strength and matching confirmation;
- account-security controls require an authenticated user;
- password visibility controls are keyboard and screen-reader accessible.

### 9.3 Local End-to-End Tests

- verified user signs in repeatedly with email and password;
- invalid password produces a generic error;
- unverified signup follows the verification-required state;
- password recovery establishes a recovery session and updates the password;
- old password fails after password change;
- new password succeeds;
- magic-link fallback remains functional;
- session persists across reloads;
- current-session and broader sign-out controls behave as supported;
- existing two-user/two-workspace isolation tests continue to pass.

### 9.4 Production Verification

- signup confirmation links resolve to the production Vercel domain;
- recovery links resolve to the production Vercel domain;
- authenticated frontend requests reach Render with a valid JWT;
- upload, ingestion, chat, citations, deletion, and workspace isolation still work after password authentication;
- mobile and desktop auth screens are visually and functionally verified.

Production email confirmation and recovery E2E are reported as verified only when a controlled test inbox and production Supabase access are available. No unexecuted scenario will be reported as passing.

## 10. Accessibility and Responsive UX

Authentication screens must:

- work at mobile, tablet, laptop, and wide-desktop widths;
- use visible labels and programmatic input associations;
- provide keyboard-accessible controls;
- expose validation errors through an accessible live region;
- preserve focus after recoverable errors;
- avoid overflowing password requirements or action controls;
- provide a clear loading state without moving the form layout;
- meet existing NexusRAG light and dark theme conventions.

## 11. Documentation Updates

Implementation includes updates to:

- authentication and security sections in `README.md`;
- `docs/SECURITY.md`;
- `docs/DEPLOYMENT_PRODUCTION.md`;
- relevant environment examples;
- E2E setup instructions for controlled auth test users and inboxes.

Documentation must clearly state:

- Supabase Auth stores and verifies passwords;
- NexusRAG does not store application passwords;
- email verification is mandatory;
- rate limits remain enabled;
- magic links are optional secondary authentication;
- production email-link destinations require correct Supabase Site URL and redirect allowlisting.

## 12. Rollout and Acceptance Criteria

The authentication upgrade is complete only when:

1. Password sign-in is the default and works repeatedly for a verified account.
2. New signup requires a policy-compliant password and mandatory email verification.
3. Confirmation links work across browsers and devices without a PKCE-verifier error.
4. Forgot-password and password-reset flows work without account enumeration.
5. Magic-link sign-in remains available as a secondary method.
6. Account-security settings support password change and available session sign-out scopes.
7. NexusRAG stores no passwords or password hashes in application tables or logs.
8. Existing JWT validation, RLS, RBAC, workspace isolation, and backend route protection remain intact.
9. Frontend tests, backend tests, lint, production builds, security scans, and applicable E2E suites pass.
10. Production Vercel and Render deployments are healthy and verified without unsupported claims.

## 13. Explicit Non-Goals

- Building a custom credential database.
- Sending passwords to FastAPI.
- Removing authentication rate limits.
- Replacing Supabase Auth.
- Adding social login or enterprise SSO in this slice.
- Claiming literal unlimited brute-force attempts.

## 14. Design Decision

NexusRAG will use a hybrid authentication model:

- **Primary:** verified email and password;
- **Secondary:** secure magic-link sign-in;
- **Authority:** Supabase Auth;
- **Application responsibility:** safe UX, routing, validation, account controls, and verification;
- **Backend responsibility:** JWT validation and authorization, never password handling.

This design gives users dependable repeat sign-in while preserving a secure fallback and the existing multi-tenant authorization architecture.
