"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSettings, getSystemStatus, updateSettings } from "@/lib/api";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { useWorkspaceApiAccess } from "@/hooks/useAuthGate";
import type { AppSettings, SettingsUpdate, SystemStatusResponse } from "@/types";
import { toast } from "sonner";
import {
  ArrowRight,
  Building2,
  Gauge,
  KeyRound,
  Loader2,
  Save,
  Settings2,
  ShieldCheck,
  ShieldEllipsis,
  UsersRound,
} from "lucide-react";
import { useStore } from "@/hooks/useStore";

export default function SettingsPage() {
  const { authMode, canAccessWorkspaceApi } = useWorkspaceApiAccess();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse | null>(null);
  const [draft, setDraft] = useState<SettingsUpdate>({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const workspaceId = useStore((state) => state.workspaceId);
  const setWorkspaceId = useStore((state) => state.setWorkspaceId);

  useEffect(() => {
    if (!canAccessWorkspaceApi) return;
    let cancelled = false;
    Promise.all([getSettings(), getSystemStatus().catch(() => null)])
      .then(([s, status]) => {
        if (cancelled) return;
        setSettings(s);
        setSystemStatus(status);
        setLoadError(null);
        setDraft({
          llm_temperature: s.llm_temperature,
          retrieval_top_k: s.retrieval_top_k,
          enable_reranking: s.enable_reranking,
          hybrid_search_alpha: s.hybrid_search_alpha,
          context_window_messages: s.context_window_messages,
          enable_semantic_chunking: s.enable_semantic_chunking,
          enable_contextual_enrichment: s.enable_contextual_enrichment,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load settings";
        setLoadError(message);
        toast.error(message);
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessWorkspaceApi]);

  const save = async () => {
    if (!canAccessWorkspaceApi) return;
    setSaving(true);
    try {
      const updated = await updateSettings(draft);
      setSettings(updated);
      getSystemStatus().then(setSystemStatus).catch(() => {});
      toast.success("Settings saved successfully");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (!canAccessWorkspaceApi) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-8">
          <AuthRequiredState
            authMode={authMode}
            nextPath="/settings"
            title="Sign in to manage settings"
            description="Runtime settings and workspace configuration are protected by your account session."
          />
        </div>
      </div>
    );
  }

  if (!settings) {
    if (loadError) {
      return (
        <div className="h-full overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-8">
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
              <h2 className="text-base font-bold">Settings unavailable</h2>
              <p className="mt-2 text-sm leading-6">{loadError}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
                >
                  Retry
                </button>
                <Link
                  href="/auth/login?next=/settings"
                  className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-900 dark:bg-transparent dark:text-red-200 dark:hover:bg-red-950/30"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] text-sm gap-2">
        <Loader2 size={20} className="animate-spin" />
        Loading settings…
      </div>
    );
  }

  const memoryConstrained =
    systemStatus?.settings.memory_constrained === true ||
    systemStatus?.settings.use_lightweight_embeddings === true;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
        <div className="flex items-center gap-2">
          <Settings2 size={20} className="text-brand-500" />
          <h2 className="text-lg font-bold">Runtime Settings</h2>
        </div>

        {memoryConstrained && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            Render constrained profile is active. Memory-heavy retrieval options stay locked off.
          </div>
        )}

        <Link
          href="/settings/api-keys"
          className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 transition hover:bg-[var(--bg-hover)]"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <KeyRound size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Provider API Keys</span>
              <span className="block truncate text-xs text-[var(--text-muted)]">
                Manage workspace-scoped Gemini BYOK status
              </span>
            </span>
          </span>
          <ArrowRight size={16} className="shrink-0 text-[var(--text-muted)]" />
        </Link>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/workspaces"
            className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 transition hover:bg-[var(--bg-hover)]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                <Building2 size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Workspaces</span>
                <span className="block truncate text-xs text-[var(--text-muted)]">
                  Switch or create tenant contexts
                </span>
              </span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-[var(--text-muted)]" />
          </Link>

          <Link
            href="/settings/members"
            className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 transition hover:bg-[var(--bg-hover)]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <UsersRound size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Members</span>
                <span className="block truncate text-xs text-[var(--text-muted)]">
                  Review workspace access
                </span>
              </span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-[var(--text-muted)]" />
          </Link>

          <Link
            href="/settings/billing-or-usage"
            className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 transition hover:bg-[var(--bg-hover)]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                <Gauge size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Usage</span>
                <span className="block truncate text-xs text-[var(--text-muted)]">
                  Quotas and provider posture
                </span>
              </span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-[var(--text-muted)]" />
          </Link>

          <Link
            href="/settings/security"
            className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 transition hover:bg-[var(--bg-hover)]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                <ShieldEllipsis size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Account Security</span>
                <span className="block truncate text-xs text-[var(--text-muted)]">
                  OAuth identities and session controls
                </span>
              </span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-[var(--text-muted)]" />
          </Link>

          <Link
            href="/settings/privacy"
            className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 transition hover:bg-[var(--bg-hover)]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
                <ShieldCheck size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Privacy</span>
                <span className="block truncate text-xs text-[var(--text-muted)]">
                  Clear workspace-scoped data
                </span>
              </span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-[var(--text-muted)]" />
          </Link>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-6">
          <div className="mb-3 flex items-center gap-2">
            <Building2 size={17} className="text-brand-500" />
            <h3 className="text-sm font-semibold">Workspace Context</h3>
          </div>
          <input
            type="text"
            value={workspaceId ?? ""}
            onChange={(event) => setWorkspaceId(event.target.value || null)}
            placeholder="Workspace UUID"
            spellCheck={false}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
            API requests include this workspace when enterprise auth is enabled.
          </p>
        </div>

        <div className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-6">
          <Slider label="Temperature" desc="0 = factual, 1 = creative"
            value={draft.llm_temperature ?? settings.llm_temperature} min={0} max={1} step={0.05}
            onChange={(v) => setDraft((d) => ({ ...d, llm_temperature: v }))} />

          <Slider label="Retrieval Top K" desc="Chunks retrieved per query"
            value={draft.retrieval_top_k ?? settings.retrieval_top_k} min={1} max={50} step={1}
            onChange={(v) => setDraft((d) => ({ ...d, retrieval_top_k: v }))} />

          <Slider label="Hybrid Alpha" desc="0 = keyword, 1 = semantic"
            value={draft.hybrid_search_alpha ?? settings.hybrid_search_alpha} min={0} max={1} step={0.05}
            onChange={(v) => setDraft((d) => ({ ...d, hybrid_search_alpha: v }))} />

          <Slider label="Context Window" desc="Recent messages sent to LLM"
            value={draft.context_window_messages ?? settings.context_window_messages} min={1} max={30} step={1}
            onChange={(v) => setDraft((d) => ({ ...d, context_window_messages: v }))} />

          <Toggle
            label="Re-ranking"
            desc={memoryConstrained ? "Locked off on this backend profile" : "Cross-encoder re-scoring"}
            checked={memoryConstrained ? false : draft.enable_reranking ?? settings.enable_reranking}
            disabled={memoryConstrained}
            onChange={(checked) => setDraft((d) => ({ ...d, enable_reranking: checked }))}
          />

          <Toggle
            label="Semantic Chunking"
            desc={memoryConstrained ? "Locked off on this backend profile" : "Embedding-aware split points for long text"}
            checked={memoryConstrained ? false : draft.enable_semantic_chunking ?? settings.enable_semantic_chunking}
            disabled={memoryConstrained}
            onChange={(checked) => setDraft((d) => ({ ...d, enable_semantic_chunking: checked }))}
          />

          <Toggle
            label="Contextual Enrichment"
            desc={memoryConstrained ? "Locked off on this backend profile" : "LLM-generated chunk context before embedding"}
            checked={memoryConstrained ? false : draft.enable_contextual_enrichment ?? settings.enable_contextual_enrichment}
            disabled={memoryConstrained}
            onChange={(checked) => setDraft((d) => ({ ...d, enable_contextual_enrichment: checked }))}
          />

          <hr className="border-[var(--border)]" />

          {/* Read-only info */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Info label="Model" value={settings.llm_model_name} />
            <Info label="Embedding" value={settings.embedding_model.split("/").pop() ?? ""} />
            <Info
              label="Vector Store"
              value={systemStatus?.settings.vector_backend ?? "local_faiss"}
            />
            <Info
              label="Qdrant"
              value={
                systemStatus?.settings.qdrant_configured
                  ? systemStatus.settings.qdrant_collection ?? "configured"
                  : systemStatus?.settings.enable_qdrant
                    ? "missing configuration"
                  : "disabled"
              }
            />
            <Info label="Chunk Size" value={`${settings.chunk_size}`} />
            <Info label="Chunk Overlap" value={`${settings.chunk_overlap}`} />
          </div>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 text-white px-5 py-2.5 text-sm font-semibold shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 w-full sm:w-auto justify-center"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

function Slider({ label, desc, value, min, max, step, onChange }: {
  label: string; desc: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-[var(--text-muted)]">{desc}</p>
        </div>
        <span className="text-sm font-semibold text-brand-600 dark:text-brand-400 tabular-nums bg-brand-50 dark:bg-brand-900/30 px-2 py-0.5 rounded-md">
          {Number.isInteger(step) ? value : value.toFixed(2)}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-gray-200 dark:bg-gray-700 accent-brand-500 cursor-pointer" />
    </div>
  );
}

function Toggle({ label, desc, checked, disabled = false, onChange }: {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-[var(--text-muted)]">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition ${
          checked ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-600"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : ""
        }`} />
      </button>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="font-medium text-sm truncate">{value}</p>
    </div>
  );
}
