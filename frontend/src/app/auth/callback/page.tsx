"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { getCurrentWorkspace } from "@/lib/api";
import {
  getAuthCallbackError,
  getSafeAuthErrorMessage,
  isWorkspaceIndependentAuthDestination,
  sanitizeAuthNextPath,
} from "@/lib/auth-redirect";
import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";
import { useStore } from "@/hooks/useStore";

export default function AuthCallbackPage() {
  const router = useRouter();
  const setAuthState = useStore((state) => state.setAuthState);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const complete = async () => {
      const url = new URL(window.location.href);
      const callbackError = getAuthCallbackError(url);
      if (callbackError) {
        setError(callbackError);
        return;
      }

      if (!hasPublicSupabaseConfig()) {
        setError("Supabase browser variables are missing from this frontend deployment.");
        return;
      }

      const nextPath = sanitizeAuthNextPath(url.searchParams.get("next"), "/documents");
      const code = url.searchParams.get("code");

      try {
        const supabase = createSupabaseBrowserClient();
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const user = data.session?.user;

        if (!user) {
          router.replace(`/auth/login?next=${encodeURIComponent(nextPath)}`);
          return;
        }

        setAuthState("authenticated", {
          id: user.id,
          email: user.email ?? null,
        });

        if (isWorkspaceIndependentAuthDestination(nextPath)) {
          router.replace(nextPath);
          return;
        }

        try {
          const workspace = await getCurrentWorkspace();
          setWorkspaceId(workspace.workspace_id);
          router.replace(nextPath);
        } catch {
          router.replace("/onboarding");
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
  }, [router, setAuthState, setWorkspaceId]);

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
              Request a new sign-in link
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
