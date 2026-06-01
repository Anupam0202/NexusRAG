"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { deleteApiKey, getApiKeyStatus, setApiKey } from "@/lib/api";
import type { ApiKeyStatusResponse } from "@/types";
import { useStore } from "@/hooks/useStore";

export default function ApiKeysPage() {
  const [status, setStatus] = useState<ApiKeyStatusResponse | null>(null);
  const [apiKey, setApiKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setUserApiKey = useStore((state) => state.setUserApiKey);
  const setIsQuotaBlocked = useStore((state) => state.setIsQuotaBlocked);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextStatus = await getApiKeyStatus();
      setStatus(nextStatus);
      setUserApiKey(nextStatus.key_fingerprint);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load API key status");
    } finally {
      setLoading(false);
    }
  }, [setUserApiKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const createdAt = status?.created_at
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(status.created_at))
    : "Not configured";

  const activate = async () => {
    const trimmed = apiKey.trim();
    if (trimmed.length < 10) {
      toast.error("Enter a valid provider key");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nextStatus = await setApiKey(trimmed);
      setStatus(nextStatus);
      setUserApiKey(nextStatus.key_fingerprint);
      setIsQuotaBlocked(false);
      setApiKeyValue("");
      setShowKey(false);
      toast.success("Workspace API key activated");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to activate API key";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    setError(null);
    try {
      const nextStatus = await deleteApiKey();
      setStatus(nextStatus);
      setUserApiKey(null);
      toast.success("Workspace API key removed");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to remove API key";
      setError(message);
      toast.error(message);
    } finally {
      setRemoving(false);
    }
  };

  const hasWorkspaceKey = status?.workspace_key_configured === true;
  const hasServerKey = status?.server_key_configured === true;
  const effectiveMode = hasWorkspaceKey
    ? "Workspace BYOK"
    : hasServerKey
      ? "Server default"
      : "Extractive fallback";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-5 md:px-6 md:py-7 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound size={20} className="text-brand-500" />
              <h2 className="text-lg font-bold">API Keys</h2>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Workspace-scoped Gemini key management with masked status and audit logging.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--bg-hover)] disabled:opacity-60"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                hasWorkspaceKey
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              }`}>
                {hasWorkspaceKey ? <ShieldCheck size={23} /> : <KeyRound size={23} />}
              </div>
              <div>
                <p className="text-sm font-bold">{effectiveMode}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {status?.workspace_id ?? "Workspace loading"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[520px]">
              <StatusTile label="Provider" value={status?.provider ?? "gemini"} />
              <StatusTile label="Workspace key" value={hasWorkspaceKey ? "Active" : "None"} />
              <StatusTile label="Server key" value={hasServerKey ? "Available" : "Missing"} />
              <StatusTile label="Storage" value={status?.storage ?? "memory"} />
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Activate Workspace Key</h3>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  The raw key is sent once for validation and never rendered back.
                </p>
              </div>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                AI Studio
                <ExternalLink size={12} />
              </a>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-[var(--text-muted)]">Gemini API key</span>
                <div className="relative mt-1">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => setApiKeyValue(event.target.value)}
                    placeholder="AIza..."
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-3 pr-12 text-sm outline-none focus:border-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((value) => !value)}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              <button
                type="button"
                onClick={activate}
                disabled={saving || apiKey.trim().length < 10}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-60 sm:w-auto"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {saving ? "Validating" : hasWorkspaceKey ? "Replace Key" : "Activate Key"}
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">
            <h3 className="text-sm font-bold">Current Key</h3>
            <div className="mt-4 space-y-3">
              <KeyValue label="Fingerprint" value={status?.key_fingerprint ?? "Not configured"} mono />
              <KeyValue label="Created" value={createdAt} />
              <KeyValue label="Effective mode" value={effectiveMode} />
            </div>

            <button
              type="button"
              onClick={remove}
              disabled={!hasWorkspaceKey || removing}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300 dark:hover:bg-red-950/30"
            >
              {removing ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              {removing ? "Removing" : "Remove Workspace Key"}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg-secondary)] px-3 py-3">
      <p className="text-[10px] font-bold uppercase text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 truncate text-sm font-bold">{value}</p>
    </div>
  );
}

function KeyValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl bg-[var(--bg-secondary)] px-3 py-3">
      <p className="text-[10px] font-bold uppercase text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 break-words text-sm font-semibold ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}
