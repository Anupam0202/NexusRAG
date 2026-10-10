"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Building2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createWorkspace, getCurrentWorkspace } from "@/lib/api";
import { createSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabase/client";
import { useStore } from "@/hooks/useStore";
import { navigateStatic } from "@/lib/static-navigation";
import { boundedDiscoveryRead } from "@/lib/workspace-discovery";

export default function OnboardingPage() {
  const identity = useStore(state => JSON.stringify([state.authMode, state.authUser?.id]));
  return <AccountOnboarding key={identity} />;
}
function AccountOnboarding() {
  const userId = useStore(state => state.authUser?.id);
  const authMode = useStore(state => state.authMode);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const setAuthState = useStore((state) => state.setAuthState);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);
  const [name, setName] = useState("My Workspace");
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [allowCreate, setAllowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const boot = async () => {
      if (!hasPublicSupabaseConfig()) {
        setError("Supabase browser variables are missing from this frontend deployment.");
        setLoading(false);
        return;
      }

      try {
        const supabase = createSupabaseBrowserClient();
        const { data } = await boundedDiscoveryRead(() => supabase.auth.getSession());
        if (!active) return;
        const user = data.session?.user;
        if (!user) {
          navigateStatic("/auth/login?next=%2Fonboarding");
          return;
        }

        setAuthState("authenticated", {
          id: user.id,
          email: user.email ?? null,
        });

        try {
          const workspace = await boundedDiscoveryRead(() => getCurrentWorkspace({ workspaceId: null, expectedUserId: user.id }));
          if (!active) return;
          setWorkspaceId(workspace.workspace_id);
          navigateStatic("/documents");
        } catch (error: unknown) {
          if (!active) return;
          if (error && typeof error === "object" && "code" in error && error.code === "WORKSPACE_NOT_FOUND") {
            setAllowCreate(true);
          } else {
            setError("Workspace discovery could not be completed. Refresh or sign in again before creating a workspace.");
          }
          setLoading(false);
        }
      } catch {
        if (!active) return;
        setError("Unable to verify your session. Sign in and retry.");
        setLoading(false);
      }
    };

    void boot();

    return () => {
      active = false;
    };
  }, [setAuthState, setWorkspaceId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!allowCreate || authMode !== "authenticated" || !userId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const workspace = await createWorkspace({
        name: name.trim(),
        slug: slug.trim() || null,
      }, { workspaceId: null, expectedUserId: userId });
      if (!alive.current) return;
      setWorkspaceId(workspace.id);
      toast.success("Workspace created");
      navigateStatic("/documents");
    } catch (err: unknown) {
      if (!alive.current) return;
      setError(err instanceof Error ? err.message : "Unable to create workspace");
    } finally {
      if (alive.current) setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
        <Loader2 size={18} className="mr-2 animate-spin" />
        Checking workspace
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-center px-4 py-10">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
            <Building2 size={22} />
          </span>
          <div>
            <h2 className="text-xl font-bold">Create your workspace</h2>
            <p className="text-sm text-[var(--text-muted)]">Tenant-isolated documents and chat history</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5"
        >
          <label className="block">
            <span className="text-xs font-semibold text-[var(--text-muted)]">Workspace name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={2}
              maxLength={80}
              required
              className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm outline-none transition focus:border-brand-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[var(--text-muted)]">Slug</span>
            <input
              type="text"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="auto-generated"
              minLength={3}
              maxLength={63}
              pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]"
              className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm outline-none transition focus:border-brand-500"
            />
          </label>
          <button
            type="submit"
            disabled={!allowCreate || authMode !== "authenticated" || !userId || creating || name.trim().length < 2}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {creating ? "Creating" : "Create workspace"}
          </button>
        </form>
      </main>
    </div>
  );
}
