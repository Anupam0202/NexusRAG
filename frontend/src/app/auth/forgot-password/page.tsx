"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { buildAuthRecoveryUrl } from "@/lib/auth-redirect";
import { publicAuthErrorMessage } from "@/lib/password-policy";
import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";

const SAFE_SUCCESS_MESSAGE =
  "If an account exists for that email, a password-reset link has been sent.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const supabaseReady = hasPublicSupabaseConfig();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !supabaseReady) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = buildAuthRecoveryUrl(
        window.location.origin,
        process.env.NEXT_PUBLIC_SITE_URL
      );
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
      if (error) throw error;
      setSubmitted(true);
    } catch (error: unknown) {
      const message = publicAuthErrorMessage("email-delivery", error);
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
            <KeyRound size={22} />
          </span>
          <div>
            <h2 className="text-xl font-bold">Reset your password</h2>
            <p className="text-sm text-[var(--text-muted)]">Request a secure recovery link</p>
          </div>
        </div>

        {!supabaseReady ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Supabase browser variables are missing from this frontend deployment.
          </div>
        ) : submitted ? (
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <p className="text-sm font-semibold">Check your inbox</p>
            <p className="text-sm leading-6 text-[var(--text-muted)]">{SAFE_SUCCESS_MESSAGE}</p>
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="text-sm font-semibold text-brand-600 hover:text-brand-500"
            >
              Request another link
            </button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5"
          >
            <label className="block" htmlFor="recovery-email">
              <span className="text-xs font-semibold text-[var(--text-muted)]">Email</span>
              <input
                id="recovery-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="mt-1.5 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm outline-none transition focus:border-brand-500"
              />
            </label>
            {formError ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {formError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
              {submitting ? "Sending" : "Send reset link"}
            </button>
          </form>
        )}

        <Link
          href="/auth/login"
          className="mt-5 text-sm font-semibold text-brand-600 hover:text-brand-500"
        >
          Return to sign in
        </Link>
      </main>
    </div>
  );
}
