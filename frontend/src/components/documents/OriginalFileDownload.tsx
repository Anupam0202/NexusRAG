"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { useWorkspaceApiAccess } from "@/hooks/useAuthGate";
import { downloadDocumentOriginal } from "@/lib/api";
import type { DocumentMetadata } from "@/types";

export function OriginalFileDownload({ document }: { document: DocumentMetadata }) {
  const identity = useStore(state => JSON.stringify([state.authMode, state.authUser?.id, state.workspaceId, document.document_id, document.extra?.version_id]));
  return <WorkspaceOriginalFileDownload key={identity} document={document} />;
}

function WorkspaceOriginalFileDownload({ document }: { document: DocumentMetadata }) {
  const { authMode, workspaceId, canAccessWorkspaceApi } = useWorkspaceApiAccess();
  const userId = useStore(state => state.authUser?.id);
  const versionId = typeof document.extra?.version_id === "string" ? document.extra.version_id : "";
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null), alive = useRef(true), objectUrl = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; pending.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); };
  }, []);
  async function download() {
    if (pending.current || !canAccessWorkspaceApi || !versionId || document.status !== "ready") return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setProgress(0); setError(null); setMessage(null);
    try {
      const result = await downloadDocumentOriginal(document.document_id, versionId,
        { workspaceId, expectedUserId: authMode === "authenticated" ? userId ?? null : undefined },
        { signal: controller.signal, onProgress: (received, expected) => { if (alive.current) setProgress(Math.floor(received / expected * 100)); } });
      if (!alive.current || controller.signal.aborted) return;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const url = URL.createObjectURL(result.blob); objectUrl.current = url;
      const anchor = globalThis.document.createElement("a");
      anchor.href = url; anchor.download = result.filename;
      globalThis.document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => { URL.revokeObjectURL(url); if (objectUrl.current === url) objectUrl.current = null; }, 60_000);
      setMessage("Original verified; download started.");
    } catch (error) {
      if (alive.current) {
        if (controller.signal.aborted) setMessage("Download cancelled. Transfer quota may still have been charged.");
        else setError(error instanceof Error ? error.message : "The original download could not be verified. Retry.");
      }
    } finally { if (alive.current) { pending.current = null; setBusy(false); } }
  }
  const unavailable = !versionId ? "Original version unavailable. Refresh document details." : undefined;
  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void download()} disabled={busy || !canAccessWorkspaceApi || !versionId || document.status !== "ready"}
        title={unavailable ?? "Download original"} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {busy ? progress === 100 ? "Verifying original" : `Downloading ${progress}%` : "Download original"}
      </button>
      {busy && <button type="button" onClick={() => pending.current?.abort()} aria-label="Cancel original download" title="Cancel download"
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)]"><X size={16} /></button>}
    </div>
    {busy && <progress aria-label="Original download progress" max={100} value={progress} className="h-2 w-full max-w-sm" />}
    {message && <p role="status" className="text-xs text-[var(--text-muted)]">{message}</p>}
    {error && <p role="alert" className="break-words text-sm text-red-700 dark:text-red-300">{error}</p>}
    {unavailable && <p className="text-xs text-[var(--text-muted)]">{unavailable}</p>}
  </div>;
}
