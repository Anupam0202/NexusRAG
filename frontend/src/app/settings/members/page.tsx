"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  addCurrentWorkspaceMember,
  getCurrentWorkspace,
  listCurrentWorkspaceMembers,
  removeCurrentWorkspaceMember,
  updateCurrentWorkspaceMember,
} from "@/lib/api";
import { useStore } from "@/hooks/useStore";
import { canManageWorkspaceMember } from "@/lib/workspace-controls";
import type { WorkspaceMember, WorkspaceRole } from "@/types";

type ManageableRole = Exclude<WorkspaceRole, "owner">;

export default function MembersPage() {
  const router = useRouter();
  const authMode = useStore((state) => state.authMode);
  const authUser = useStore((state) => state.authUser);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<WorkspaceRole>("viewer");
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [emailOrUserId, setEmailOrUserId] = useState("");
  const [newRole, setNewRole] = useState<ManageableRole>("viewer");
  const [error, setError] = useState<string | null>(null);

  const canManage =
    authMode === "authenticated" && (currentRole === "owner" || currentRole === "admin");

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const [response, workspace] = await Promise.all([
        listCurrentWorkspaceMembers(),
        getCurrentWorkspace(),
      ]);
      setWorkspaceId(response.workspace_id);
      setMembers(response.members);
      setCurrentRole(workspace.role);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load members");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authMode === "loading") return;
    if (authMode === "signed_out") {
      router.replace("/auth/login?next=/settings/members");
      return;
    }
    void loadMembers();
  }, [authMode, loadMembers, router]);

  const addMember = async () => {
    if (!emailOrUserId.trim()) return;
    setSavingUserId("new");
    try {
      const member = await addCurrentWorkspaceMember({
        email_or_user_id: emailOrUserId.trim(),
        role: newRole,
      });
      setMembers((current) => [
        ...current.filter((item) => item.user_id !== member.user_id),
        member,
      ]);
      setEmailOrUserId("");
      toast.success("Workspace member added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to add member");
    } finally {
      setSavingUserId(null);
    }
  };

  const updateRole = async (member: WorkspaceMember, role: ManageableRole) => {
    setSavingUserId(member.user_id);
    try {
      const updated = await updateCurrentWorkspaceMember(member.user_id, { role });
      setMembers((current) =>
        current.map((item) => (item.user_id === updated.user_id ? { ...item, ...updated } : item))
      );
      toast.success("Member role updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to update role");
    } finally {
      setSavingUserId(null);
    }
  };

  const removeMember = async (member: WorkspaceMember) => {
    const label = member.display_name || member.email || member.user_id;
    if (!window.confirm(`Remove ${label} from this workspace?`)) return;
    setSavingUserId(member.user_id);
    try {
      await removeCurrentWorkspaceMember(member.user_id);
      setMembers((current) => current.filter((item) => item.user_id !== member.user_id));
      toast.success("Workspace member removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to remove member");
    } finally {
      setSavingUserId(null);
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
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
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
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Workspace Members</h2>
            <p className="truncate text-sm text-[var(--text-muted)]">
              {workspaceId ?? "Current workspace"} · Your role: {currentRole}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {canManage && (
          <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="mb-3 flex items-center gap-2">
              <UserPlus size={16} className="text-brand-500" />
              <p className="text-sm font-semibold">Add an existing NexusRAG user</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <label htmlFor="new-member-identity" className="sr-only">
                Existing user email address or user ID
              </label>
              <input
                id="new-member-identity"
                value={emailOrUserId}
                onChange={(event) => setEmailOrUserId(event.target.value)}
                placeholder="Email address or user UUID"
                className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <label htmlFor="new-member-role" className="sr-only">
                New member role
              </label>
              <select
                id="new-member-role"
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as ManageableRole)}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-brand-500"
              >
                {currentRole === "owner" && <option value="admin">Admin</option>}
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="button"
                onClick={addMember}
                disabled={!emailOrUserId.trim() || savingUserId === "new"}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
              >
                {savingUserId === "new" ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
                Add
              </button>
            </div>
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
            {members.map((member) => {
              const isCurrentUser = member.user_id === authUser?.id;
              const canManageMember = canManageWorkspaceMember({
                authMode,
                actorRole: currentRole,
                actorUserId: authUser?.id,
                member,
              });
              return (
                <div
                  key={member.user_id}
                  className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {member.display_name || member.email || member.user_id}
                      {isCurrentUser ? " (you)" : ""}
                    </p>
                    <p className="truncate text-xs text-[var(--text-muted)]">
                      {member.email ?? member.user_id}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canManageMember ? (
                      <>
                        <select
                          value={member.role}
                          disabled={savingUserId === member.user_id}
                          onChange={(event) =>
                            void updateRole(member, event.target.value as ManageableRole)
                          }
                          className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-brand-500"
                          aria-label={`Role for ${member.email ?? member.user_id}`}
                        >
                          {currentRole === "owner" && <option value="admin">Admin</option>}
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => void removeMember(member)}
                          disabled={savingUserId === member.user_id}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30"
                          aria-label={`Remove ${member.email ?? member.user_id}`}
                        >
                          {savingUserId === member.user_id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                        <ShieldCheck size={13} />
                        {member.role}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
