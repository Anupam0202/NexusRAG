"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { createWorkspace, listWorkspaces } from "@/lib/api";
import { useStore } from "@/hooks/useStore";
import type { WorkspaceSummary } from "@/types";

export default function WorkspacesPage() {
  const router = useRouter();
  const authMode = useStore((state) => state.authMode);
  const workspaceId = useStore((state) => state.workspaceId);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listWorkspaces();
      setWorkspaces(response.workspaces);
      if (!workspaceId && response.workspaces[0]) {
        setWorkspaceId(response.workspaces[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load workspaces");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authMode === "loading") return;
    if (authMode === "signed_out") {
      router.replace("/auth/login?next=/workspaces");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authMode]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authMode !== "authenticated") return;
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const workspace = await createWorkspace({ name: name.trim() });
      setWorkspaces((current) => [...current, workspace]);
      setWorkspaceId(workspace.id);
      setName("");
      toast.success("Workspace created");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to create workspace");
    } finally {
      setCreating(false);
    }
  };

  if (authMode === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
        <Loader2 size={18} className="mr-2 animate-spin" />
        Checking session
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
              <Building2 size={20} />
            </span>
            <div>
              <h2 className="text-lg font-bold">Workspaces</h2>
              <p className="text-sm text-[var(--text-muted)]">Tenant isolation for documents, chats, and keys</p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {authMode === "demo" && (
          <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Workspace creation requires Supabase sign-in and backend Supabase secrets.
          </div>
        )}

        {authMode === "authenticated" && (
          <form
            onSubmit={create}
            className="mb-5 flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 sm:flex-row"
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New workspace name"
              minLength={2}
              maxLength={80}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={creating || name.trim().length < 2}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              Create
            </button>
          </form>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--text-muted)]">
            <Loader2 size={18} className="mr-2 animate-spin" />
            Loading workspaces
          </div>
        ) : workspaces.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            No workspaces yet
          </div>
        ) : (
          <div className="space-y-2">
            {workspaces.map((workspace) => {
              const selected = workspace.id === workspaceId;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => {
                    setWorkspaceId(workspace.id);
                    toast.success(`Workspace switched to ${workspace.name}`);
                    router.refresh();
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-left transition hover:bg-[var(--bg-hover)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{workspace.name}</span>
                    <span className="block truncate text-xs text-[var(--text-muted)]">
                      {workspace.slug} - {workspace.role} - {workspace.plan}
                    </span>
                  </span>
                  {selected && (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                      <Check size={15} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
