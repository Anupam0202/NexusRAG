"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useChat } from "@/hooks/useChat";
import { MessageBubble } from "./MessageBubble";
import { SourcePanel } from "./SourcePanel";
import type { SourceChunk } from "@/types";
import {
  Send, ArrowDown, Sparkles, FileSearch, Brain,
  MessageSquare, Trash2, Zap, BookOpen, Search, Upload, Files,
  Download, FileJson, SlidersHorizontal, X,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useStore } from "@/hooks/useStore";
import { useDocuments } from "@/hooks/useDocuments";
import { clearSession } from "@/lib/api";
import { buildChatRequestFilters, exportChatJson, exportChatMarkdown } from "@/lib/chat-tools";
import { toggleDocumentSelection } from "@/lib/workspace-controls";
import { toast } from "sonner";

const SUGGESTIONS = [
  { icon: <FileSearch size={15} />, text: "Summarize this document" },
  { icon: <Brain size={15} />, text: "What are the key findings?" },
  { icon: <Search size={15} />, text: "Extract the main topics" },
  { icon: <BookOpen size={15} />, text: "List important facts" },
  { icon: <Zap size={15} />, text: "What conclusions are drawn?" },
  { icon: <MessageSquare size={15} />, text: "Compare the main sections" },
];

export default function ChatInterface() {
  const { sendMessage, messages } = useChat();
  const [input, setInput] = useState("");
  const [activeSources, setActiveSources] = useState<SourceChunk[] | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [chatScope, setChatScope] = useState<"workspace" | "documents">("workspace");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [selectedFileTypes, setSelectedFileTypes] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filenameFilter, setFilenameFilter] = useState("");
  const [uploaderFilter, setUploaderFilter] = useState("");
  const [minPage, setMinPage] = useState("");
  const [maxPage, setMaxPage] = useState("");
  const [uploadedAfter, setUploadedAfter] = useState("");
  const [uploadedBefore, setUploadedBefore] = useState("");
  const [metadataKey, setMetadataKey] = useState("");
  const [metadataValue, setMetadataValue] = useState("");
  const {
    documents,
    loading: documentsLoading,
    error: documentsError,
  } = useDocuments();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const store = useStore();
  const canChat = store.authMode === "authenticated" || store.authMode === "demo";
  const docCount = documents.length;
  const isStreaming = messages.some((m) => m.isStreaming);
  const readyDocuments = useMemo(
    () => documents.filter((doc) => doc.status === "ready"),
    [documents]
  );
  const availableFileTypes = useMemo(
    () => [...new Set(readyDocuments.map((doc) => doc.file_type).filter(Boolean))].sort(),
    [readyDocuments]
  );
  const hasDocumentFilter =
    selectedDocumentIds.length > 0 || Boolean(filenameFilter.trim());
  const canSend =
    Boolean(input.trim()) &&
    !isStreaming &&
    canChat &&
    (chatScope === "workspace" || hasDocumentFilter);

  useEffect(() => {
    if (chatScope !== "documents") return;
    setSelectedDocumentIds((current) =>
      current.filter((id) => readyDocuments.some((doc) => doc.document_id === id))
    );
  }, [chatScope, readyDocuments]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Scroll detection
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(gap > 200);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const handleSend = useCallback(() => {
    const q = input.trim();
    if (!canSend) return;
    try {
      const filters = buildChatRequestFilters({
        chatScope,
        documentIds: chatScope === "documents" ? selectedDocumentIds : [],
        fileTypes: selectedFileTypes,
        filename: filenameFilter,
        uploadedBy: uploaderFilter,
        minPage,
        maxPage,
        uploadedAfter,
        uploadedBefore,
        metadataKey,
        metadataValue,
      });
      sendMessage(q, {
        chatScope,
        documentIds: filters.document_ids,
        fileTypes: filters.file_types,
        filename: filters.filename,
        uploadedBy: filters.uploaded_by,
        minPage: filters.min_page,
        maxPage: filters.max_page,
        uploadedAfter: filters.uploaded_after,
        uploadedBefore: filters.uploaded_before,
        metadataFilters: filters.metadata_filters,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid chat filters");
      return;
    }
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [
    canSend,
    chatScope,
    filenameFilter,
    input,
    maxPage,
    minPage,
    selectedDocumentIds,
    selectedFileTypes,
    sendMessage,
    uploadedAfter,
    uploadedBefore,
    uploaderFilter,
    metadataKey,
    metadataValue,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  };

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  const clearChat = () => {
    store.clearMessages?.();
    setActiveSources(null);
    if (canChat) {
      clearSession(store.sessionId).catch(() => {/* best-effort */ });
    }
  };

  const downloadChat = (format: "markdown" | "json") => {
    if (messages.length === 0) return;
    const content =
      format === "markdown" ? exportChatMarkdown(messages) : exportChatJson(messages);
    const blob = new Blob([content], {
      type: format === "markdown" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `nexusrag-chat-${new Date().toISOString().slice(0, 10)}.${
      format === "markdown" ? "md" : "json"
    }`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const toggleDocument = (documentId: string) => {
    setSelectedDocumentIds((current) => {
      const result = toggleDocumentSelection(current, documentId);
      if (result.limitReached) {
        toast.error("You can select up to 25 documents at a time.");
      }
      return result.selected;
    });
  };

  const toggleFileType = (fileType: string) => {
    setSelectedFileTypes((current) =>
      current.includes(fileType)
        ? current.filter((item) => item !== fileType)
        : [...current, fileType]
    );
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full w-full min-w-0 overflow-hidden">
      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 relative" role="log" aria-live="polite">
          {isEmpty ? (
            <EmptyState
              docCount={docCount}
              loading={documentsLoading}
              error={documentsError}
              authMode={store.authMode}
              onSuggestion={(text) => {
                setInput(text);
                inputRef.current?.focus();
              }}
            />
          ) : (
            <div className="max-w-3xl mx-auto space-y-5">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onShowSources={
                    msg.sources?.length
                      ? () => setActiveSources(msg.sources ?? null)
                      : undefined
                  }
                />
              ))}
              <div ref={bottomRef} />
            </div>
          )}

          {/* Scroll-to-bottom FAB */}
          {showScrollBtn && (
            <button
              onClick={scrollToBottom}
              className="fixed bottom-24 right-6 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg hover:bg-brand-600 active:scale-90 transition-all animate-bounce-in"
            >
              <ArrowDown size={16} />
            </button>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-[var(--border)] bg-[var(--bg-primary)]/80 backdrop-blur-xl px-3 sm:px-6 py-3 safe-bottom">
          <div className="max-w-3xl mx-auto">
            {canChat && docCount > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-1">
                  <button
                    type="button"
                    onClick={() => setChatScope("workspace")}
                    aria-pressed={chatScope === "workspace"}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                      chatScope === "workspace"
                        ? "bg-brand-600 text-white"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <Files size={13} />
                    Workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setChatScope("documents");
                      setSelectedDocumentIds((current) =>
                        current.length || !readyDocuments[0] ? current : [readyDocuments[0].document_id]
                      );
                    }}
                    disabled={readyDocuments.length === 0}
                    aria-pressed={chatScope === "documents"}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40",
                      chatScope === "documents"
                        ? "bg-brand-600 text-white"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <FileSearch size={13} />
                    Selected
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFilters((current) => !current)}
                  aria-expanded={showFilters}
                  aria-controls="retrieval-filters"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition",
                    showFilters
                      ? "border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-200"
                      : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)]"
                  )}
                >
                  <SlidersHorizontal size={13} />
                  Filters
                </button>
              </div>
            )}
            {canChat && docCount > 0 && showFilters && (
              <div
                id="retrieval-filters"
                className="mb-2 max-h-[min(60vh,28rem)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">Retrieval filters</p>
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                    aria-label="Close filters"
                  >
                    <X size={14} />
                  </button>
                </div>
                {chatScope === "documents" && (
                  <div className="mb-3 max-h-28 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
                    {readyDocuments.map((doc) => (
                      <label
                        key={doc.document_id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--bg-hover)]"
                      >
                        <input
                          type="checkbox"
                          checked={selectedDocumentIds.includes(doc.document_id)}
                          onChange={() => toggleDocument(doc.document_id)}
                          className="accent-brand-600"
                        />
                        <span className="truncate">{doc.filename}</span>
                      </label>
                    ))}
                  </div>
                )}
                {availableFileTypes.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
                      File types
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {availableFileTypes.map((fileType) => (
                        <label
                          key={fileType}
                          className={cn(
                            "cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-semibold transition",
                            selectedFileTypes.includes(fileType)
                              ? "border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-200"
                              : "border-[var(--border)] text-[var(--text-muted)]"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={selectedFileTypes.includes(fileType)}
                            onChange={() => toggleFileType(fileType)}
                            className="sr-only"
                          />
                          {fileType.toUpperCase()}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <label htmlFor="chat-filename-filter" className="sr-only">
                    Filter by filename
                  </label>
                  <input
                    id="chat-filename-filter"
                    value={filenameFilter}
                    onChange={(event) => setFilenameFilter(event.target.value)}
                    placeholder="Filename filter"
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                  <label htmlFor="chat-uploader-filter" className="sr-only">
                    Filter by uploader user ID
                  </label>
                  <input
                    id="chat-uploader-filter"
                    value={uploaderFilter}
                    onChange={(event) => setUploaderFilter(event.target.value)}
                    placeholder="Uploader user ID"
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                  <label htmlFor="chat-min-page-filter" className="sr-only">
                    Minimum page
                  </label>
                  <input
                    id="chat-min-page-filter"
                    type="number"
                    min={0}
                    value={minPage}
                    onChange={(event) => setMinPage(event.target.value)}
                    placeholder="Minimum page"
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                  <label htmlFor="chat-max-page-filter" className="sr-only">
                    Maximum page
                  </label>
                  <input
                    id="chat-max-page-filter"
                    type="number"
                    min={0}
                    value={maxPage}
                    onChange={(event) => setMaxPage(event.target.value)}
                    placeholder="Maximum page"
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                  <label htmlFor="chat-uploaded-after-filter" className="sr-only">
                    Uploaded after
                  </label>
                  <input
                    id="chat-uploaded-after-filter"
                    type="date"
                    value={uploadedAfter}
                    onChange={(event) => setUploadedAfter(event.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                  <label htmlFor="chat-uploaded-before-filter" className="sr-only">
                    Uploaded before
                  </label>
                  <input
                    id="chat-uploaded-before-filter"
                    type="date"
                    value={uploadedBefore}
                    onChange={(event) => setUploadedBefore(event.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                  <label htmlFor="chat-metadata-key-filter" className="sr-only">
                    Metadata key
                  </label>
                  <input
                    id="chat-metadata-key-filter"
                    value={metadataKey}
                    onChange={(event) => setMetadataKey(event.target.value)}
                    placeholder="Metadata key"
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                  <label htmlFor="chat-metadata-value-filter" className="sr-only">
                    Metadata value
                  </label>
                  <input
                    id="chat-metadata-value-filter"
                    value={metadataValue}
                    onChange={(event) => setMetadataValue(event.target.value)}
                    placeholder="Metadata value"
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                </div>
              </div>
            )}
            <div className="glass-input flex items-end gap-2 rounded-2xl px-4 py-2.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={
                  documentsLoading
                    ? "Checking document library..."
                    : !canChat
                      ? "Sign in to chat with your documents..."
                    : chatScope === "documents" && hasDocumentFilter
                      ? "Ask about the selected documents..."
                    : docCount > 0
                      ? "Ask about your documents..."
                      : "Upload documents to start chatting..."
                }
                rows={1}
                disabled={isStreaming || !canChat}
                aria-label="Chat message"
                className="flex-1 bg-transparent resize-none text-sm leading-relaxed placeholder:text-[var(--text-muted)] focus:outline-none min-h-[24px] max-h-[150px] disabled:opacity-50"
              />

              <div className="flex items-center gap-1 shrink-0 pb-0.5">
                {messages.length > 0 && (
                  <>
                    <button
                      onClick={() => downloadChat("markdown")}
                      title="Export chat as Markdown"
                      aria-label="Export chat as Markdown"
                      className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-brand-500 transition-all"
                    >
                      <Download size={15} />
                    </button>
                    <button
                      onClick={() => downloadChat("json")}
                      title="Export chat as JSON"
                      aria-label="Export chat as JSON"
                      className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-brand-500 transition-all"
                    >
                      <FileJson size={15} />
                    </button>
                  </>
                )}
                {messages.length > 0 && (
                  <button
                    onClick={clearChat}
                    title="Clear chat"
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                  >
                    <Trash2 size={15} />
                  </button>
                )}

                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  aria-label="Send message"
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200",
                    canSend
                      ? "bg-gradient-to-r from-brand-500 to-purple-600 text-white shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
                      : "bg-[var(--bg-secondary)] text-[var(--text-muted)] cursor-not-allowed"
                  )}
                >
                  {isStreaming ? (
                    <div className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  ) : (
                    <Send size={15} />
                  )}
                </button>
              </div>
            </div>

            <p className="text-[10px] text-[var(--text-muted)] text-center mt-1.5 opacity-60">
              RAG responses are generated from your uploaded documents
            </p>
          </div>
        </div>
      </div>

      {/* Source panel */}
      <AnimatePresence>
        {activeSources && (
          <SourcePanel
            sources={activeSources}
            onClose={() => setActiveSources(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Empty state ──────────────────────────────────────────────── */

function EmptyState({
  docCount,
  loading,
  error,
  authMode,
  onSuggestion,
}: {
  docCount: number;
  loading: boolean;
  error: string | null;
  authMode: string;
  onSuggestion: (text: string) => void;
}) {
  const needsAuth = authMode === "loading" || authMode === "signed_out";

  return (
    <div className="flex h-full w-full max-w-lg flex-col items-center justify-center mx-auto text-center px-4 animate-fade-in">
      {/* Logo */}
      <div className="relative mb-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-purple-500 to-pink-500 shadow-lg">
          <Sparkles size={28} className="text-white" />
        </div>
        <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 blur-xl -z-10" />
      </div>

      <h2 className="text-xl sm:text-2xl font-bold mb-2">
        <span className="gradient-text">NexusRAG</span> Chat
      </h2>
      <p className="text-sm text-[var(--text-muted)] mb-8 max-w-xs sm:max-w-sm leading-relaxed">
        {error
          ? error
          : authMode === "loading"
          ? "Checking your secure workspace session..."
          : authMode === "signed_out"
          ? "Sign in to upload documents and ask questions grounded in your workspace content."
          : loading
          ? "Checking your document library..."
          : docCount > 0
          ? `${docCount} document${docCount > 1 ? "s" : ""} loaded. Ask anything about your content.`
          : "Upload documents first, then ask questions to get AI-powered answers grounded in your content."}
      </p>

      {authMode === "signed_out" && (
        <Link
          href="/auth/login?next=/chat"
          className="mb-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 text-white px-5 py-2.5 text-sm font-semibold shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
        >
          Sign in
        </Link>
      )}

      {!error && !loading && !needsAuth && docCount === 0 && (
        <Link
          href="/documents"
          className="mb-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 text-white px-5 py-2.5 text-sm font-semibold shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
        >
          <Upload size={16} />
          Upload Documents
        </Link>
      )}

      {!loading && docCount > 0 && (
        <div className="grid grid-cols-2 gap-2.5 w-full max-w-md">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              onClick={() => onSuggestion(s.text)}
              className="group flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3.5 py-3 text-left text-xs font-medium text-[var(--text-secondary)] hover:border-brand-300 dark:hover:border-brand-600 hover:bg-brand-50/50 dark:hover:bg-brand-900/10 hover:text-brand-600 dark:hover:text-brand-400 transition-all hover:shadow-md hover:-translate-y-0.5 duration-200 animate-stagger-in"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <span className="text-brand-500 opacity-60 group-hover:opacity-100 transition-opacity shrink-0">
                {s.icon}
              </span>
              <span className="line-clamp-2">{s.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
