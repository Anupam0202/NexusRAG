# Production Password Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make verified email and password the primary repeat sign-in method, retain optional magic links, and add secure recovery and account-security workflows without moving credential handling outside Supabase Auth.

**Architecture:** Keep Supabase Auth as the only credential/session authority and preserve the existing `@supabase/ssr` clients, JWT backend validation, workspace isolation, and RLS. Add focused frontend auth helpers and pages, extend the prefetch-safe token-hash confirmation route for recovery, and configure committed Supabase email templates for production-domain confirmation and recovery.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Auth and `@supabase/ssr`, Tailwind CSS, Lucide, Vitest, Testing Library, Playwright, FastAPI regression suite.

---

## File Structure

- Create `frontend/src/lib/password-policy.ts`: pure password-policy and safe public-auth-message helpers.
- Create `frontend/src/lib/password-policy.test.ts`: password-policy regression tests.
- Create `frontend/src/components/auth/PasswordField.tsx`: reusable accessible password input.
- Create `frontend/src/components/auth/PasswordRequirements.tsx`: stable accessible policy feedback.
- Create `frontend/src/app/auth/forgot-password/page.tsx`: generic password-recovery request flow.
- Create `frontend/src/app/auth/update-password/page.tsx`: recovery-session password update flow.
- Create `frontend/src/app/settings/security/page.tsx`: authenticated password and session controls.
- Create `supabase/templates/recovery.html`: cross-device token-hash recovery template.
- Modify `frontend/src/app/auth/login/page.tsx`: password-first sign-in and secondary magic-link mode.
- Modify `frontend/src/app/auth/signup/page.tsx`: verified password signup.
- Modify `frontend/src/app/auth/confirm/page.tsx`: email and recovery confirmation UX.
- Modify `frontend/src/app/auth/confirm/verify/route.ts`: allow only `email` and `recovery` token types.
- Modify `frontend/src/app/auth/confirm/verify/route.test.ts`: recovery and unsupported-type regressions.
- Modify `frontend/src/components/auth/AuthMenu.tsx`: account-security link and safe sign-out errors.
- Modify `frontend/src/app/settings/page.tsx`: security settings entry.
- Modify `frontend/src/components/layout/Header.tsx`: route titles.
- Modify `frontend/src/e2e/public-smoke.spec.ts`: public auth and recovery smoke coverage.
- Modify `README.md`, `docs/SECURITY.md`, and `docs/DEPLOYMENT_PRODUCTION.md`: production auth operations.

### Task 1: Password Policy Primitive

**Files:**
- Create: `frontend/src/lib/password-policy.test.ts`
- Create: `frontend/src/lib/password-policy.ts`

- [ ] **Step 1: Write failing password-policy tests**

Test the 12-to-128-character bounds, uppercase, lowercase, number, symbol, preserved surrounding whitespace, matching confirmation, and generic public error messages.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/lib/password-policy.test.ts`

Expected: FAIL because `password-policy.ts` does not exist.

- [ ] **Step 3: Implement the pure policy API**

Expose:

```ts
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export function passwordChecks(password: string): PasswordChecks;
export function passwordValidationError(password: string, confirmation?: string): string | null;
export function genericAuthError(operation: "sign-in" | "signup" | "password-update"): string;
```

Do not trim or log the password.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- src/lib/password-policy.test.ts`

Expected: all password-policy tests pass.

### Task 2: Recovery-Safe Token Confirmation

**Files:**
- Modify: `frontend/src/app/auth/confirm/verify/route.test.ts`
- Modify: `frontend/src/app/auth/confirm/verify/route.ts`
- Modify: `frontend/src/app/auth/confirm/page.tsx`
- Create: `supabase/templates/recovery.html`

- [ ] **Step 1: Add failing recovery confirmation tests**

Add a test proving `type=recovery` calls:

```ts
verifyOtp({ token_hash: "valid-recovery-hash", type: "recovery" })
```

and safely redirects to `/auth/update-password`. Retain tests proving unsupported types and cross-origin requests are rejected.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/app/auth/confirm/verify/route.test.ts`

Expected: recovery verification test fails because only `email` is accepted.

- [ ] **Step 3: Implement the allowed OTP type boundary**

Use an explicit type guard for only `email` and `recovery`, set the correct default destination for each type, and pass the verified type to `verifyOtp`.

- [ ] **Step 4: Update confirmation UX and recovery template**

Render recovery-specific copy and submit the validated type. Add `recovery.html` using `{{ .TokenHash }}`, `type=recovery`, and `next=/auth/update-password`; do not use `{{ .ConfirmationURL }}`.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- src/app/auth/confirm/verify/route.test.ts`

Expected: email, recovery, unsupported-type, provider-error, and CSRF tests pass.

### Task 3: Accessible Password Components

**Files:**
- Create: `frontend/src/components/auth/PasswordField.tsx`
- Create: `frontend/src/components/auth/PasswordRequirements.tsx`
- Create: `frontend/src/components/auth/PasswordField.test.tsx`

- [ ] **Step 1: Write failing component tests**

Test visible labels, `current-password` and `new-password` autocomplete values, accessible visibility toggles, and requirement status output.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/components/auth/PasswordField.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement focused accessible components**

