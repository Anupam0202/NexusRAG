"use client";

import { useState, useRef, useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import { setApiKey } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { Key, X, Loader2, CheckCircle2, AlertTriangle, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";

export function ApiKeyModal() {
  const { showApiKeyModal, setShowApiKeyModal, setUserApiKey } = useStore();
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showApiKeyModal) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [showApiKeyModal]);

  const handleSubmit = async () => {
    const trimmed = key.trim();
    if (!trimmed || trimmed.length < 10) {
      toast.error("Please enter a valid API key");
      return;
    }

    setLoading(true);
    try {
      await setApiKey(trimmed);
      setUserApiKey(trimmed);
      setShowApiKeyModal(false);
      setKey("");
      toast.success("API key updated successfully! You can continue chatting.", {
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
    if (e.key === "Escape") setShowApiKeyModal(false);
  };

  return (
    <AnimatePresence>
      {showApiKeyModal && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            onClick={() => setShowApiKeyModal(false)}
          />

          {/* Modal */}
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
          {/* Gradient header accent */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500" />

          {/* Close button */}
          <button
            onClick={() => setShowApiKeyModal(false)}
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all"
          >
            <X size={16} />
          </button>

          <div className="p-6 pt-8">
            {/* Icon */}
            <div className="flex justify-center mb-5">
              <div className="relative">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30">
                  <Key size={24} className="text-amber-500" />
                </div>
                <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 animate-pulse">
                  <AlertTriangle size={10} className="text-white" />
                </div>
              </div>
            </div>

            {/* Title */}
            <h3 className="text-lg font-bold text-center mb-1.5">
              API Quota Exceeded
            </h3>
            <p className="text-sm text-[var(--text-muted)] text-center mb-6 leading-relaxed max-w-sm mx-auto">
              The daily free-tier quota has been reached. Enter your own
              Google API key to continue using the app.
            </p>

            {/* Info box */}
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 px-4 py-3 mb-5">
              <div className="flex items-start gap-2.5">
                <Sparkles size={14} className="text-amber-500 mt-0.5 shrink-0" />
                <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  <p className="font-medium text-amber-600 dark:text-amber-400 mb-1">
                    How to get an API key:
                  </p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>
                      Go to{" "}
                      <a
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-500 hover:underline inline-flex items-center gap-0.5"
                      >
                        Google AI Studio
                        <ExternalLink size={10} />
                      </a>
                    </li>
                    <li>Sign in with your Google account</li>
                    <li>Click &quot;Create API key&quot;</li>
                    <li>Copy and paste it below</li>
                  </ol>
                </div>
              </div>
            </div>

            {/* Input */}
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

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowApiKeyModal(false)}
                disabled={loading}
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || key.trim().length < 10}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Validating...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    Activate Key
                  </>
                )}
              </button>
            </div>

            {/* Privacy note */}
            <p className="text-[10px] text-[var(--text-muted)] text-center mt-4 opacity-70">
              Your API key is sent securely to the server and is never stored permanently.
              It is only used for the current session.
            </p>
          </div>
        </div>
      </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
