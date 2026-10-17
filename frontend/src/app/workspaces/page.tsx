"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Building2, Check, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { createWorkspace, listWorkspaces } from "@/lib/api";
import { useStore } from "@/hooks/useStore";
import { navigateStatic, reloadStatic } from "@/lib/static-navigation";
import type { WorkspaceSummary } from "@/types";
import { InvitationAcceptance } from "@/components/workspaces/Invitations";

export default function WorkspacesPage() {
  const identity = useStore(state => JSON.stringify([state.authMode, state.authUser?.id]));
  return <AccountWorkspaces key={identity} />;
}
function AccountWorkspaces() {
  const userId = useStore(state => state.authUser?.id);
  const authMode = useStore((state) => state.authMode);
  const workspaceId = useStore((state) => state.workspaceId);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const alive = useRef(true);
  const sequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current += 1; }; }, []);
  const context = { workspaceId: null, expectedUserId: authMode === "authenticated" ? userId ?? null : undefined };
  const load = async (after?: string) => {
    const current = ++sequence.current;
    if (after) setLoadingMore(true);
    else { setLoading(true); setLoadingMore(false); setNextAfter(null); }
    setError(null);
    try {
      const response = after ? await listWorkspaces(context, { after }) : await listWorkspaces(context);
      if (!alive.current || current !== sequence.current) return;
      setWorkspaces(previous => after
        ? [...previous, ...response.workspaces.filter(item => !previous.some(old => old.id === item.id))]
        : response.workspaces);
      setNextAfter(response.next_after ?? null);
      setTotal(response.total_is_exact === true ? response.total : null);
      if (!after && !useStore.getState().workspaceId && response.workspaces[0]) {
        setWorkspaceId(response.workspaces[0].id);
      }
    } catch (err: unknown) {
      if (!alive.current || current !== sequence.current) return;
      setError(err instanceof Error ? err.message : "Unable to load workspaces");
    } finally {
      if (alive.current && current === sequence.current) { setLoading(false); setLoadingMore(false); }
    }
  };

  useEffect(() => {
    if (authMode === "loading") return;
    if (authMode === "signed_out") {
      navigateStatic("/auth/login?next=%2Fworkspaces");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authMode]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authMode !== "authenticated" || !userId || creating) return;
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const workspace = await createWorkspace({ name: name.trim() }, context);
      if (!alive.current) return;
      void load();
      if (useStore.getState().workspaceId === workspaceId) setWorkspaceId(workspace.id);
      setName("");
      toast.success("Workspace created");
    } catch (err: unknown) {
      if (!alive.current) return;
      setError(err instanceof Error ? err.message : "Unable to create workspace");
    } finally {
      if (alive.current) setCreating(false);
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
            onClick={() => void load()}
            disabled={loading || loadingMore}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {authMode === "demo" && (
          <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Workspace creation requires Supabase sign-in and backend Supabase secrets.
          </div>
        )}

        {authMode === "authenticated" && userId && <InvitationAcceptance context={context} onAccepted={() => void load()} />}
        {authMode === "authenticated" && (
          <form
            onSubmit={create}
            className="mb-5 flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 sm:flex-row"
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New workspace name"
              aria-label="New workspace name"
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

        {!loading && workspaces.length > 0 && (
          <p aria-live="polite" className="mb-3 text-sm text-[var(--text-muted)]">
            {total !== null ? `Showing ${workspaces.length} of ${total} active workspaces` : `${workspaces.length} workspaces loaded`}
          </p>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--text-muted)]">
            <Loader2 size={18} className="mr-2 animate-spin" />
            Loading workspaces
          </div>
        ) : error && workspaces.length === 0 ? null : workspaces.length === 0 ? (
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
                  aria-pressed={selected}
                  onClick={() => {
                    if (useStore.getState().workspaceId === workspaceId) setWorkspaceId(workspace.id);
                    toast.success(`Workspace switched to ${workspace.name}`);
                    reloadStatic();
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
        {!loading && nextAfter && (
          <button type="button" disabled={loadingMore} onClick={() => void load(nextAfter)}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {loadingMore && <Loader2 size={15} className="animate-spin" />}
            {loadingMore ? "Loading more workspaces" : "Load more workspaces"}
          </button>
        )}
      </div>
    </div>
  );
}