Use Lucide `Eye` and `EyeOff`, a stable input height, icon-button labels of `Show password` and `Hide password`, and an `aria-live="polite"` requirements region.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- src/components/auth/PasswordField.test.tsx`

Expected: component tests pass.

### Task 4: Password-First Login and Signup

**Files:**
- Modify: `frontend/src/app/auth/login/page.tsx`
- Modify: `frontend/src/app/auth/signup/page.tsx`
- Create: `frontend/src/app/auth/login/page.test.tsx`
- Create: `frontend/src/app/auth/signup/page.test.tsx`

- [ ] **Step 1: Write failing page tests**

Test that login defaults to password mode and calls `signInWithPassword`; magic-link mode calls `signInWithOtp` with `shouldCreateUser: false`; signup calls `signUp` with email, password, and a safe production callback; weak and mismatched passwords never call Supabase.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/app/auth/login/page.test.tsx src/app/auth/signup/page.test.tsx`

Expected: password-mode tests fail against the current magic-link-only pages.

- [ ] **Step 3: Implement password-first login**

Use a compact segmented mode selector, generic credential failures, double-submit protection, a forgot-password link, and the existing safe callback builder for optional magic links.

- [ ] **Step 4: Implement verified password signup**

Call:

```ts
supabase.auth.signUp({
  email: normalizedEmail,
  password,
  options: { emailRedirectTo: safeCallbackUrl },
});
```

Show a verification-required success state and never surface raw provider error details.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- src/app/auth/login/page.test.tsx src/app/auth/signup/page.test.tsx`

Expected: all login and signup component tests pass.

### Task 5: Forgot and Update Password

**Files:**
- Create: `frontend/src/app/auth/forgot-password/page.tsx`
- Create: `frontend/src/app/auth/update-password/page.tsx`
- Create: `frontend/src/app/auth/password-flows.test.tsx`

- [ ] **Step 1: Write failing recovery-flow tests**

Test generic success for recovery requests, canonical `/auth/confirm?next=/auth/update-password` redirect construction, strong/matching update validation, and `updateUser({ password })`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/app/auth/password-flows.test.tsx`

Expected: FAIL because the recovery pages do not exist.

- [ ] **Step 3: Implement forgot-password page**

Call `resetPasswordForEmail` and always show the same public success state after a completed provider response, regardless of account existence.

- [ ] **Step 4: Implement update-password page**

Require an authenticated recovery session, validate the new password, call `updateUser`, show a safe outcome, and redirect to `/settings/security`.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- src/app/auth/password-flows.test.tsx`

Expected: recovery-flow tests pass.

### Task 6: Account Security and Navigation

**Files:**
- Create: `frontend/src/app/settings/security/page.tsx`
- Create: `frontend/src/app/settings/security/page.test.tsx`
- Modify: `frontend/src/components/auth/AuthMenu.tsx`
- Modify: `frontend/src/app/settings/page.tsx`
- Modify: `frontend/src/components/layout/Header.tsx`

- [ ] **Step 1: Write failing account-security tests**

Test signed-out gating, verified-email status, password update, current-session sign-out, global sign-out, and generic failure messages.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/app/settings/security/page.test.tsx`

Expected: FAIL because the security page does not exist.

- [ ] **Step 3: Implement account-security page**

Use existing auth state for gating and Supabase `updateUser`/`signOut` APIs. Clear workspace state after sign-out and avoid displaying session identifiers or provider internals.

- [ ] **Step 4: Add security navigation**

Add an account-security link to the auth menu and settings grid, plus route titles for forgot password, update password, and account security.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- src/app/settings/security/page.test.tsx`

Expected: account-security tests pass.

### Task 7: Documentation and Public Browser Coverage

**Files:**
- Modify: `frontend/src/e2e/public-smoke.spec.ts`
- Modify: `README.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/DEPLOYMENT_PRODUCTION.md`

- [ ] **Step 1: Add auth route smoke tests**

Cover `/auth/forgot-password`, recovery confirmation, `/auth/update-password`, and signed-out `/settings/security` at desktop and mobile browser projects.

- [ ] **Step 2: Update production operations documentation**

Document password-primary authentication, mandatory verification, recovery template installation, Site URL/redirect allowlisting, rate limits, optional magic links, SMTP deliverability, and the rule that passwords never reach NexusRAG tables or FastAPI.

- [ ] **Step 3: Run frontend verification**

Run:

```powershell
cd frontend
npm test
npm run lint
npm run build
npm run test:e2e
```

Expected: all configured frontend checks pass; authenticated isolation may skip only when dedicated E2E credentials are absent.

### Task 8: Security and End-to-End Regression Verification

**Files:**
- Review all changed files
- No planned backend source changes

- [ ] **Step 1: Run backend authorization regression suite**

Run:

```powershell
cd backend
python -m pytest
python -m ruff check .
python -m pip check
```

Expected: backend tests, Ruff, and dependency consistency pass.

- [ ] **Step 2: Run repository hygiene checks**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors or unexpected generated files.

- [ ] **Step 3: Run a diff-scoped security review**

Review the changed authentication and documentation files for credential leakage, open redirects, account enumeration, CSRF, unsafe token handling, and accidental service-role exposure. Record and fix every validated finding before deployment.

- [ ] **Step 4: Verify live services after deployment**

Verify Vercel production routes, Supabase production-domain confirmation/recovery configuration, Render health, and valid JWT access. Execute live email and authenticated upload/chat E2E only when controlled production test credentials and inbox access are available; report unavailable scenarios honestly.

