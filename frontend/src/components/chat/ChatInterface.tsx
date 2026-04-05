"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useChat } from "@/hooks/useChat";
import { MessageBubble } from "./MessageBubble";
import { SourcePanel } from "./SourcePanel";
import type { SourceChunk, UIMessage } from "@/types";
import {
  Send, ArrowDown, Sparkles, FileSearch, Brain,
  MessageSquare, Trash2, Zap, BookOpen, Search, Upload,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useStore } from "@/hooks/useStore";

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const store = useStore();
  const docCount = store.documents?.length ?? 0;
  const isStreaming = messages.some((m) => m.isStreaming);

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
    if (!q || isStreaming) return;
    sendMessage(q);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [input, isStreaming, sendMessage]);

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
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 relative" role="log" aria-live="polite">
          {isEmpty ? (
            <EmptyState
              docCount={docCount}
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
            <div className="glass-input flex items-end gap-2 rounded-2xl px-4 py-2.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={docCount > 0 ? "Ask about your documents..." : "Upload documents to start chatting..."}
                rows={1}
                disabled={isStreaming}
                aria-label="Chat message"
                className="flex-1 bg-transparent resize-none text-sm leading-relaxed placeholder:text-[var(--text-muted)] focus:outline-none min-h-[24px] max-h-[150px] disabled:opacity-50"
              />

              <div className="flex items-center gap-1 shrink-0 pb-0.5">
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
                  disabled={!input.trim() || isStreaming}
                  aria-label="Send message"
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200",
                    input.trim() && !isStreaming
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
  onSuggestion,
}: {
  docCount: number;
  onSuggestion: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full max-w-lg mx-auto text-center px-4 animate-fade-in">
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
      <p className="text-sm text-[var(--text-muted)] mb-8 max-w-sm leading-relaxed">
        {docCount > 0
          ? `${docCount} document${docCount > 1 ? "s" : ""} loaded. Ask anything about your content.`
          : "Upload documents first, then ask questions to get AI-powered answers grounded in your content."}
      </p>

      {docCount === 0 && (
        <Link
          href="/documents"
          className="mb-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 text-white px-5 py-2.5 text-sm font-semibold shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
        >
          <Upload size={16} />
          Upload Documents
        </Link>
      )}

      {docCount > 0 && (
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