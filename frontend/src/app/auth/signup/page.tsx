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
import { passwordValidationError, publicAuthErrorMessage } from "@/lib/password-policy";
import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const authMode = useStore((state) => state.authMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
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

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown(resendCooldown - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const verificationRedirectTo = () =>
    buildAuthCallbackUrl(window.location.origin, nextPath, process.env.NEXT_PUBLIC_SITE_URL);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const validationError = passwordValidationError(password, confirmation);
    setFormError(validationError);
    if (!normalizedEmail || validationError || !supabaseReady) return;

    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { emailRedirectTo: verificationRedirectTo() },
      });
      if (error) throw error;
      setFormError(null);
      setResendMessage(null);
      setSentTo(normalizedEmail);
      toast.success("Verification requested");
    } catch (error: unknown) {
      const message = publicAuthErrorMessage("signup", error);
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const resendConfirmation = async () => {
    if (!sentTo || resending || resendCooldown > 0) return;

    setFormError(null);
    setResendMessage(null);
    setResending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: sentTo,
        options: { emailRedirectTo: verificationRedirectTo() },
      });
      if (error) throw error;
      const message =
        "If the account is awaiting verification, a new confirmation link has been requested.";
      setResendMessage(message);
      toast.success("Verification requested");
    } catch (error: unknown) {
      const message = publicAuthErrorMessage("email-delivery", error);
      setFormError(message);
      toast.error(message);
    } finally {
      setResendCooldown(60);
      setResending(false);
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
              If this address can be registered, a confirmation link has been requested for{" "}
              {sentTo}. Check your inbox and spam folder. Your account becomes active only after
              confirmation.
            </p>
            <p className="text-sm leading-6 text-[var(--text-muted)]">
              Already registered or still missing the message? Sign in or reset your password
              without creating another account.
            </p>
            {resendMessage ? (
              <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
                {resendMessage}
              </p>
            ) : null}
            {formError ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {formError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={resendConfirmation}
              disabled={resending || resendCooldown > 0}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 text-sm font-semibold transition hover:bg-[var(--bg-secondary)] disabled:opacity-50"
            >
              {resending ? <Loader2 size={16} className="animate-spin" /> : null}
              {resending
                ? "Requesting confirmation"
                : resendCooldown > 0
                  ? `Resend available in ${resendCooldown}s`
                  : "Resend confirmation email"}
            </button>
            <div className="flex flex-wrap gap-3 text-sm font-semibold">
              <Link href="/auth/login" className="text-brand-600 hover:text-brand-500">
                Sign in
              </Link>
              <Link href="/auth/forgot-password" className="text-brand-600 hover:text-brand-500">
                Reset password
              </Link>
            </div>
            <button
              type="button"
              onClick={() => {
                setSentTo(null);
                setFormError(null);
                setResendMessage(null);
                setResendCooldown(0);
              }}
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
