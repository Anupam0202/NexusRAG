# OAuth-Only Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace NexusRAG's public email-dependent authentication with a zero-cost Google-first, GitHub-second OAuth flow backed by Supabase Auth.

**Architecture:** A single Next.js OAuth gateway starts Supabase PKCE flows and preserves only sanitized internal destinations. Existing Supabase callback, JWT, RLS, RBAC, workspace, and onboarding boundaries remain authoritative; email-dependent routes become safe redirects and account security becomes identity/session focused.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase Auth and `@supabase/ssr`, Vitest, Testing Library, Playwright, FastAPI, Vercel, Render.

---

## File Structure

### Create

- `frontend/src/components/auth/GoogleMark.tsx`: accessible visual mark for the Google provider button.
- `frontend/src/app/auth/confirm/page.test.tsx`: verifies the retired confirmation page redirects safely.

### Modify

- `frontend/src/app/auth/login/page.tsx`: unified Google/GitHub OAuth gateway.
- `frontend/src/app/auth/login/page.test.tsx`: OAuth order, provider call, redirect, pending, and safe-error tests.
- `frontend/src/app/auth/signup/page.tsx`: server-side redirect to login with signup intent.
- `frontend/src/app/auth/signup/page.test.tsx`: signup redirect and destination sanitization tests.
- `frontend/src/app/auth/forgot-password/page.tsx`: safe redirect to OAuth login.
- `frontend/src/app/auth/forgot-password/page.test.tsx`: retired-route redirect test.
- `frontend/src/app/auth/update-password/page.tsx`: safe redirect to OAuth login.
- `frontend/src/app/auth/update-password/page.test.tsx`: retired-route redirect test.
- `frontend/src/app/auth/confirm/page.tsx`: safe redirect to OAuth login while retaining the secure POST verifier route for rollback.
- `frontend/src/app/auth/callback/page.tsx`: provider-neutral callback recovery copy.
- `frontend/src/lib/auth-redirect.ts`: provider-neutral public callback error text.
- `frontend/src/lib/auth-redirect.test.ts`: provider-neutral error and redirect regression coverage.
- `frontend/src/app/settings/security/page.tsx`: linked identity and session controls without password updates.
- `frontend/src/app/settings/security/page.test.tsx`: linked-provider and sign-out coverage.
- `frontend/src/app/settings/page.tsx`: OAuth-oriented account-security description.
- `frontend/src/components/layout/Header.tsx`: remove retired auth route titles.
- `frontend/src/e2e/public-smoke.spec.ts`: OAuth gateway, legacy redirects, callback, desktop, and mobile coverage.
- `README.md`: document OAuth-only local and production configuration.
- `docs/SECURITY.md`: document provider-secret and OAuth security boundaries.
- `docs/DEPLOYMENT_PRODUCTION.md`: document Google, GitHub, Supabase, Vercel, and rollback configuration.

### Preserve Unchanged

- `frontend/src/app/auth/confirm/verify/route.ts`: secure token-hash verifier retained temporarily for rollback.
- `frontend/src/lib/supabase/client.ts`: existing SSR browser client remains the session mechanism.
- Backend authentication, JWT validation, workspace membership, RLS, and RBAC modules.

---

### Task 1: Build the Unified OAuth Gateway

**Files:**
- Create: `frontend/src/components/auth/GoogleMark.tsx`
- Modify: `frontend/src/app/auth/login/page.test.tsx`
- Modify: `frontend/src/app/auth/login/page.tsx`

- [ ] **Step 1: Replace password tests with failing OAuth behavior tests**

Use hoisted mocks for `replace` and `signInWithOAuth`, and keep the existing signed-out store mock. The focused tests must include:

