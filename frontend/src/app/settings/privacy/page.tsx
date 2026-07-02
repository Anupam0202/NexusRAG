"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Eraser, Loader2, Play, Save, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  clearSession,
  deleteCurrentWorkspace,
  deleteDocument,
  getCurrentWorkspace,
  getPrivacySettings,
  listDocuments,
  runRetention,
  updatePrivacySettings,
} from "@/lib/api";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { useWorkspaceApiAccess } from "@/hooks/useAuthGate";
import { useStore } from "@/hooks/useStore";
import { setStoredWorkspaceId } from "@/lib/api-context";
import { deleteDocumentsBestEffort, normalizeRetentionSchedule } from "@/lib/workspace-controls";
import type { WorkspaceRole } from "@/types";

const DELETE_CONFIRMATION = "DELETE DOCUMENTS";
const DELETE_WORKSPACE_CONFIRMATION = "DELETE WORKSPACE";

export default function PrivacyPage() {
  const { authMode, canAccessWorkspaceApi } = useWorkspaceApiAccess();
  const sessionId = useStore((state) => state.sessionId);
  const clearMessages = useStore((state) => state.clearMessages);
  const setDocuments = useStore((state) => state.setDocuments);
  const [role, setRole] = useState<WorkspaceRole>("viewer");
  const [documentCount, setDocumentCount] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const [workspaceConfirmation, setWorkspaceConfirmation] = useState("");
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [retentionDays, setRetentionDays] = useState(30);
  const [lastRetentionAt, setLastRetentionAt] = useState<string | null>(null);
  const [working, setWorking] = useState<
    "chat" | "documents" | "retention" | "retention-run" | "workspace" | null
  >(null);

  useEffect(() => {
    if (!canAccessWorkspaceApi) return;
    Promise.all([getCurrentWorkspace(), listDocuments(), getPrivacySettings()])
      .then(([workspace, documents, privacy]) => {
        setRole(workspace.role);
        setDocumentCount(documents.total);
        setRetentionEnabled(privacy.retention_enabled);
        setRetentionDays(privacy.retention_days || 30);
        setLastRetentionAt(privacy.last_retention_at ?? null);
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Unable to load privacy controls");
      });
  }, [canAccessWorkspaceApi]);

  if (!canAccessWorkspaceApi) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-8">
          <AuthRequiredState
            authMode={authMode}
            nextPath="/settings/privacy"
            title="Sign in to manage privacy"
            description="Privacy actions are scoped to your authenticated workspace."
          />
        </div>
      </div>
    );
  }

  const clearCurrentChat = async () => {
    setWorking("chat");
    try {
      await clearSession(sessionId);
      clearMessages();
      toast.success("Current chat history cleared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to clear chat history");
    } finally {
      setWorking(null);
    }
  };

  const deleteAllDocuments = async () => {
    if (confirmation !== DELETE_CONFIRMATION) return;
    setWorking("documents");
    try {
      const response = await listDocuments();
      const result = await deleteDocumentsBestEffort(
        response.documents.map((document) => document.document_id),
        deleteDocument
      );
      const remaining = response.documents.filter(
        (document) => !result.deletedIds.includes(document.document_id)
      );
      setDocuments(remaining);
      setDocumentCount(remaining.length);
      if (result.failures.length === 0) {
        setConfirmation("");
        toast.success(
          `${result.deletedIds.length} document${result.deletedIds.length === 1 ? "" : "s"} deleted`
        );
      } else {
        toast.error(
          `${result.deletedIds.length} deleted; ${result.failures.length} could not be deleted.`
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Document cleanup stopped: ${error.message}`
          : "Unable to delete workspace documents"
      );
    } finally {
      setWorking(null);
    }
  };

  const canDeleteDocuments = role === "owner" || role === "admin";
  const canManageRetention = authMode === "authenticated" && canDeleteDocuments;
  const canDeleteWorkspace = authMode === "authenticated" && role === "owner";

  const saveRetention = async () => {
    setWorking("retention");
    try {
      const payload = normalizeRetentionSchedule(retentionEnabled, retentionDays);
      const saved = await updatePrivacySettings(payload);
      setRetentionEnabled(saved.retention_enabled);
      setRetentionDays(saved.retention_days || 30);
      setLastRetentionAt(saved.last_retention_at ?? null);
      toast.success(saved.retention_enabled ? "Retention schedule saved" : "Retention disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save retention");
    } finally {
      setWorking(null);
    }
  };

  const runRetentionNow = async () => {
    setWorking("retention-run");
    try {
      const result = await runRetention();
      const documents = await listDocuments();
      setDocuments(documents.documents);
      setDocumentCount(documents.total);
      setLastRetentionAt(new Date().toISOString());
      if (result.failures.length) {
        toast.error(`${result.documents_deleted} documents deleted; ${result.failures.length} failed.`);
      } else {
        toast.success(`${result.documents_deleted} expired documents removed`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to run retention");
    } finally {
      setWorking(null);
    }
  };

  const deleteWorkspace = async () => {
    if (workspaceConfirmation !== DELETE_WORKSPACE_CONFIRMATION) return;
    setWorking("workspace");
    try {
      await deleteCurrentWorkspace();
      setStoredWorkspaceId(null);
      window.location.assign("/workspaces");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete workspace");
      setWorking(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
        <Link
          href="/settings"
          className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft size={15} />
          Settings
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold">Privacy & Data Controls</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Review and remove workspace-scoped data.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Current chat history</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  Clears the active session from this device and durable workspace message storage.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void clearCurrentChat()}
                disabled={working !== null}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                {working === "chat" ? <Loader2 size={15} className="animate-spin" /> : <Eraser size={15} />}
                Clear chat
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="flex items-start gap-3">
              <CalendarClock size={18} className="mt-0.5 shrink-0 text-brand-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Retention schedule</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  Remove documents and chat sessions older than the configured period.
                  {lastRetentionAt ? ` Last run ${new Date(lastRetentionAt).toLocaleString()}.` : ""}
                </p>
                {canManageRetention ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-end">
                    <label className="flex items-center gap-2 py-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        checked={retentionEnabled}
                        onChange={(event) => setRetentionEnabled(event.target.checked)}
                      />
                      Enabled
                    </label>
                    <label className="text-xs font-semibold text-[var(--text-muted)]">
                      Retention days
                      <input
                        type="number"
                        min={1}
                        max={3650}
                        value={retentionDays}
                        disabled={!retentionEnabled}
                        onChange={(event) => setRetentionDays(Number(event.target.value))}
                        className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:opacity-50"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void saveRetention()}
                      disabled={working !== null}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--bg-hover)] disabled:opacity-50"
                    >
                      {working === "retention" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => void runRetentionNow()}
                      disabled={!retentionEnabled || working !== null}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
                    >
                      {working === "retention-run" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                      Run now
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs font-semibold text-[var(--text-muted)]">
                    Durable retention is available to authenticated workspace owners and administrators.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-red-300 bg-red-50/70 p-4 dark:border-red-900 dark:bg-red-950/20">
            <div className="flex items-start gap-3">
              <Trash2 size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200">Danger zone</p>
                <p className="mt-1 text-xs leading-5 text-red-700 dark:text-red-300">
                  Delete all {documentCount} indexed workspace document{documentCount === 1 ? "" : "s"}.
                  This removes document metadata, chunks, and vectors through the protected document API.
                </p>
                {canDeleteDocuments ? (
                  <form
                    className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void deleteAllDocuments();
                    }}
                  >
                    <label htmlFor="delete-documents-confirmation" className="sr-only">
                      Confirm deletion of all workspace documents
                    </label>
                    <input
                      id="delete-documents-confirmation"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      placeholder={`Type ${DELETE_CONFIRMATION}`}
                      className="min-w-0 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-500 dark:border-red-900 dark:bg-red-950/30"
                    />
                    <button
                      type="submit"
                      disabled={
                        confirmation !== DELETE_CONFIRMATION ||
                        documentCount === 0 ||
                        working !== null
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      {working === "documents" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Trash2 size={15} />
                      )}
                      Delete all
                    </button>
                  </form>
                ) : (
                  <p className="mt-3 text-xs font-semibold text-red-700 dark:text-red-300">
                    Only workspace owners and administrators can perform this action.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-red-500 bg-red-100/80 p-4 dark:border-red-800 dark:bg-red-950/30">
            <div className="flex items-start gap-3">
              <Trash2 size={18} className="mt-0.5 shrink-0 text-red-700 dark:text-red-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-red-900 dark:text-red-100">Delete workspace</p>
                <p className="mt-1 text-xs leading-5 text-red-800 dark:text-red-200">
                  Permanently removes private originals, vectors, chats, usage, settings, and memberships.
                  Cleanup must finish before the workspace database row is removed.
                </p>
                {canDeleteWorkspace ? (
                  <form
                    className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void deleteWorkspace();
                    }}
                  >
                    <input
                      aria-label="Confirm workspace deletion"
                      value={workspaceConfirmation}
                      onChange={(event) => setWorkspaceConfirmation(event.target.value)}
                      placeholder={`Type ${DELETE_WORKSPACE_CONFIRMATION}`}
                      className="min-w-0 rounded-lg border border-red-400 bg-white px-3 py-2 text-sm outline-none focus:border-red-600 dark:bg-red-950/40"
                    />
                    <button
                      type="submit"
                      disabled={workspaceConfirmation !== DELETE_WORKSPACE_CONFIRMATION || working !== null}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                    >
                      {working === "workspace" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                      Delete workspace
                    </button>
                  </form>
                ) : (
                  <p className="mt-3 text-xs font-semibold text-red-800 dark:text-red-200">
                    Only an authenticated workspace owner can delete the workspace.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
