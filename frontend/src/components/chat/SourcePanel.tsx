"use client";

import type { SourceChunk } from "@/types";
import { X, ExternalLink } from "lucide-react";
import { fileIcon } from "@/lib/utils";

interface Props {
  sources: SourceChunk[];
  onClose: () => void;
}

export function SourcePanel({ sources, onClose }: Props) {
  return (
    <>
      {/* Mobile: full-screen overlay */}
      <div className="fixed inset-0 z-50 lg:hidden bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <aside
        className={
          "fixed right-0 top-0 bottom-0 z-50 w-full sm:w-96 " +
          "lg:relative lg:z-auto lg:w-96 " +
          "border-l border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col animate-fade-in"
        }
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <ExternalLink size={14} className="text-brand-500" />
            <h3 className="text-sm font-semibold">Sources ({sources.length})</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-[var(--bg-hover)] transition">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {sources.map((src, i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 hover:shadow-md transition group"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">{fileIcon(src.filename)}</span>
                <span className="text-sm font-semibold text-brand-600 dark:text-brand-400 truncate flex-1">
                  {src.filename}
                </span>
                <span className="text-[10px] font-bold uppercase rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 px-2 py-0.5 shrink-0">
                  {src.document_type || "doc"}
                </span>
              </div>

              {src.page_number > 0 && (
                <p className="text-xs text-[var(--text-muted)] mb-1">Page {src.page_number}</p>
              )}

              {src.relevance_score > 0 && (
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-1.5 flex-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-500"
                      style={{ width: `${Math.min(src.relevance_score * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] tabular-nums w-8 text-right">
                    {(src.relevance_score * 100).toFixed(0)}%
                  </span>
                </div>
              )}

              <div className="rounded-lg bg-[var(--bg-secondary)] p-2.5 text-xs text-[var(--text-secondary)] font-mono leading-relaxed max-h-28 overflow-y-auto">
                {src.content}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}