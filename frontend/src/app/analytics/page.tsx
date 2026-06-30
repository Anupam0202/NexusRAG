"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAnalytics, getAuditEvents, getSystemStatus, healthCheck } from "@/lib/api";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { useWorkspaceApiAccess } from "@/hooks/useAuthGate";
import type { AnalyticsSummary, AuditEvent, SystemStatusResponse } from "@/types";
import { motion } from "framer-motion";
import {
  RefreshCw, BarChart3, FileText, Database,
  Clock, Target, Activity, CheckCircle2, XCircle,
  Zap, Brain, TrendingUp, MessageSquare,
  HardDrive, Cpu, ShieldCheck, Gauge,
} from "lucide-react";

const AUTO_REFRESH_SECONDS = 30;

export default function AnalyticsPage() {
  const { authMode, canAccessWorkspaceApi, isWorkspaceLoading } = useWorkspaceApiAccess();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditStorage, setAuditStorage] = useState<"memory" | "supabase">("memory");
  const [health, setHealth] = useState<{ status: string; total_chunks: number } | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (isWorkspaceLoading) {
      setLoading(true);
      return;
    }
    if (!canAccessWorkspaceApi) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setCountdown(AUTO_REFRESH_SECONDS);
    try {
      const [a, h, s, audit] = await Promise.all([
        getAnalytics(),
        healthCheck(),
        getSystemStatus(),
        getAuditEvents(8).catch(() => null),
      ]);
      if (signal?.aborted) return;
      setData(a);
      setHealth(h);
      setSystemStatus(s);
      setAuditEvents(audit?.events ?? []);
      if (audit?.storage) setAuditStorage(audit.storage);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [canAccessWorkspaceApi, isWorkspaceLoading]);

  // Initial load
  useEffect(() => {
    if (isWorkspaceLoading) {
      setLoading(true);
      return;
    }
    if (!canAccessWorkspaceApi) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [canAccessWorkspaceApi, isWorkspaceLoading, load]);

  // Auto-refresh every 30 s with visible countdown
  useEffect(() => {
    if (!canAccessWorkspaceApi || isWorkspaceLoading) return;
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          load();
          return AUTO_REFRESH_SECONDS;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [canAccessWorkspaceApi, isWorkspaceLoading, load]);

  const handleRefresh = () => {
    setCountdown(AUTO_REFRESH_SECONDS);
    load();
  };

  const isHealthy = (systemStatus?.status ?? health?.status) === "healthy";
  const capabilities = systemStatus?.capabilities;
  const settings = systemStatus?.settings;
  const memoryConstrained =
    settings?.memory_constrained === true || settings?.use_lightweight_embeddings === true;
  const cacheTotal = (data?.cache_hits ?? 0) + (data?.cache_misses ?? 0);
  const cacheHitRate = cacheTotal > 0 ? Math.round((data!.cache_hits / cacheTotal) * 100) : 0;
  const rerankerLabel = capabilities?.reranking ? "Enabled" : "Disabled";
  const enrichmentLabel = capabilities?.contextual_enrichment ? "Enabled" : "Disabled";
  const chunkingLabel = capabilities?.semantic_chunking ? "Semantic" : "Recursive";
  const cacheLabel = capabilities?.semantic_cache ? "Semantic similarity" : "Disabled";
  const ocrLabel = capabilities?.ocr ? "Text + OCR" : "Text only";
  const vectorStoreLabel =
    settings?.vector_backend === "qdrant"
      ? "Qdrant + BM25"
      : settings?.vector_backend === "local_faiss"
        ? "Local FAISS + BM25"
        : settings?.vector_backend === "pgvector"
          ? "pgvector + BM25"
          : settings?.qdrant_configured
            ? "Qdrant + BM25"
            : settings?.enable_local_faiss
              ? "Local FAISS + BM25"
              : "Not configured";
  const fusionLabel =
    typeof settings?.hybrid_search_alpha === "number"
      ? `RRF, alpha ${settings.hybrid_search_alpha.toFixed(2)}`
      : "RRF";
  const numberFormatter = new Intl.NumberFormat(undefined, { notation: "compact" });
  const totalTokens =
    data?.llm_total_tokens ??
    ((data?.llm_input_tokens ?? 0) + (data?.llm_output_tokens ?? 0));
  const llmCalls = data?.llm_usage_events ?? data?.total_queries ?? 0;
  const auditEventCount = data?.audit_events ?? 0;
  const usageLatency = data?.usage_avg_latency_ms ?? 0;
  const indexedChunkCount = data?.total_chunks ?? health?.total_chunks;
  const lastActivity = data?.last_activity_at
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(data.last_activity_at))
    : "No activity yet";

  if (!canAccessWorkspaceApi) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-8">
          <AuthRequiredState
            authMode={authMode}
            nextPath="/analytics"
            title="Sign in to view analytics"
            description="Analytics, audit events, and workspace usage are only available after sign-in."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-5">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Analytics</h2>
            <p className="text-xs text-[var(--text-muted)]">System performance overview</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Countdown ring */}
            {!loading && (
              <span className="text-[10px] tabular-nums text-[var(--text-muted)] hidden sm:block">
                Auto-refresh in {countdown}s
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] transition disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <XCircle size={16} />
            {error}
          </div>
        )}

        {/* ── Status banner ── */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-gradient-to-r from-brand-500 to-purple-600 p-4 md:p-5 text-white shadow-lg"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 mb-1">
              <Activity size={18} />
              <h3 className="font-semibold">System Status</h3>
            </div>
            {indexedChunkCount !== undefined && (
              <span className="text-xs opacity-70 font-mono">{indexedChunkCount} chunks indexed</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            {loading ? (
              <span className="opacity-90">⏳ Checking…</span>
            ) : isHealthy ? (
              <>
                <CheckCircle2 size={16} className="text-green-200" />
                <span className="opacity-90">
                  {memoryConstrained
                    ? "Operational with Render constrained profile"
                    : "All systems operational"}
                </span>
              </>
            ) : (
              <>
                <XCircle size={16} className="text-red-200" />
                <span className="opacity-90">System unavailable — check backend</span>
              </>
            )}
          </div>
        </motion.div>

        {/* ── Primary metrics grid (6 cards) ── */}
        {loading && !data ? (
          <SkeletonGrid count={6} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCard icon={<BarChart3 size={18} />} label="Total Queries" value={data?.total_queries ?? 0} color="brand" />
            <MetricCard icon={<MessageSquare size={18} />} label="Today" value={data?.queries_today ?? 0} color="indigo" />
            <MetricCard icon={<FileText size={18} />} label="Documents" value={data?.total_documents ?? 0} color="green" />
            <MetricCard icon={<Database size={18} />} label="Chunks" value={data?.total_chunks ?? health?.total_chunks ?? 0} color="purple" />
            <MetricCard
              icon={<Clock size={18} />}
              label="Avg Response"
              value={data?.avg_response_time ? `${data.avg_response_time.toFixed(2)}s` : "—"}
              color="orange"
            />
            <MetricCard
              icon={<Target size={18} />}
              label="Confidence"
              value={data?.avg_confidence ? `${(data.avg_confidence * 100).toFixed(0)}%` : "—"}
              color="blue"
            />
          </div>
        )}

        {/* Runtime usage and audit trail */}
        {/* ── Cache + Model row ── */}
        {!loading && data && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 }}
            className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <ShieldCheck size={15} className="text-emerald-500" />
                Usage & Audit
              </h3>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                (data.llm_error_events ?? 0) > 0
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              }`}>
                {(data.llm_error_events ?? 0) > 0 ? "Attention" : "Clean"}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <UsageStat
                icon={<Brain size={14} />}
                label="LLM Calls"
                value={numberFormatter.format(llmCalls)}
                detail={`${data.llm_cache_hits ?? 0} cached`}
              />
              <UsageStat
                icon={<Gauge size={14} />}
                label="Tokens"
                value={numberFormatter.format(totalTokens)}
                detail={`${numberFormatter.format(data.llm_input_tokens ?? 0)} in / ${numberFormatter.format(data.llm_output_tokens ?? 0)} out`}
              />
              <UsageStat
                icon={<Activity size={14} />}
                label="Latency"
                value={usageLatency ? `${usageLatency}ms` : "-"}
                detail={`${data.llm_fallbacks ?? 0} fallbacks`}
              />
              <UsageStat
                icon={<ShieldCheck size={14} />}
                label="Audit Events"
                value={numberFormatter.format(auditEventCount)}
                detail={lastActivity}
              />
            </div>
          </motion.div>
        )}

        {!loading && data && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.045 }}
            className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <ShieldCheck size={15} className="text-brand-500" />
                  Recent Audit Trail
                </h3>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Sanitized workspace events from the active runtime.
                </p>
              </div>
              <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--text-muted)]">
                {auditStorage}
              </span>
            </div>

            {auditEvents.length > 0 ? (
              <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
                {auditEvents.map((event, index) => (
                  <div
                    key={event.id ?? `${event.action}-${event.created_at ?? index}`}
                    className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--text-primary)]">
                        {formatAuditAction(event.action)}
                      </p>
                      <p className="mt-0.5 truncate text-[var(--text-muted)]">
                        {auditResourceLabel(event)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="whitespace-nowrap font-mono text-[10px] text-[var(--text-muted)]">
                        {formatAuditTime(event.created_at)}
                      </p>
                      <p className="mt-0.5 max-w-32 truncate text-[10px] text-[var(--text-muted)]">
                        {metadataSummary(event.metadata)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-xs text-[var(--text-muted)]">
                Audit events will appear after uploads, chats, settings changes, and API key updates.
              </div>
            )}
          </motion.div>
        )}

        {!loading && data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Cache performance */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-3"
            >
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Zap size={15} className="text-amber-500" />
                Semantic Cache
              </h3>

              {/* Hit rate bar */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs text-[var(--text-muted)]">Hit rate</span>
                  <span className={`text-sm font-bold tabular-nums ${cacheHitRate >= 60 ? "text-green-500" :
                      cacheHitRate >= 30 ? "text-amber-500" : "text-[var(--text-muted)]"
                    }`}>
                    {cacheTotal > 0 ? `${cacheHitRate}%` : "—"}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${cacheHitRate}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className={`h-full rounded-full ${cacheHitRate >= 60 ? "bg-green-500" :
                        cacheHitRate >= 30 ? "bg-amber-500" : "bg-gray-400"
                      }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                  <p className="text-base font-bold text-green-500">{data.cache_hits}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Hits</p>
                </div>
                <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                  <p className="text-base font-bold text-[var(--text-secondary)]">{data.cache_misses}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Misses</p>
                </div>
                <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                  <p className="text-base font-bold text-brand-500">{data.cache_entries}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Entries</p>
                </div>
              </div>

              {cacheTotal === 0 && (
                <p className="text-xs text-[var(--text-muted)] text-center italic">
                  Cache stats populate after the first query
                </p>
              )}
            </motion.div>

            {/* Active model info */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-3"
            >
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Brain size={15} className="text-purple-500" />
                Active Models
              </h3>

              <div className="space-y-2.5">
                <ModelRow
                  icon={<Cpu size={13} className="text-brand-500" />}
                  label="LLM"
                  value={data.llm_model_name || "—"}
                  badge="Primary"
                />
                <ModelRow
                  icon={<TrendingUp size={13} className="text-purple-500" />}
                  label="Embedder"
                  value={data.embedding_model ? data.embedding_model.split("/").pop()! : "—"}
                />
                <ModelRow
                  icon={<HardDrive size={13} className="text-green-500" />}
                  label="Vector Store"
                  value={vectorStoreLabel}
                />
                <ModelRow
                  icon={<Target size={13} className="text-orange-500" />}
                  label="Re-ranker"
                  value={rerankerLabel}
                  badge={capabilities?.reranking ? "Active" : "Off"}
                />
              </div>
            </motion.div>
          </div>
        )}

        {/* ── Pipeline configuration ── */}
        {!loading && data && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4"
          >
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Database size={15} className="text-brand-500" />
              Pipeline Configuration
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <ConfigItem label="Retrieval" value="Hybrid BM25 + Vector" />
              <ConfigItem label="Fusion" value={fusionLabel} />
              <ConfigItem label="Re-ranker" value={rerankerLabel} />
              <ConfigItem label="Chunking" value={chunkingLabel} />
              <ConfigItem label="Enrichment" value={enrichmentLabel} />
              <ConfigItem label="Cache" value={cacheLabel} />
              <ConfigItem label="OCR" value={ocrLabel} />
              <ConfigItem
                label="Query Expansion"
                value={settings?.enable_query_expansion ? "Enabled" : "Disabled"}
              />
              <ConfigItem
                label="Profile"
                value={memoryConstrained ? "Render constrained" : "Full pipeline"}
              />
            </div>
          </motion.div>
        )}

        {/* ── Skeleton for cache + model when loading ── */}
        {loading && !data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 animate-pulse space-y-3">
              <div className="h-4 w-32 rounded bg-[var(--bg-secondary)]" />
              <div className="h-2 w-full rounded-full bg-[var(--bg-secondary)]" />
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-[var(--bg-secondary)]" />)}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 animate-pulse space-y-3">
              <div className="h-4 w-28 rounded bg-[var(--bg-secondary)]" />
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-6 w-full rounded bg-[var(--bg-secondary)]" />)}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

function MetricCard({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: "brand" | "indigo" | "green" | "purple" | "orange" | "blue";
}) {
  const gradients: Record<string, string> = {
    brand: "from-brand-500 to-indigo-600",
    indigo: "from-indigo-500 to-violet-600",
    green: "from-green-500 to-emerald-600",
    purple: "from-purple-500 to-fuchsia-600",
    orange: "from-orange-400 to-red-500",
    blue: "from-blue-500 to-cyan-600",
  };
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={`rounded-xl bg-gradient-to-br ${gradients[color]} p-3 md:p-4 text-white shadow-lg cursor-default`}
    >
      <div className="opacity-80 mb-1">{icon}</div>
      <p className="text-xl md:text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] opacity-80 leading-tight mt-0.5">{label}</p>
    </motion.div>
  );
}

