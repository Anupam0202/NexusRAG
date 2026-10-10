"use client";

import { useEffect, useState } from "react";
import Link from "@/components/layout/StaticLink";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { getCurrentWorkspace } from "@/lib/api";
import {
  getAuthCallbackError,
  getSafeAuthErrorMessage,
  sanitizeAuthNextPath,
} from "@/lib/auth-redirect";
import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";
import { navigateStatic } from "@/lib/static-navigation";
import { useStore } from "@/hooks/useStore";

type SupabaseBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

const SESSION_RETRY_DELAYS_MS = [0, 200, 600, 1200];

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function getSessionWithRetry(supabase: SupabaseBrowserClient) {
  let lastResult = await supabase.auth.getSession();
  if (lastResult.data.session || lastResult.error) return lastResult;

  for (const delay of SESSION_RETRY_DELAYS_MS.slice(1)) {
    await wait(delay);
    lastResult = await supabase.auth.getSession();
    if (lastResult.data.session || lastResult.error) return lastResult;
  }

  return lastResult;
}

async function completeOAuthSession(supabase: SupabaseBrowserClient, code: string | null) {
  if (!code) return getSessionWithRetry(supabase);

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  const sessionResult = await getSessionWithRetry(supabase);
  if (exchangeError && !sessionResult.data.session) throw exchangeError;

  return sessionResult;
}

export default function AuthCallbackPage() {
  const identity = useStore(state => JSON.stringify([state.authMode, state.authUser?.id]));
  // Retain only the provider-neutral failure across AuthProvider hydration.
  // The URL is scrubbed below, so a keyed remount cannot reread that failure.
  // Never retain raw provider details or the PKCE code in this shared state.
  const [callbackError] = useState(() => typeof window === "undefined"
    ? null : getAuthCallbackError(new URL(window.location.href)));
  return <AccountAuthCallback key={identity} initialCallbackError={callbackError} />;
}
function AccountAuthCallback({ initialCallbackError }: { initialCallbackError: string | null }) {
  const setAuthState = useStore((state) => state.setAuthState);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const complete = async () => {
      const url = new URL(window.location.href);
      const callbackError = initialCallbackError ?? getAuthCallbackError(url);
      const nextPath = sanitizeAuthNextPath(url.searchParams.get("next"), "/documents");
      const code = url.searchParams.get("code");
      // Capture PKCE code locally, then remove OAuth parameters/provider errors
      // from browser history before asynchronous session/discovery work.
      window.history.replaceState(window.history.state, "", `${url.pathname}?next=${encodeURIComponent(nextPath)}`);
      if (callbackError) {
        setError(callbackError);
        return;
      }

      if (!hasPublicSupabaseConfig()) {
        setError("Supabase browser variables are missing from this frontend deployment.");
        return;
      }

      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error: sessionError } = await completeOAuthSession(supabase, code);
        if (!active) return;
        if (sessionError) throw sessionError;
        const user = data.session?.user;

        if (!user) {
          navigateStatic(`/auth/login?next=${encodeURIComponent(nextPath)}`);
          return;
        }

        setAuthState("authenticated", {
          id: user.id,
          email: user.email ?? null,
        });

        try {
          const workspace = await getCurrentWorkspace({ workspaceId: null, expectedUserId: user.id });
          if (!active) return;
          setWorkspaceId(workspace.workspace_id);
          navigateStatic(nextPath);
        } catch (error: unknown) {
          if (!active) return;
          if (error && typeof error === "object" && "code" in error && error.code === "WORKSPACE_NOT_FOUND") navigateStatic("/onboarding");
          else setError("Your session was established, but workspace discovery is unavailable. Return to sign in and retry; no new workspace was created.");
        }
      } catch {
        if (!active) return;
        setError(getSafeAuthErrorMessage());
      }
    };

    void complete();

    return () => {
      active = false;
    };
  }, [setAuthState, setWorkspaceId, initialCallbackError]);

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 text-center">
        {error ? (
          <>
            <ShieldAlert size={28} className="mx-auto mb-3 text-red-500" />
            <p className="text-sm font-semibold">Sign-in could not be completed</p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{error}</p>
            <Link
              href="/auth/login"
              className="mt-4 inline-flex rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <ShieldCheck size={28} className="mx-auto mb-3 text-brand-500" />
            <p className="text-sm font-semibold">Completing sign-in</p>
            <Loader2 size={18} className="mx-auto mt-3 animate-spin text-[var(--text-muted)]" />
          </>
        )}
      </div>
    </div>
  );
}
