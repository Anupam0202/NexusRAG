"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useState } from "react";
import type { UIMessage } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  ChevronDown, ChevronUp, Clock, Target, Layers,
  FileText, User, Bot, Copy, Check, AlertTriangle,
} from "lucide-react";

interface Props {
  message: UIMessage;
  onShowSources?: () => void;
}

export function MessageBubble({ message, onShowSources }: Props) {
  const isUser = message.role === "user";
  const [showInlineSources, setShowInlineSources] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasSources = (message.sources?.length ?? 0) > 0;
  const answerability =
    typeof message.metadata?.answerability === "string"
      ? message.metadata.answerability
      : undefined;
  const lowConfidence = message.metadata?.low_confidence === true || answerability === "low_confidence";
  const sourceQuoteCoverage =
    typeof message.metadata?.source_quote_coverage === "number"
      ? message.metadata.source_quote_coverage
      : undefined;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied — silently ignore
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("flex gap-2.5 sm:gap-3", isUser ? "flex-row-reverse" : "")}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full text-white text-xs font-bold mt-0.5",
          isUser
            ? "bg-gradient-to-br from-brand-500 to-purple-600"
            : "bg-gradient-to-br from-emerald-500 to-teal-600"
        )}
      >
        {isUser ? <User size={13} /> : <Bot size={13} />}
      </div>

      {/* Bubble */}
      <div className={cn("flex-1 min-w-0", isUser ? "max-w-[85%] lg:max-w-[70%] ml-auto" : "")}>
        {isUser ? (
          <div className="rounded-2xl rounded-tr-md bg-gradient-to-r from-brand-500 to-purple-600 text-white px-3.5 sm:px-4 py-2.5 sm:py-3 shadow-sm">
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        ) : (
          <div className="rounded-2xl rounded-tl-md bg-[var(--bg-card)] border border-[var(--border)] px-3.5 sm:px-4 py-2.5 sm:py-3 shadow-sm group/bubble">
            {/* Content */}
            {message.isStreaming && !message.content ? (
              <TypingIndicator />
            ) : (
              <div className="chat-prose text-sm">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{ a: SafeMarkdownLink }}
                >
                  {cleanContent(message.content)}
                </ReactMarkdown>
                {message.isStreaming && message.content && (
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-brand-500 animate-pulse rounded-sm align-text-bottom" />
                )}
              </div>
            )}

            {!message.isStreaming && lowConfidence && (
              <div className="mt-3 flex gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>Low confidence answer. Check the attached sources before using it.</span>
              </div>
            )}

            {/* Metadata + source toggle */}
            {!message.isStreaming && message.content && (
              <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2.5 border-t border-[var(--border)]">
                {message.queryType && <Badge icon={<Layers size={11} />} text={message.queryType} />}
                {answerability && <Badge icon={<AlertTriangle size={11} />} text={answerability} />}
                {typeof message.confidence === "number" && (
                  <Badge icon={<Target size={11} />} text={`${(message.confidence * 100).toFixed(0)}%`} />
                )}
                {typeof sourceQuoteCoverage === "number" && (
                  <Badge icon={<FileText size={11} />} text={`${(sourceQuoteCoverage * 100).toFixed(0)}% quotes`} />
                )}
                {typeof message.responseTime === "number" && (
                  <Badge icon={<Clock size={11} />} text={`${message.responseTime.toFixed(1)}s`} />
                )}

                {/* Copy button */}
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition opacity-0 group-hover/bubble:opacity-100"
                  aria-label="Copy response to clipboard"
                >
                  {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                  {copied ? "Copied" : "Copy"}
                </button>

                {hasSources && (
                  <>
                    {/* Inline toggle */}
                    <button
                      onClick={() => setShowInlineSources(!showInlineSources)}
                      className="flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition ml-auto"
                    >
                      <FileText size={11} />
                      {message.sources!.length} sources
                      {showInlineSources ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </button>
                    {/* Full panel button (desktop) */}
                    {onShowSources && (
                      <button
                        onClick={onShowSources}
                        className="hidden lg:flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-200 transition"
                      >
                        Expand
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Inline sources preview */}
            {showInlineSources && message.sources && (
              <div className="mt-3 space-y-2 animate-fade-in">
                {message.sources.map((src, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-2.5"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-brand-600 dark:text-brand-400 truncate">
                        {src.filename}
                      </span>
                      {src.page_number > 0 && (
                        <span className="text-[10px] text-[var(--text-muted)]">p.{src.page_number}</span>
                      )}
                      <span className="text-[10px] text-[var(--text-muted)] uppercase ml-auto">
                        {src.document_type || "doc"}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] font-mono leading-relaxed line-clamp-3">
                      {src.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Strip any residual [Source N] from LLM output for clean display */
function cleanContent(text: string): string {
  return text.replace(/\[Source\s*\d+(?:\s*[,|]\s*Page\s*\d+)?\]/gi, "").replace(/\s{2,}/g, " ");
}

export function safeHref(href?: string) {
  if (!href) return null;
  if (href.startsWith("/") || href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return url.toString();
  } catch {
    return null;
  }
  return null;
}

function SafeMarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safe = safeHref(href);
  if (!safe) {
    return <span>{children}</span>;
  }
  const external = safe.startsWith("http://") || safe.startsWith("https://");
  return (
    <a
      {...props}
      href={safe}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer nofollow" : undefined}
    >
      {children}
    </a>
  );
}

function Badge({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
      {icon}{text}
    </span>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-2 px-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-brand-500 animate-pulse-dot"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </div>
  );
}
