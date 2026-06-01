"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Layers3, Loader2, Search, X } from "lucide-react";
import { getDocumentChunks } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import type { DocumentChunkPreview, DocumentMetadata } from "@/types";

interface Props {
  document: DocumentMetadata | null;
  onClose: () => void;
}

export function DocumentDetailPanel({ document, onClose }: Props) {
  const [chunks, setChunks] = useState<DocumentChunkPreview[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!document) {
      setChunks([]);
      setTotal(0);
      setQuery("");
      setError(null);
    }
  }, [document]);

  useEffect(() => {
    if (!document) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await getDocumentChunks(document.document_id, {
          search: query,
          limit: 50,
        });
        if (ctrl.signal.aborted) return;
        setChunks(response.chunks);
        setTotal(response.total);
      } catch (err: unknown) {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Unable to load document chunks");
        setChunks([]);
        setTotal(0);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [document, query]);

  const metadata = useMemo<Array<[string, string | number]>>(() => {
    if (!document) return [];
    return [
      ["Type", document.file_type || "unknown"],
      ["Size", formatBytes(document.file_size_bytes)],
      ["Pages", document.page_count || "-"],
      ["Chunks", document.chunk_count],
      ["Extraction", document.extraction_method || "pipeline"],
    ];
  }, [document]);

  if (!document) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close document details"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col border-l border-[var(--border)] bg-[var(--bg-primary)] shadow-2xl">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText size={18} className="shrink-0 text-brand-500" />
              <h2 className="truncate text-base font-bold">{document.filename}</h2>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {total} matching chunks from {document.chunk_count} indexed chunks
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-[var(--border)] px-4 py-3 sm:grid-cols-5 sm:px-5">
          {metadata.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
              <p className="truncate text-[10px] font-medium uppercase text-[var(--text-muted)]">{label}</p>
              <p className="mt-0.5 truncate text-xs font-semibold">{value}</p>
            </div>
          ))}
        </div>

        <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <label className="relative block">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chunks"
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] pl-9 pr-3 text-sm outline-none focus:border-brand-500"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--text-muted)]">
              <Loader2 size={17} className="mr-2 animate-spin" />
              Loading chunks
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          ) : chunks.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center text-[var(--text-muted)]">
              <Layers3 size={32} className="mb-3 opacity-40" />
              <p className="text-sm font-medium">No chunks matched</p>
              <p className="mt-1 text-xs">Try a different search term.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {chunks.map((chunk) => (
                <article
                  key={`${chunk.chunk_index}-${chunk.page_number}-${chunk.content.slice(0, 16)}`}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
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
                      {chunk.token_count || Math.ceil(chunk.content.length / 4)} tokens
                    </span>
                  </div>
                  {chunk.section_title && (
                    <p className="mb-2 truncate text-xs font-semibold">{chunk.section_title}</p>
                  )}
                  <p className={cn(
                    "whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-secondary)]",
                    chunk.content.length > 900 && "max-h-56 overflow-hidden"
                  )}>
                    {chunk.content}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
