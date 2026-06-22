"use client";

import { useEffect, useState } from "react";
import { Github, Loader2, LogOut, ShieldCheck, ShieldEllipsis } from "lucide-react";
import { toast } from "sonner";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { GoogleMark } from "@/components/auth/GoogleMark";
import { useStore } from "@/hooks/useStore";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type OAuthProvider = "google" | "github";
type SignOutScope = "local" | "global";

const SUPPORTED_PROVIDERS: OAuthProvider[] = ["google", "github"];

export default function SecuritySettingsPage() {
  const authMode = useStore((state) => state.authMode);
  const authUser = useStore((state) => state.authUser);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [identityError, setIdentityError] = useState(false);
  const [signingOut, setSigningOut] = useState<SignOutScope | null>(null);

  useEffect(() => {
    if (authMode !== "authenticated") return;

    let active = true;
    const supabase = createSupabaseBrowserClient();

    void Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getUserIdentities(),
    ])
      .then(([userResult, identityResult]) => {
        if (!active) return;
        if (userResult.error || identityResult.error) {
          throw new Error("Identity lookup failed");
        }

        const linked = new Set(
          (identityResult.data?.identities ?? []).map(
            (identity) => identity.provider
          )
        );
        setProviders(
          SUPPORTED_PROVIDERS.filter((provider) => linked.has(provider))
        );
        setVerified(Boolean(userResult.data.user?.email_confirmed_at));
        setIdentityError(false);
      })
      .catch(() => {
        if (!active) return;
        setVerified(null);
        setProviders([]);
        setIdentityError(true);
      });

    return () => {
      active = false;
    };
  }, [authMode]);

  const signOut = async (scope: SignOutScope) => {
    setSigningOut(scope);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut({ scope });
      if (error) throw error;
      setWorkspaceId(null);
      toast.success(
        scope === "local"
          ? "Current session signed out"
          : "All sessions signed out"
      );
    } catch {
      toast.error(
        "We could not sign out the requested sessions. Please try again."
      );
    } finally {
      setSigningOut(null);
    }
  };

  if (authMode !== "authenticated") {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-8">
          <AuthRequiredState
            authMode={authMode}
            nextPath="/settings/security"
            title="Sign in to manage account security"
            description="Identity and session controls require an authenticated account."
          />
        </div>
      </div>
    );
  }

  const identityStatus = identityError
    ? "Identity status unavailable"
    : verified === null
      ? "Checking identity"
      : verified
        ? "Identity verified"
        : "Verification unavailable";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 md:px-6 md:py-8">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-brand-500" />
          <h2 className="text-lg font-bold">Account Security</h2>
        </div>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Signed-in account</h3>
              <p className="mt-1 truncate text-sm text-[var(--text-muted)]">
                {authUser?.email ?? "Email unavailable"}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                verified
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              }`}
            >
              {identityStatus}
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck size={17} className="text-brand-500" />
            <h3 className="text-sm font-semibold">Connected identities</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            <ProviderRow
              provider="google"
              connected={providers.includes("google")}
            />
            <ProviderRow
              provider="github"
              connected={providers.includes("github")}
            />
          </div>
          {!identityError && providers.length === 1 ? (
            <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
              One provider is connected. Keep access to that provider account to
              retain NexusRAG access.
            </p>
          ) : null}
          {identityError ? (
            <p role="status" className="mt-4 text-sm text-amber-700 dark:text-amber-300">
              Connected providers could not be loaded. Refresh this page to try
              again.
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldEllipsis size={17} className="text-brand-500" />
            <h3 className="text-sm font-semibold">Sessions</h3>
          </div>
          <p className="mb-4 text-sm leading-6 text-[var(--text-muted)]">
            Current-session sign out leaves your other devices active. All-session
            sign out revokes refresh sessions everywhere; existing access tokens
            expire according to Supabase policy.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void signOut("local")}
              disabled={signingOut !== null}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold transition hover:bg-[var(--bg-hover)] disabled:opacity-50"
            >
              {signingOut === "local" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <LogOut size={15} />
              )}
              Sign out current session
            </button>
            <button
              type="button"
              onClick={() => void signOut("global")}
              disabled={signingOut !== null}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
            >
              {signingOut === "global" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <LogOut size={15} />
              )}
              Sign out all sessions
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function ProviderRow({
  provider,
  connected,
}: {
  provider: OAuthProvider;
  connected: boolean;
}) {
  const label = provider === "google" ? "Google" : "GitHub";

  return (
    <div className="flex min-h-14 items-center justify-between gap-4 py-3">
      <span className="flex min-w-0 items-center gap-3">
        {provider === "google" ? (
          <GoogleMark />
        ) : (
          <Github size={20} aria-hidden="true" className="shrink-0" />
        )}
        <span className="truncate text-sm font-medium">{label}</span>
      </span>
      <span
        className={`shrink-0 text-xs font-semibold ${
          connected
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-[var(--text-muted)]"
        }`}
      >
        {connected ? "Connected" : "Not connected"}
      </span>
    </div>
  );
}
