"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Github, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { GoogleMark } from "@/components/auth/GoogleMark";
import { useStore } from "@/hooks/useStore";
import { buildAuthCallbackUrl, sanitizeAuthNextPath } from "@/lib/auth-redirect";
import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";

type OAuthProvider = "google" | "github";

const OAUTH_START_ERROR = "We could not start secure sign-in. Please try again.";

export default function LoginPage() {
  const router = useRouter();
  const authMode = useStore((state) => state.authMode);
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState("/documents");
  const [signupIntent, setSignupIntent] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const supabaseReady = hasPublicSupabaseConfig();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const signup = params.get("intent") === "signup";
    setSignupIntent(signup);
    setNextPath(
      sanitizeAuthNextPath(params.get("next"), signup ? "/onboarding" : "/documents")
    );
    setRouteReady(true);
  }, []);

  useEffect(() => {
    if (routeReady && authMode === "authenticated") router.replace(nextPath);
  }, [authMode, nextPath, routeReady, router]);

  const startOAuth = async (provider: OAuthProvider) => {
    if (!routeReady || !supabaseReady || pendingProvider) return;

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
      setFormError(OAUTH_START_ERROR);
      setPendingProvider(null);
      toast.error(OAUTH_START_ERROR);
    }
  };

  const disabled = !routeReady || !supabaseReady || pendingProvider !== null;

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
            <ShieldCheck size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold">
              {signupIntent ? "Create your NexusRAG account" : "Sign in to NexusRAG"}
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              Secure access with a trusted identity provider
            </p>
          </div>
        </div>

        {!supabaseReady ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Supabase browser variables are missing from this frontend deployment.
          </div>
        ) : (
          <section
            aria-label="Authentication providers"
            className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5"
          >
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void startOAuth("google")}
                disabled={disabled}
                className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 text-sm font-semibold transition hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingProvider === "google" ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <GoogleMark />
                )}
                {pendingProvider === "google"
                  ? "Connecting with Google"
                  : "Continue with Google"}
              </button>

              <button
                type="button"
                onClick={() => void startOAuth("github")}
                disabled={disabled}
                className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 text-sm font-semibold transition hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingProvider === "github" ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Github size={19} aria-hidden="true" />
                )}
                {pendingProvider === "github"
                  ? "Connecting with GitHub"
                  : "Continue with GitHub"}
              </button>
            </div>

            {formError ? (
              <p
                role="alert"
                aria-live="polite"
                className="text-sm text-red-600 dark:text-red-400"
              >
                {formError}
              </p>
            ) : null}

            <p className="text-xs leading-5 text-[var(--text-muted)]">
              {signupIntent
                ? "Your verified provider identity creates your account without a password or confirmation email."
                : "NexusRAG uses your verified provider identity and never receives your provider password."}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
