"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldPlus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PasswordField } from "@/components/auth/PasswordField";
import { PasswordRequirements } from "@/components/auth/PasswordRequirements";
import { useStore } from "@/hooks/useStore";
import { buildAuthCallbackUrl, sanitizeAuthNextPath } from "@/lib/auth-redirect";
import { genericAuthError, passwordValidationError } from "@/lib/password-policy";
import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const authMode = useStore((state) => state.authMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nextPath, setNextPath] = useState("/onboarding");
  const supabaseReady = hasPublicSupabaseConfig();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(sanitizeAuthNextPath(params.get("next"), "/onboarding"));
  }, []);

  useEffect(() => {
    if (authMode === "authenticated") router.replace(nextPath);
  }, [authMode, nextPath, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const validationError = passwordValidationError(password, confirmation);
    setFormError(validationError);
    if (!normalizedEmail || validationError || !supabaseReady) return;

    setSubmitting(true);
    try {
      const redirectTo = buildAuthCallbackUrl(
        window.location.origin,
        nextPath,
        process.env.NEXT_PUBLIC_SITE_URL
      );
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setSentTo(normalizedEmail);
      toast.success("Verification email sent");
    } catch {
      const message = genericAuthError("signup");
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
            <ShieldPlus size={22} />
          </span>
          <div>
            <h2 className="text-xl font-bold">Create a NexusRAG account</h2>
            <p className="text-sm text-[var(--text-muted)]">Verified email and secure password</p>
          </div>
        </div>

        {!supabaseReady ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Supabase browser variables are missing from this frontend deployment.
          </div>
        ) : sentTo ? (
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <p className="text-sm font-semibold">Verify your email</p>
            <p className="text-sm leading-6 text-[var(--text-muted)]">
              We sent a confirmation link to {sentTo}. Your account becomes active after you
              confirm the address.
            </p>
            <button
              type="button"
              onClick={() => setSentTo(null)}
              className="text-sm font-semibold text-brand-600 hover:text-brand-500"
            >
              Use another email
            </button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5"
          >
            <label className="block" htmlFor="signup-email">
              <span className="text-xs font-semibold text-[var(--text-muted)]">Email</span>
              <input
                id="signup-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="mt-1.5 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm outline-none transition focus:border-brand-500"
              />
            </label>
            <PasswordField
              id="signup-password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              disabled={submitting}
            />
            <PasswordField
              id="signup-password-confirmation"
              label="Confirm password"
              value={confirmation}
              onChange={setConfirmation}
              autoComplete="new-password"
              disabled={submitting}
            />
            <PasswordRequirements password={password} />
            {formError ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {formError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting || !email.trim() || !password || !confirmation}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
              {submitting ? "Creating account" : "Create account"}
            </button>
          </form>
        )}

        <Link
          href="/auth/login"
          className="mt-5 text-sm font-semibold text-brand-600 hover:text-brand-500"
        >
          Already have an account? Sign in
        </Link>
      </main>
    </div>
  );
}