```tsx
it("renders Google before GitHub", () => {
  render(<LoginPage />);

  const buttons = screen.getAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual([
    expect.stringContaining("Continue with Google"),
    expect.stringContaining("Continue with GitHub"),
  ]);
});

it.each(["google", "github"] as const)("starts the %s OAuth flow", async (provider) => {
  render(<LoginPage />);

  fireEvent.click(
    screen.getByRole("button", {
      name: provider === "google" ? "Continue with Google" : "Continue with GitHub",
    })
  );

  await waitFor(() =>
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider,
      options: {
        redirectTo: expect.stringMatching(
          /^https:\/\/nexusrag\.vercel\.app\/auth\/callback\?next=%2Fdocuments$/
        ),
      },
    })
  );
});

it("uses onboarding for signup intent and blocks duplicate starts", async () => {
  window.history.replaceState({}, "", "/auth/login?intent=signup");
  let resolveRequest: (value: { error: null }) => void = () => undefined;
  signInWithOAuth.mockReturnValue(
    new Promise((resolve) => {
      resolveRequest = resolve;
    })
  );
  render(<LoginPage />);

  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

  expect(screen.getByRole("button", { name: "Connecting with Google" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeDisabled();
  expect(signInWithOAuth).toHaveBeenCalledWith(
    expect.objectContaining({
      options: {
        redirectTo: expect.stringContaining("next=%2Fonboarding"),
      },
    })
  );

  resolveRequest({ error: null });
});

it("does not expose provider error details", async () => {
  signInWithOAuth.mockResolvedValue({ error: new Error("sensitive provider payload") });
  render(<LoginPage />);

  fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));

  expect(
    await screen.findByText("We could not start secure sign-in. Please try again.")
  ).toBeVisible();
  expect(screen.queryByText(/sensitive provider payload/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from `frontend`:

```powershell
npm test -- src/app/auth/login/page.test.tsx
```

Expected: FAIL because password and magic-link controls exist and `signInWithOAuth` is not called.

- [ ] **Step 3: Add the Google provider mark**

Implement a fixed-size decorative mark that does not introduce another dependency:

```tsx
export function GoogleMark() {
  return (
    <span aria-hidden="true" className="grid h-5 w-5 place-items-center text-base font-bold">
      G
    </span>
  );
}
```

Keep the provider name in the button accessible name; the mark itself stays decorative.

- [ ] **Step 4: Replace the login form with OAuth controls**

Use these types and state boundaries:

```tsx
type OAuthProvider = "google" | "github";

const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null);
const [formError, setFormError] = useState<string | null>(null);
const [nextPath, setNextPath] = useState("/documents");
const [signupIntent, setSignupIntent] = useState(false);
```

Parse the URL once on mount:

```tsx
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const signup = params.get("intent") === "signup";
  setSignupIntent(signup);
  setNextPath(
    sanitizeAuthNextPath(params.get("next"), signup ? "/onboarding" : "/documents")
  );
}, []);
```

Start the selected flow with the existing secure callback builder:

```tsx
const startOAuth = async (provider: OAuthProvider) => {
  if (!supabaseReady || pendingProvider) return;
  setPendingProvider(provider);
  setFormError(null);

  try {
    const redirectTo = buildAuthCallbackUrl(
      window.location.origin,
      nextPath,
      process.env.NEXT_PUBLIC_SITE_URL
    );
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
    if (error) throw error;
  } catch {
    setFormError("We could not start secure sign-in. Please try again.");
    setPendingProvider(null);
  }
};
```

Render Google first, GitHub second. Use `Github` and `Loader2` from Lucide, stable `h-11` buttons, `aria-live="polite"` for errors, and provider-neutral copy. Do not render email, password, magic-link, forgot-password, or signup links.

- [ ] **Step 5: Run focused tests and verify GREEN**

```powershell
npm test -- src/app/auth/login/page.test.tsx
```

Expected: all OAuth gateway tests PASS.

- [ ] **Step 6: Commit the OAuth gateway**

```powershell
git add frontend/src/components/auth/GoogleMark.tsx frontend/src/app/auth/login/page.tsx frontend/src/app/auth/login/page.test.tsx
git commit -m "feat: add unified OAuth sign-in gateway"
```

---

### Task 2: Retire Email-Dependent Public Routes

**Files:**
- Modify: `frontend/src/app/auth/signup/page.tsx`
- Modify: `frontend/src/app/auth/signup/page.test.tsx`
- Modify: `frontend/src/app/auth/forgot-password/page.tsx`
- Modify: `frontend/src/app/auth/forgot-password/page.test.tsx`
- Modify: `frontend/src/app/auth/update-password/page.tsx`
- Modify: `frontend/src/app/auth/update-password/page.test.tsx`
- Modify: `frontend/src/app/auth/confirm/page.tsx`
- Create: `frontend/src/app/auth/confirm/page.test.tsx`

- [ ] **Step 1: Write failing redirect tests for signup**

Mock `redirect` and invoke the async server page directly:

```tsx
const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect }));

