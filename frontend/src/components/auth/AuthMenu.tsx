"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/hooks/useStore";
import {
  createSupabaseBrowserClient,
  hasPublicSupabaseConfig,
} from "@/lib/supabase/client";

export function AuthMenu() {
  const authMode = useStore((state) => state.authMode);
  const authUser = useStore((state) => state.authUser);
  const workspaceId = useStore((state) => state.workspaceId);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);
  const [open, setOpen] = useState(false);

  const canUseSupabase = hasPublicSupabaseConfig();
  const label =
    authMode === "authenticated"
      ? authUser?.email ?? "Signed in"
      : authMode === "signed_out"
        ? "Sign in"
        : authMode === "loading"
          ? "Checking"
          : "Demo mode";

  const signOut = async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      setWorkspaceId(null);
      setOpen(false);
      toast.success("Signed out");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unable to sign out");
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 max-w-[150px] items-center gap-1.5 rounded-xl border border-[var(--border)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        title={workspaceId ? `Workspace ${workspaceId}` : label}
      >
        {authMode === "authenticated" ? <ShieldCheck size={14} /> : <UserRound size={14} />}
        <span className="hidden truncate sm:inline">{label}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 text-sm shadow-xl">
          {authMode === "authenticated" ? (
            <div className="space-y-3">
              <div>
                <p className="font-semibold truncate">{authUser?.email ?? "Signed in"}</p>
                <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                  {workspaceId ?? "No workspace selected"}
                </p>
              </div>
              <Link
                href="/settings/security"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--bg-hover)]"
              >
                <ShieldCheck size={14} />
                Account security
              </Link>
              <Link
                href="/workspaces"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--bg-hover)]"
              >
                <Building2 size={14} />
                Workspaces
              </Link>
              <button
                type="button"
                onClick={signOut}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--bg-hover)]"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          ) : canUseSupabase ? (
            <div className="space-y-2">
              <Link
                href="/auth/login"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-500"
              >
                <ShieldCheck size={14} />
                Sign in securely
              </Link>
              <Link
                href="/auth/signup"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--bg-hover)]"
              >
                Create account
              </Link>
            </div>
          ) : (
            <p className="text-xs leading-5 text-[var(--text-muted)]">
              Supabase is not configured for this deployment.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
