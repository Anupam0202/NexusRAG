"use client";

import { useState, useRef, useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import { setApiKey } from "@/lib/api";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Key, X, Loader2, CheckCircle2, AlertTriangle, ExternalLink, Sparkles, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export function ApiKeyModal() {
  const show = useStore(state => state.showApiKeyModal);
  const identity = useStore(state => JSON.stringify([state.authMode, state.authUser?.id, state.workspaceId]));
  return show ? <AccountApiKeyModal key={identity} /> : null;
}
function AccountApiKeyModal() {
  const setShowApiKeyModal = useStore(state => state.setShowApiKeyModal);
  const setUserApiKey = useStore(state => state.setUserApiKey);
  const isQuotaBlocked = useStore(state => state.isQuotaBlocked);
  const setIsQuotaBlocked = useStore(state => state.setIsQuotaBlocked);
  const userId = useStore(state => state.authUser?.id);
  const authMode = useStore(state => state.authMode);
  const workspaceId = useStore(state => state.workspaceId);
  const canActivate = authMode === "authenticated" && !!userId && !!workspaceId;
  const reducedMotion = useReducedMotion();
  const alive = useRef(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [key, setKey] = useState("");
  const [costConsentAccepted, setCostConsentAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.querySelectorAll<HTMLElement>("aside, header, main"))
      .filter(element => !element.contains(dialogRef.current) && !dialogRef.current?.contains(element));
    const inertStates = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    inputRef.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowApiKeyModal(false); // Dismissal never clears quota enforcement.
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]'
      ) ?? []).sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialogRef.current?.focus(); return; }
      if (!dialogRef.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", trap, true);
    return () => {
      alive.current = false;
      document.removeEventListener("keydown", trap, true);
      background.forEach((element, index) => { element.inert = inertStates[index]; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [setShowApiKeyModal]);

  const handleClose = () => setShowApiKeyModal(false);

  const handleSubmit = async () => {
    if (!canActivate || loading) return;
    const trimmed = key.trim();
    if (!trimmed || trimmed.length < 10) {
      toast.error("Please enter a valid API key");
      return;
    }
    if (!costConsentAccepted) {
      toast.error("Review and accept the Google billing notice before activating this key");
      return;
    }
    setLoading(true);
    try {
      const result = await setApiKey(trimmed, costConsentAccepted, { workspaceId, expectedUserId: userId });
      if (!alive.current) return;
      setUserApiKey(result.key_fingerprint ?? "configured");
      setIsQuotaBlocked(false);
      setShowApiKeyModal(false);
      setKey("");
      setCostConsentAccepted(false);
      toast.success("API key configured — workspace processing approvals still apply", {
        icon: <CheckCircle2 size={18} />,
        duration: 4000,
      });
    } catch (err: unknown) {
      if (!alive.current) return;
      const msg = err instanceof Error ? err.message : "Failed to set API key";
      toast.error(msg, { icon: <AlertTriangle size={18} /> });
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) handleSubmit();

  };

  return (
    <AnimatePresence>
      {(
        <>
          {/* Dismissible without changing server quota authority. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
            onClick={handleClose}
          />

          <motion.div
            initial={reducedMotion ? false : { opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-4"
            onClick={event => { if (event.target === event.currentTarget) handleClose(); }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="apikey-title"
              tabIndex={-1}
              className="relative max-h-[90dvh] overflow-y-auto w-full max-w-md rounded-2xl bg-[var(--bg-primary)] border border-[var(--border)] shadow-2xl"
            >
              {/* Top accent bar — red when quota-blocked, amber otherwise */}
              <div className={`absolute top-0 left-0 right-0 h-1 ${isQuotaBlocked
                  ? "bg-linear-to-r/srgb from-red-500 via-rose-500 to-orange-500"
                  : "bg-linear-to-r/srgb from-amber-500 via-orange-500 to-red-500"
                }`} />

              {/* Read-only workflows remain available without accepting paid processing. */}
              {(
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
                <h3 id="apikey-title" className="text-lg font-bold text-center mb-1.5">
                  {isQuotaBlocked ? "Processing quota unavailable" : "Add your Gemini API key"}
                </h3>

                {/* Description */}
                <p className="text-sm text-[var(--text-muted)] text-center mb-4 leading-relaxed max-w-sm mx-auto">
                  {isQuotaBlocked
                    ? "This action needs available processing quota and workspace approval. You may dismiss this dialog and continue using permitted read-only workflows."
                    : "Connect your own Gemini API key to process additional documents and continue chatting."}
                </p>

                {/* Mandatory notice banner (quota-blocked only) */}
                {isQuotaBlocked && (
                  <div className="rounded-xl bg-red-500/5 border border-red-500/20 px-4 py-3 mb-4">
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium text-center">
                      A user-funded key can incur charges and does not override workspace privacy, rights, capacity or owner approval requirements.
                    </p>
                  </div>
                )}

                {/* How-to panel */}
                <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 px-4 py-3 mb-5">
                  <div className="flex items-start gap-2.5">
                    <Sparkles size={14} className="text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                          <p className="font-medium text-amber-600 dark:text-amber-400 mb-1">Get a Gemini API key:</p>
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
                        <li>Click &quot;Create API key&quot; (create or select a Google Cloud project as prompted)</li>
                        <li>Copy the key and paste it below</li>
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
                    aria-label="Gemini API key"
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
                  {/* Consent is optional: cancellation never waives quotas. */}
                  {(
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
                    disabled={!canActivate || loading || key.trim().length < 10 || !costConsentAccepted}
                    className={`flex items-center justify-center gap-2 rounded-xl bg-linear-to-r/srgb from-brand-500 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${isQuotaBlocked ? "w-full" : "flex-1"
                      }`}
                  >
                    {loading ? (
                      <><Loader2 size={14} className="animate-spin" /> Validating…</>
                    ) : (
                      <><CheckCircle2 size={14} /> Activate Key</>
                    )}
                  </button>
                </div>

                <label className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-left text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                  <input
                    type="checkbox"
                    checked={costConsentAccepted}
                    onChange={(event) => setCostConsentAccepted(event.target.checked)}
                    disabled={loading}
                    className="mt-0.5"
                  />
                  <span>
                    I understand this API key is billed under its Google project. Google may charge the key owner if free-tier limits are exceeded or billing is enabled; NexusRAG cannot guarantee zero Google charges. I have reviewed that project&apos;s quotas and billing settings.
                  </span>
                </label>
                <p className="text-[10px] text-[var(--text-muted)] text-center mt-3">
                  Key configuration requires a signed-in account and selected workspace. The server validates and encrypts accepted keys; the key is not shown again.
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