it("redirects signup intent to OAuth login and onboarding", async () => {
  await SignupPage({ searchParams: Promise.resolve({}) });
  expect(redirect).toHaveBeenCalledWith("/auth/login?intent=signup&next=%2Fonboarding");
});

it("preserves a safe requested destination", async () => {
  await SignupPage({ searchParams: Promise.resolve({ next: "/documents?status=ready" }) });
  expect(redirect).toHaveBeenCalledWith(
    "/auth/login?intent=signup&next=%2Fdocuments%3Fstatus%3Dready"
  );
});

it("rejects an external requested destination", async () => {
  await SignupPage({ searchParams: Promise.resolve({ next: "https://attacker.example" }) });
  expect(redirect).toHaveBeenCalledWith("/auth/login?intent=signup&next=%2Fonboarding");
});
```

- [ ] **Step 2: Write failing redirect tests for retired routes**

Each page test mocks `redirect`, invokes its page function, and expects:

```tsx
expect(redirect).toHaveBeenCalledWith("/auth/login");
```

The confirm page test must also prove a malicious `next` value is discarded rather than reflected.

- [ ] **Step 3: Run retired-route tests and verify RED**

```powershell
npm test -- src/app/auth/signup/page.test.tsx src/app/auth/forgot-password/page.test.tsx src/app/auth/update-password/page.test.tsx src/app/auth/confirm/page.test.tsx
```

Expected: FAIL because the routes still render email-dependent UI.

- [ ] **Step 4: Replace signup with a server redirect**

```tsx
import { redirect } from "next/navigation";
import { sanitizeAuthNextPath } from "@/lib/auth-redirect";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeAuthNextPath(params.next, "/onboarding");
  redirect(`/auth/login?intent=signup&next=${encodeURIComponent(nextPath)}`);
}
```

- [ ] **Step 5: Replace each retired page with a safe server redirect**

For forgot-password and update-password:

```tsx
import { redirect } from "next/navigation";

