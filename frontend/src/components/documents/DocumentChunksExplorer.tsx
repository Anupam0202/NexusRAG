"use client";

import { useEffect, useRef, useState } from "react";
import { Layers3, Loader2, RefreshCw, Search } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { useWorkspaceApiAccess } from "@/hooks/useAuthGate";
import { getDocumentChunks } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DocumentChunkPreview } from "@/types";

interface Props {
  documentId: string;
  expectedChunkCount?: number;
  limit?: number;
  className?: string;
}

export function DocumentChunksExplorer(props: Props) {
  const identity = useStore(state => JSON.stringify([state.authMode, state.authUser?.id, state.workspaceId, props.documentId]));
  return <WorkspaceChunks key={identity} {...props} />;
}
function WorkspaceChunks({ documentId, expectedChunkCount = 0, limit = 50, className }: Props) {
  const { authMode, workspaceId, isWorkspaceLoading, canAccessWorkspaceApi } = useWorkspaceApiAccess();
  const userId = useStore(state => state.authUser?.id);
  const expectedUserId = authMode === "authenticated" ? userId ?? null : undefined;
  const alive = useRef(true), sequence = useRef(0);
  useEffect(() => { const counter = sequence; alive.current = true; return () => { alive.current = false; counter.current++; }; }, []);
  const [chunks, setChunks] = useState<DocumentChunkPreview[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [exact, setExact] = useState(false);
  const [after, setAfter] = useState<number | null>(null);
  const [version, setVersion] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const current = ++sequence.current;
    setChunks([]); setTotal(null); setExact(false); setAfter(null); setVersion(undefined); setError(null);
    if (!documentId || !canAccessWorkspaceApi || isWorkspaceLoading) { setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await getDocumentChunks(documentId, { search: query, limit }, { workspaceId, expectedUserId });
        if (!alive.current || current !== sequence.current) return;
        setChunks(response.chunks); setTotal(response.total); setExact(response.total_is_exact === true);
        setAfter(response.next_after ?? null); setVersion(response.version_id);
      } catch (err: unknown) {
        if (!alive.current || current !== sequence.current) return;
        setError(err instanceof Error ? err.message : "Unable to load document chunks");
      } finally { if (alive.current && current === sequence.current) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); };
  }, [documentId, limit, query, refreshKey, canAccessWorkspaceApi, isWorkspaceLoading, workspaceId, expectedUserId]);

  const loadMore = async () => {
    if (loading || after === null || !version) return;
    const current = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const response = await getDocumentChunks(documentId, { search: query, limit, after, versionId: version }, { workspaceId, expectedUserId });
      if (!alive.current || current !== sequence.current) return;
      if (response.version_id !== version || response.chunks.some(row => chunks.some(old => old.chunk_index === row.chunk_index)) ||
          (response.next_after != null && response.next_after <= after)) throw new Error("Chunk inventory changed or did not advance. Refresh before continuing.");
      setChunks(old => [...old, ...response.chunks]); setAfter(response.next_after ?? null);
      setTotal(response.total); setExact(response.total_is_exact === true);
    } catch (err: unknown) {
      if (alive.current && current === sequence.current) { setError(err instanceof Error ? err.message : "Unable to load more chunks"); setExact(false); }
    } finally { if (alive.current && current === sequence.current) setLoading(false); }
  };
  const countLabel = total === null ? "Chunk inventory not measured" : exact
    ? `${total} ${query.trim() ? "matching" : "indexed"} chunk${total === 1 ? "" : "s"} · showing ${chunks.length}`
    : `Showing ${chunks.length} chunk previews · total unverified`;
  const chunksNeedRefresh = total !== null && !query.trim() && expectedChunkCount > 0 && total === 0;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            disabled={!canAccessWorkspaceApi || isWorkspaceLoading}
            aria-label="Search indexed chunks"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search indexed chunks"
            className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] pl-9 pr-3 text-sm outline-none transition focus:border-brand-500"
          />
        </label>
        <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
          <span className="text-xs font-medium text-[var(--text-muted)]">{countLabel}</span>
          <button
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
            aria-label="Refresh chunks"
            title="Refresh chunks"
          >
            <RefreshCw size={15} className={cn(loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {loading && chunks.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-card)] py-12 text-sm text-[var(--text-muted)]">
          <Loader2 size={17} className="mr-2 animate-spin" />
          Loading chunks
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      ) : chunks.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-[var(--border)] bg-[var(--bg-card)] py-12 text-center text-[var(--text-muted)]">
          <Layers3 size={32} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">
            {chunksNeedRefresh ? "Chunk previews need refresh" : "No chunks matched"}
          </p>
          <p className="mt-1 max-w-md px-4 text-xs">
            {chunksNeedRefresh
              ? "This document is ready, but searchable chunk previews are not available yet. Use Re-index on the document details page to rebuild them."
              : "Try a different search term or refresh the document."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {chunks.map((chunk) => (
            <article
              key={`${documentId}-${chunk.chunk_index}-${chunk.page_number}`}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                    Chunk {chunk.chunk_index + 1}
                  </span>
                  {chunk.page_number > 0 && (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      Page {chunk.page_number}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                  {chunk.token_count == null ? `Approx. ${Math.ceil(chunk.content.length / 4)}` : chunk.token_count} tokens
                </span>
              </div>
              {chunk.section_title && (
                <p className="mb-2 truncate text-xs font-semibold">{chunk.section_title}</p>
              )}
              <p
                className={cn(
                  "whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-secondary)]",
                  chunk.content.length > 1200 && "max-h-72 overflow-y-auto pr-1"
                )}
              >
                {chunk.content}
              </p>
            </article>
          ))}
        </div>
      )}
      {after !== null && version && !error && (
        <button type="button" onClick={loadMore} disabled={loading}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
          {loading ? "Loading more chunks…" : "Load more chunks"}
        </button>
      )}
    </div>
  );
}
