"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ShieldCheck, UsersRound } from "lucide-react";
import { listCurrentWorkspaceMembers } from "@/lib/api";
import { useStore } from "@/hooks/useStore";
import type { WorkspaceMember } from "@/types";

export default function MembersPage() {
  const router = useRouter();
  const authMode = useStore((state) => state.authMode);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authMode === "loading") return;
    if (authMode === "signed_out") {
      router.replace("/auth/login?next=/settings/members");
      return;
    }
    let active = true;
    listCurrentWorkspaceMembers()
      .then((response) => {
        if (!active) return;
        setWorkspaceId(response.workspace_id);
        setMembers(response.members);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load members");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authMode, router]);

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
        <Link
          href="/settings"
          className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft size={15} />
          Settings
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
            <UsersRound size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold">Workspace Members</h2>
            <p className="text-sm text-[var(--text-muted)]">
              {workspaceId ?? "Current workspace"}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--text-muted)]">
            <Loader2 size={18} className="mr-2 animate-spin" />
            Loading members
          </div>
        ) : members.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            No members found
          </div>
        ) : (
          <div className="space-y-2">
            {members.map((member) => (
              <div
                key={member.user_id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {member.display_name || member.email || member.user_id}
                  </p>
                  <p className="truncate text-xs text-[var(--text-muted)]">
                    {member.email ?? member.user_id}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                  <ShieldCheck size={13} />
                  {member.role}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