export default function RetiredEmailAuthPage() {
  redirect("/auth/login");
}
```

For confirm, accept `searchParams`, sanitize an optional `next`, and redirect to login without copying `token_hash`, `code`, `error_description`, or `type`:

```tsx
import { redirect } from "next/navigation";
import { sanitizeAuthNextPath } from "@/lib/auth-redirect";

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeAuthNextPath(params.next, "/documents");
  redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
}
```

- [ ] **Step 6: Run retired-route tests and verify GREEN**

```powershell
npm test -- src/app/auth/signup/page.test.tsx src/app/auth/forgot-password/page.test.tsx src/app/auth/update-password/page.test.tsx src/app/auth/confirm/page.test.tsx
```

Expected: all redirect tests PASS.

- [ ] **Step 7: Re-run the secure verifier route tests**

```powershell
npm test -- src/app/auth/confirm/verify/route.test.ts
```

Expected: existing prefetch, same-origin, OTP-type, and safe-error tests PASS unchanged.

- [ ] **Step 8: Commit retired public routes**

```powershell
git add frontend/src/app/auth/signup frontend/src/app/auth/forgot-password frontend/src/app/auth/update-password frontend/src/app/auth/confirm/page.tsx frontend/src/app/auth/confirm/page.test.tsx
git commit -m "refactor: retire email-dependent auth routes"
```

---

### Task 3: Make the OAuth Callback Provider-Neutral

**Files:**
- Modify: `frontend/src/lib/auth-redirect.test.ts`
- Modify: `frontend/src/lib/auth-redirect.ts`
- Modify: `frontend/src/app/auth/callback/page.tsx`

- [ ] **Step 1: Write a failing provider-neutral error test**

Replace email-link language expectations with:

```tsx
expect(
  getAuthCallbackError(
    new URL("https://nexusrag.vercel.app/auth/callback?error_description=access_denied")
  )
).toBe("Authentication could not be completed. Return to sign in and try again.");
```

Retain tests proving raw provider details, PKCE internals, fragments, and unsafe destinations are never returned.

- [ ] **Step 2: Run the auth redirect test and verify RED**

```powershell
npm test -- src/lib/auth-redirect.test.ts
```

Expected: FAIL because the current message refers to an expired sign-in link.

- [ ] **Step 3: Update the public callback error constant**

```ts
export const AUTH_LINK_ERROR_MESSAGE =
  "Authentication could not be completed. Return to sign in and try again.";
```

Keep `sanitizeAuthNextPath`, secure-origin validation, and callback URL construction unchanged.

- [ ] **Step 4: Update callback recovery controls**

Change the error action label from `Request a new sign-in link` to `Back to sign in`. Keep `href="/auth/login"`. The loading state remains `Completing sign-in` and must not identify provider tokens or codes.

- [ ] **Step 5: Run focused tests and verify GREEN**

```powershell
npm test -- src/lib/auth-redirect.test.ts
```

Expected: all redirect security tests PASS.

- [ ] **Step 6: Commit callback hardening**

```powershell
git add frontend/src/lib/auth-redirect.ts frontend/src/lib/auth-redirect.test.ts frontend/src/app/auth/callback/page.tsx
git commit -m "fix: make OAuth callback recovery provider neutral"
```

---

### Task 4: Replace Password Settings with OAuth Identity Posture

**Files:**
- Modify: `frontend/src/app/settings/security/page.test.tsx`
- Modify: `frontend/src/app/settings/security/page.tsx`
- Modify: `frontend/src/app/settings/page.tsx`

- [ ] **Step 1: Write failing identity-posture tests**

Mock `getUser`, `getUserIdentities`, and `signOut`. Use safe minimal identity objects:

```tsx
getUserIdentities.mockResolvedValue({
  data: {
    identities: [
      { id: "identity-google", provider: "google" },
      { id: "identity-github", provider: "github" },
    ],
  },
  error: null,
});

