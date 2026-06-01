"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { getCurrentWorkspace } from "@/lib/api";
import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";
import { useStore } from "@/hooks/useStore";

function cleanNextPath(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/documents";
  return value;
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const setAuthState = useStore((state) => state.setAuthState);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const complete = async () => {
      if (!hasPublicSupabaseConfig()) {
        setError("Supabase browser variables are missing from this frontend deployment.");
        return;
      }

      const url = new URL(window.location.href);
      const nextPath = cleanNextPath(url.searchParams.get("next"));
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

        try {
          const workspace = await getCurrentWorkspace();
          setWorkspaceId(workspace.workspace_id);
          router.replace(nextPath);
        } catch {
          router.replace("/onboarding");
        }
      } catch (err: unknown) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to complete sign-in");
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