function ModelRow({
  icon, label, value, badge,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] shrink-0">
        {icon}
        {label}
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs font-medium text-[var(--text-primary)] truncate font-mono">{value}</span>
        {badge && (
          <span className={`shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300`}>
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

function UsageStat({
  icon, label, value, detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--bg-secondary)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]">
        <span className="text-brand-500">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">{detail}</p>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)] mb-0.5">{label}</p>
      <p className="font-medium text-sm">{value}</p>
    </div>
  );
}

function formatAuditAction(action: string) {
  return action
    .split(".")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAuditTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function auditResourceLabel(event: AuditEvent) {
  if (!event.resource_type) return "workspace";
  return event.resource_id
    ? `${event.resource_type} - ${event.resource_id}`
    : event.resource_type;
}

function metadataSummary(metadata: Record<string, unknown>) {
  const keys = Object.keys(metadata);
  if (keys.length === 0) return "no metadata";
  return keys.slice(0, 3).join(", ");
}

function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl bg-[var(--bg-secondary)] p-3 md:p-4 animate-pulse">
          <div className="h-5 w-5 rounded bg-[var(--bg-hover)] mb-2" />
          <div className="h-7 w-14 rounded bg-[var(--bg-hover)] mb-1" />
          <div className="h-3 w-10 rounded bg-[var(--bg-hover)]" />
        </div>
      ))}
    </div>
  );
}