it("shows linked OAuth providers without password controls", async () => {
  render(<SecuritySettingsPage />);

  expect(await screen.findByText("Google")).toBeVisible();
  expect(screen.getByText("GitHub")).toBeVisible();
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Change password" })).not.toBeInTheDocument();
});
```

Retain the existing local/global sign-out test and assert provider subject IDs are not rendered.

- [ ] **Step 2: Run the security settings test and verify RED**

```powershell
npm test -- src/app/settings/security/page.test.tsx
```

Expected: FAIL because the page calls `updateUser` and does not load identities.

- [ ] **Step 3: Load only safe identity posture**

Use state containing provider names only:

```tsx
type OAuthProvider = "google" | "github";
const [providers, setProviders] = useState<OAuthProvider[]>([]);
```

Load account and identity data together:

```tsx
const supabase = createSupabaseBrowserClient();
void Promise.all([supabase.auth.getUser(), supabase.auth.getUserIdentities()]).then(
  ([userResult, identityResult]) => {
    if (!active) return;
    setVerified(Boolean(userResult.data.user?.email_confirmed_at));
    const linked = identityResult.data?.identities
      .map((identity) => identity.provider)
      .filter((provider): provider is OAuthProvider =>
        provider === "google" || provider === "github"
      );
    setProviders(Array.from(new Set(linked)));
  }
);
```

Do not store or render identity IDs, provider tokens, or raw metadata.

- [ ] **Step 4: Replace the password section**

Render a `Sign-in methods` section with Google and GitHub status rows. Show `Linked` for present providers and `Not linked` for absent providers. Do not add linking or unlinking controls in this slice. Keep both sign-out scopes unchanged.

Update the signed-out description to `OAuth identity and session controls require an authenticated account.`

- [ ] **Step 5: Update settings navigation copy**

Change `Password and session controls` to `OAuth identities and session controls` in `frontend/src/app/settings/page.tsx`.

- [ ] **Step 6: Run focused tests and verify GREEN**

```powershell
npm test -- src/app/settings/security/page.test.tsx
```

Expected: linked-provider and both sign-out tests PASS.

- [ ] **Step 7: Commit account-security changes**

```powershell
git add frontend/src/app/settings/security frontend/src/app/settings/page.tsx
git commit -m "feat: show OAuth identity security posture"
```

---

### Task 5: Update Route Titles and Browser Coverage

**Files:**
- Modify: `frontend/src/components/layout/Header.tsx`
- Modify: `frontend/src/e2e/public-smoke.spec.ts`

- [ ] **Step 1: Write failing Playwright expectations for the OAuth gateway**

Replace retired auth-route rendering cases with:

```ts
test("OAuth gateway renders providers in order", async ({ page }) => {
  await page.goto("/auth/login");
  await expect(page.getByRole("heading", { name: "Sign in to NexusRAG" })).toBeVisible();

  const providers = page.getByRole("main").getByRole("button");
  await expect(providers).toHaveCount(2);
  await expect(providers.nth(0)).toHaveAccessibleName("Continue with Google");
  await expect(providers.nth(1)).toHaveAccessibleName("Continue with GitHub");
});

test("signup and legacy email routes redirect to OAuth login", async ({ page }) => {
  for (const path of [
    "/auth/signup",
    "/auth/forgot-password",
    "/auth/update-password",
    "/auth/confirm?token_hash=secret&type=email",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByRole("heading", { name: "Sign in to NexusRAG" })).toBeVisible();
  }
});
```

Use `locator().nth()` only after `toHaveCount(2)` confirms the provider count.

Update callback error assertions to the provider-neutral message and `Back to sign in` action.

- [ ] **Step 2: Run public smoke tests and verify RED**

```powershell
npm run test:e2e -- src/e2e/public-smoke.spec.ts
```

Expected: OAuth gateway and legacy redirect cases FAIL against the old UI.

- [ ] **Step 3: Remove retired auth route titles**

Delete `/auth/forgot-password` and `/auth/confirm` title entries from `Header.tsx`. Keep `/auth/login`, `/auth/signup`, and `/auth/callback` mapped to provider-neutral titles.

- [ ] **Step 4: Add mobile OAuth coverage**

Within the Playwright configuration's mobile project, verify both buttons fit the viewport without horizontal scrolling:

```ts
expect(
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
).toBe(true);
```

- [ ] **Step 5: Run public smoke tests and verify GREEN**

```powershell
npm run test:e2e -- src/e2e/public-smoke.spec.ts
```

Expected: desktop and mobile public smoke tests PASS with no console errors.

- [ ] **Step 6: Commit browser coverage**

```powershell
git add frontend/src/components/layout/Header.tsx frontend/src/e2e/public-smoke.spec.ts
git commit -m "test: cover OAuth-only public authentication"
```

---

### Task 6: Update Authentication Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/DEPLOYMENT_PRODUCTION.md`

