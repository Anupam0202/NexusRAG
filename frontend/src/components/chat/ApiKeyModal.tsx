"use client";

import { useState, useRef, useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import { setApiKey } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { Key, X, Loader2, CheckCircle2, AlertTriangle, ExternalLink, Sparkles, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export function ApiKeyModal() {
  const { showApiKeyModal, setShowApiKeyModal, setUserApiKey, isQuotaBlocked, setIsQuotaBlocked } = useStore();
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showApiKeyModal) setTimeout(() => inputRef.current?.focus(), 150);
  }, [showApiKeyModal]);

  // When quota-blocked, trap Escape so it cannot close the modal
  useEffect(() => {
    if (!showApiKeyModal || !isQuotaBlocked) return;
    const trap = (e: KeyboardEvent) => { if (e.key === "Escape") e.preventDefault(); };
    document.addEventListener("keydown", trap, true);
    return () => document.removeEventListener("keydown", trap, true);
  }, [showApiKeyModal, isQuotaBlocked]);

  const handleClose = () => {
    if (isQuotaBlocked) return; // blocked — must submit a key
    setShowApiKeyModal(false);
    setKey("");
  };

  const handleSubmit = async () => {
    const trimmed = key.trim();
    if (!trimmed || trimmed.length < 10) {
      toast.error("Please enter a valid API key");
      return;
    }
    setLoading(true);
    try {
      const result = await setApiKey(trimmed);
      setUserApiKey(result.key_fingerprint ?? "configured");
      setIsQuotaBlocked(false);
      setShowApiKeyModal(false);
      setKey("");
      toast.success("API key updated — you can continue chatting!", {
        icon: <CheckCircle2 size={18} />,
        duration: 4000,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to set API key";
      toast.error(msg, { icon: <AlertTriangle size={18} /> });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) handleSubmit();
    if (e.key === "Escape" && !isQuotaBlocked) handleClose();
  };

  return (
    <AnimatePresence>
      {showApiKeyModal && (
        <>
          {/* Backdrop — non-clickable when quota-blocked */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
            onClick={isQuotaBlocked ? undefined : handleClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-4"
          >
            <div
              className="relative w-full max-w-md rounded-2xl bg-[var(--bg-primary)] border border-[var(--border)] shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top accent bar — red when quota-blocked, amber otherwise */}
              <div className={`absolute top-0 left-0 right-0 h-1 ${isQuotaBlocked
                  ? "bg-gradient-to-r from-red-500 via-rose-500 to-orange-500"
                  : "bg-gradient-to-r from-amber-500 via-orange-500 to-red-500"
                }`} />

              {/* Close button — hidden when quota-blocked */}
              {!isQuotaBlocked && (
                <button
                  onClick={handleClose}
                  aria-label="Close"
                  className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all"
                >
                  <X size={16} />
                </button>
              )}

              <div className="p-6 pt-8">
                {/* Icon */}
                <div className="flex justify-center mb-5">
                  <div className="relative">
                    <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${isQuotaBlocked
                        ? "bg-red-500/10 border-red-500/30"
                        : "bg-amber-500/10 border-amber-500/30"
                      }`}>
                      {isQuotaBlocked
                        ? <ShieldAlert size={24} className="text-red-500" />
                        : <Key size={24} className="text-amber-500" />
                      }
                    </div>
                    <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 animate-pulse">
                      <AlertTriangle size={10} className="text-white" />
                    </div>
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-lg font-bold text-center mb-1.5">
                  {isQuotaBlocked ? "Quota Exceeded — Action Required" : "API Quota Exceeded"}
                </h3>

                {/* Description */}
                <p className="text-sm text-[var(--text-muted)] text-center mb-4 leading-relaxed max-w-sm mx-auto">
                  {isQuotaBlocked
                    ? "The free-tier quota has been reached. You must provide your own Google API key to continue using the chat."
                    : "The daily free-tier quota has been reached. Enter your own Google API key to continue."}
                </p>

                {/* Mandatory notice banner (quota-blocked only) */}
                {isQuotaBlocked && (
                  <div className="rounded-xl bg-red-500/5 border border-red-500/20 px-4 py-3 mb-4">
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium text-center">
                      Chat is unavailable without an API key. Providing your key takes 30 seconds.
                    </p>
                  </div>
                )}

                {/* How-to panel */}
                <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 px-4 py-3 mb-5">
                  <div className="flex items-start gap-2.5">
                    <Sparkles size={14} className="text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      <p className="font-medium text-amber-600 dark:text-amber-400 mb-1">How to get a free API key:</p>
                      <ol className="list-decimal list-inside space-y-0.5">
                        <li>
                          Go to{" "}
                          <a
                            href="https://aistudio.google.com/apikey"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-500 hover:underline inline-flex items-center gap-0.5"
                          >
                            Google AI Studio <ExternalLink size={10} />
                          </a>
                        </li>
                        <li>Sign in with your Google account</li>
                        <li>Click &quot;Create API key&quot;</li>
                        <li>Copy and paste it below</li>
                      </ol>
                    </div>
                  </div>
                </div>

                {/* Key input */}
                <div className="relative mb-4">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none">
                    <Key size={14} className="text-[var(--text-muted)]" />
                  </div>
                  <input
                    ref={inputRef}
                    type={showKey ? "text" : "password"}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="AIza..."
                    disabled={loading}
                    autoComplete="off"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] pl-10 pr-16 py-3 text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 disabled:opacity-50 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  {/* Cancel only shown when NOT quota-blocked */}
                  {!isQuotaBlocked && (
                    <button
                      onClick={handleClose}
                      disabled={loading}
                      className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-all disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={handleSubmit}
                    disabled={loading || key.trim().length < 10}
                    className={`flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${isQuotaBlocked ? "w-full" : "flex-1"
                      }`}
                  >
                    {loading ? (
                      <><Loader2 size={14} className="animate-spin" /> Validating…</>
                    ) : (
                      <><CheckCircle2 size={14} /> Activate Key</>
                    )}
                  </button>
                </div>

                <p className="text-[10px] text-[var(--text-muted)] text-center mt-4 opacity-70">
                  Your browser forgets the raw key after submit. The backend stores only an encrypted workspace key.
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
