"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PasswordField } from "@/components/auth/PasswordField";
import { useStore } from "@/hooks/useStore";
import { buildAuthCallbackUrl, sanitizeAuthNextPath } from "@/lib/auth-redirect";
import { publicAuthErrorMessage } from "@/lib/password-policy";
import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";

type SignInMode = "password" | "magic-link";

export default function LoginPage() {
  const router = useRouter();
  const authMode = useStore((state) => state.authMode);
  const [mode, setMode] = useState<SignInMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nextPath, setNextPath] = useState("/documents");
  const supabaseReady = hasPublicSupabaseConfig();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(sanitizeAuthNextPath(params.get("next"), "/documents"));
  }, []);

  useEffect(() => {
    if (authMode === "authenticated") router.replace(nextPath);
  }, [authMode, nextPath, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !supabaseReady || (mode === "password" && !password)) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
        toast.success("Signed in");
        router.replace(nextPath);
      } else {
        const redirectTo = buildAuthCallbackUrl(
          window.location.origin,
          nextPath,
          process.env.NEXT_PUBLIC_SITE_URL
        );
        const { error } = await supabase.auth.signInWithOtp({
          email: normalizedEmail,
          options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
        });
        if (error) throw error;
        setSentTo(normalizedEmail);
        toast.success("Magic link sent");
      }
    } catch (error: unknown) {
      const message = publicAuthErrorMessage(
        mode === "password" ? "sign-in" : "email-delivery",
        error
      );
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
            <ShieldCheck size={22} />
          </span>
          <div>
            <h2 className="text-xl font-bold">Sign in to NexusRAG</h2>
            <p className="text-sm text-[var(--text-muted)]">Secure workspace access</p>
          </div>
        </div>

        {!supabaseReady ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Supabase browser variables are missing from this frontend deployment.
          </div>
        ) : sentTo ? (
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <p className="text-sm font-semibold">Check your inbox</p>
            <p className="text-sm leading-6 text-[var(--text-muted)]">
              A secure sign-in link was sent to {sentTo}. Open it in any browser or device.
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
            <div
              role="group"
              aria-label="Sign-in method"
              className="grid grid-cols-2 rounded-xl bg-[var(--bg-secondary)] p-1"
            >
              <button
                type="button"
                onClick={() => {
                  setMode("password");
                  setFormError(null);
                }}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${mode === "password" ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)]"}`}
              >
                Password
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("magic-link");
                  setFormError(null);
                }}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${mode === "magic-link" ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)]"}`}
              >
                Magic link
              </button>
            </div>

            <label className="block" htmlFor="login-email">
              <span className="text-xs font-semibold text-[var(--text-muted)]">Email</span>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="mt-1.5 h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm outline-none transition focus:border-brand-500"
              />
            </label>

            {mode === "password" ? (
              <>
                <PasswordField
                  id="login-password"
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                  disabled={submitting}
                />
                <div className="text-right">
                  <Link
                    href="/auth/forgot-password"
                    className="text-xs font-semibold text-brand-600 hover:text-brand-500"
                  >
                    Forgot password?
                  </Link>
                </div>
              </>
            ) : null}

            {formError ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {formError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting || !email.trim() || (mode === "password" && !password)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : mode === "password" ? (
                <KeyRound size={16} />
              ) : (
                <Mail size={16} />
              )}
              {submitting ? "Working" : mode === "password" ? "Sign in" : "Send magic link"}
            </button>
          </form>
        )}

        <Link
          href={`/auth/signup?next=${encodeURIComponent(nextPath)}`}
          className="mt-5 text-sm font-semibold text-brand-600 hover:text-brand-500"
        >
          Create a new workspace account
        </Link>
      </main>
    </div>
  );
}