- [ ] **Step 1: Find stale email-auth guidance**

```powershell
rg -n "password|magic link|SMTP|Resend|confirmation email|forgot password|Google|GitHub" README.md docs
```

Expected: output identifies the current password/email deployment instructions.

- [ ] **Step 2: Document the OAuth-only contract**

Add this configuration table to production deployment documentation:

```markdown
| System | Value |
|---|---|
| Application origin | `https://nexusrag.vercel.app` |
| Supabase callback | `https://fcjaomiceajcdownarel.supabase.co/auth/v1/callback` |
| Google scopes | `openid email profile` |
| GitHub homepage | `https://nexusrag.vercel.app` |
| Provider secret location | Supabase Auth dashboard only |
| Public auth methods | Google, GitHub |
```

Document that SMTP is unnecessary for the OAuth-only model, email/password routes are retired, provider secrets must not enter Vercel or Render, and the email provider stays enabled temporarily only for rollback safety.

- [ ] **Step 3: Document rollback and verification**

State that provider apps must be verified before disabling Supabase email auth, automatic same-email identity linking preserves existing user IDs, and cross-email accounts must never be automatically merged.

- [ ] **Step 4: Check documentation and commit**

```powershell
git diff --check
rg -n "T[B]D|T[O]DO|client_secret\s*=|GITHUB_CLIENT_SECRET|GOOGLE_CLIENT_SECRET" README.md docs
```

Expected: no placeholders or secret values.

```powershell
git add README.md docs/SECURITY.md docs/DEPLOYMENT_PRODUCTION.md
git commit -m "docs: document OAuth-only deployment"
```

---

### Task 7: Run Local Regression and Security Gates

**Files:**
- Verify only; modify files only when a failing test identifies an OAuth regression.

- [ ] **Step 1: Run the full frontend test suite**

```powershell
Set-Location frontend
npm test
```

Expected: all Vitest suites PASS.

- [ ] **Step 2: Run frontend lint**

```powershell
npm run lint
```

Expected: exit code 0 with no ESLint errors.

- [ ] **Step 3: Run the production build**

```powershell
npm run build
```

Expected: Next.js production build completes successfully and all auth routes compile.

- [ ] **Step 4: Run public browser tests**

```powershell
npm run test:e2e -- src/e2e/public-smoke.spec.ts
```

Expected: desktop and mobile projects PASS without console or layout errors.

- [ ] **Step 5: Run backend regression tests**

From repository root:

```powershell
python -m pytest backend/tests -q
```

Expected: all backend JWT, workspace, RLS-facing repository, upload, retrieval, and chat tests PASS unchanged.

- [ ] **Step 6: Scan tracked files for leaked credentials**

```powershell
git grep -n -E "(client_secret|GITHUB_CLIENT_SECRET|GOOGLE_CLIENT_SECRET|gho_[A-Za-z0-9]|GOCSPX-)" -- . ":(exclude)package-lock.json"
```

Expected: no OAuth secret values and no hard-coded provider credentials.

- [ ] **Step 7: Run Codex Security on the authentication diff**

Review changed auth routes, redirect handling, callback exchange, provider errors, session controls, and documentation. Validate that no high-severity finding remains before deployment.

- [ ] **Step 8: Commit any verification-driven correction**

Only when a test or validated security finding required a correction:

```powershell
git add -- frontend/src/app/auth frontend/src/app/settings/security frontend/src/lib/auth-redirect.ts frontend/src/lib/auth-redirect.test.ts frontend/src/e2e/public-smoke.spec.ts
git commit -m "fix: address OAuth verification findings"
```

If no correction was needed, do not create an empty commit.

---

### Task 8: Configure Providers, Deploy, and Verify Production

**Files:**
- External configuration only; no provider secrets are written to files.

- [ ] **Step 1: Create the Google OAuth application**

In Google Cloud:

```text
Application type: Web application
Application name: NexusRAG
Authorized redirect URI: https://fcjaomiceajcdownarel.supabase.co/auth/v1/callback
Scopes: openid, email, profile
```

Publish the consent configuration for external users after verifying the values. Do not request Drive, Gmail, repository, offline, or other API scopes.

- [ ] **Step 2: Create the GitHub OAuth App**

In GitHub Developer Settings:

```text
Application name: NexusRAG
Homepage URL: https://nexusrag.vercel.app
Authorization callback URL: https://fcjaomiceajcdownarel.supabase.co/auth/v1/callback
```

- [ ] **Step 3: Enable providers in Supabase**

Enter each provider's client ID and secret directly into Supabase Auth provider settings. Confirm:

```text
Site URL: https://nexusrag.vercel.app
Allowed redirect URL: https://nexusrag.vercel.app/auth/callback
Allowed local redirect URL: http://localhost:3000/auth/callback
```

Do not copy provider secrets into Vercel, Render, repository files, chat, logs, screenshots, or test fixtures.

- [ ] **Step 4: Keep email auth available only for rollback**

Do not expose email auth in the frontend. Leave the Supabase email provider unchanged until both OAuth flows pass production verification and existing-user access is confirmed.

- [ ] **Step 5: Push the verified commits**

```powershell
git status --short
git push origin main
```

Expected: clean working tree and push succeeds.

- [ ] **Step 6: Verify Vercel production deployment**

Confirm the deployment for the pushed commit reaches `READY`, `https://nexusrag.vercel.app/auth/login` renders Google then GitHub, and no frontend runtime errors appear.

- [ ] **Step 7: Exercise Google production authentication**

Start at:

```text
https://nexusrag.vercel.app/auth/login?intent=signup&next=%2Fonboarding
```

Complete provider-controlled login or consent with the account owner when required. Verify callback, Supabase session, onboarding, workspace creation, protected navigation, reload persistence, and sign-out.

- [ ] **Step 8: Exercise GitHub production authentication**

Repeat the same workflow with GitHub. Verify provider errors remain generic and GitHub appears second in the UI.

- [ ] **Step 9: Verify existing-user linking**

Use an OAuth identity whose verified email matches a controlled existing NexusRAG user. Confirm the Supabase user ID and workspace memberships remain unchanged. Do not test cross-email automatic merging.

- [ ] **Step 10: Verify Render authorization boundaries**

Through the authenticated frontend, verify document listing or another protected API reaches Render successfully. Then verify signed-out access receives `401` and a controlled user cannot access another workspace's resources.

- [ ] **Step 11: Verify production logs without secrets**

Inspect Vercel and Render logs for callback failures, redirect loops, `401` regressions, or provider payload leakage. Do not copy tokens or full authorization URLs into reports.

- [ ] **Step 12: Finalize the email-provider decision**

After both OAuth providers and existing-user access pass, disable public email/password and email-link methods in Supabase if the rollback window is complete. Otherwise keep them enabled but unreachable from the NexusRAG frontend until the agreed rollback window ends.

---

## Final Acceptance Checklist

- [ ] Google is the first public authentication method.
- [ ] GitHub is the second public authentication method.
- [ ] No email sender, SMTP service, paid domain, password, or magic-link flow is required.
- [ ] Signup intent reaches onboarding after first OAuth authentication.
- [ ] Returning users reach sanitized internal destinations.
- [ ] Existing same-email identities retain Supabase user and workspace references.
- [ ] Account security exposes safe identity posture and session controls only.
- [ ] JWT, RLS, RBAC, workspace, Render, and Supabase boundaries remain intact.
- [ ] Frontend tests, lint, build, Playwright, backend tests, and security review pass.
- [ ] Production Google and GitHub flows are executed rather than assumed.
- [ ] No OAuth secrets or user tokens are committed, logged, or exposed to the browser bundle.
