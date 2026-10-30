"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "@/components/layout/StaticLink";
import { Activity, AlertTriangle, ArrowLeft, Gauge, KeyRound, Loader2, ReceiptText, Zap } from "lucide-react";
import { getAnalytics, getApiKeyStatus, getBillingUsage, getSystemStatus } from "@/lib/api";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { useStore } from "@/hooks/useStore";
import { useWorkspaceApiAccess } from "@/hooks/useAuthGate";
import type {
  AnalyticsSummary,
  ApiKeyStatusResponse,
  BillingUsageResponse,
  SystemStatusResponse,
} from "@/types";

export default function BillingOrUsagePage() {
  const identity = useStore((state) => JSON.stringify([state.authMode, state.authUser?.id, state.workspaceId]));
  return <WorkspaceUsage key={identity} />;
}

function WorkspaceUsage() {
  const { authMode, canAccessWorkspaceApi, isWorkspaceLoading, workspaceId } = useWorkspaceApiAccess();
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatusResponse | null>(null);
  const [billing, setBilling] = useState<BillingUsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isWorkspaceLoading) {
      setLoading(true);
      return;
    }
    if (!canAccessWorkspaceApi) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const context = { workspaceId };
    Promise.all([
      getAnalytics(context),
      getSystemStatus(context),
      getApiKeyStatus(context).catch(() => null),
      getBillingUsage(context),
    ])
      .then(([analyticsData, systemStatus, apiKey, billingUsage]) => {
        if (cancelled) return;
        setAnalytics(analyticsData);
        setStatus(systemStatus);
        setKeyStatus(apiKey);
        setBilling(billingUsage);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load usage");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canAccessWorkspaceApi, isWorkspaceLoading, workspaceId]);

  const totalTokens = analytics?.usage_tokens_today;
  const quota = analytics?.quota;
  const tokenLimit = quota?.limits?.daily_tokens ?? status?.settings.quota_daily_tokens;
  const queryLimit = quota?.limits?.daily_queries ?? status?.settings.quota_daily_queries;
  const documentLimit = quota?.limits?.max_documents ?? status?.settings.quota_max_documents;
  const storageLimit = quota?.limits?.max_storage_bytes ??
    (status?.settings.quota_max_storage_mb === undefined ? undefined : status.settings.quota_max_storage_mb * 1024 * 1024);
  const usagePercent = totalTokens === undefined || tokenLimit === undefined ? undefined : Math.min(100, Math.round((totalTokens / Math.max(tokenLimit, 1)) * 100));
  const displayCount = (value: number | undefined) => value === undefined ? "Not measured" : value.toLocaleString();
  const avgLatency = analytics?.usage_avg_latency_ms;
  const fallbackCount = analytics?.llm_fallbacks;
  const failedCalls = analytics?.llm_error_events;
  const byokActive = keyStatus?.workspace_key_configured === true;
  const vectorBackend = deriveVectorBackendLabel(status);
  const providerHealth = status?.provider_health ?? [];
  const estimatedCostMicrousd = billing?.totals.estimated_cost_microusd;
  const estimatedCost = estimatedCostMicrousd == null
    ? "Unknown"
    : `$${(estimatedCostMicrousd / 1_000_000).toFixed(4)}`;

  const posture = useMemo(() => {
    if ((fallbackCount ?? 0) > 0 || (failedCalls ?? 0) > 0) return "Needs attention";
    if (usagePercent !== undefined && usagePercent >= 80) return "Approaching configured budget";
    if (failedCalls === undefined || fallbackCount === undefined || usagePercent === undefined) return "Usage posture not verified";
    return "Within configured budget";
  }, [failedCalls, fallbackCount, usagePercent]);

  if (!canAccessWorkspaceApi) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-8">
          <AuthRequiredState
            authMode={authMode}
            nextPath="/settings/billing-or-usage"
            title="Sign in to view usage"
            description="Usage, quota posture, and provider status are scoped to your workspace."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
        <Link
          href="/settings"
          className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft size={15} />
          Settings
        </Link>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Billing & Usage</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Workspace quota posture, provider health, and cost signals.
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold">
            {posture}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 size={16} className="animate-spin" />
            Loading usage
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
            {error}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <UsageCard icon={<Zap size={16} />} label="LLM tokens" value={displayCount(totalTokens)} detail={usagePercent === undefined ? "Daily budget not verified" : `${usagePercent}% of configured daily budget`} />
              <UsageCard icon={<Activity size={16} />} label="LLM calls" value={displayCount(analytics?.llm_usage_events)} detail={`${displayCount(analytics?.queries_today)} queries today`} />
              <UsageCard icon={<Gauge size={16} />} label="Avg latency" value={avgLatency === undefined ? "Not measured" : `${avgLatency}ms`} detail={`${displayCount(analytics?.llm_successful_events)} successful calls`} />
              <UsageCard icon={<AlertTriangle size={16} />} label="Fallbacks" value={displayCount(fallbackCount)} detail={`${displayCount(failedCalls)} provider errors`} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <QuotaMeter
                label="Daily queries"
                used={quota?.usage?.queries_today ?? analytics?.queries_today}
                limit={queryLimit}
              />
              <QuotaMeter
                label="Daily tokens"
                used={quota?.usage?.tokens_today ?? totalTokens}
                limit={tokenLimit}
              />
              <QuotaMeter
                label="Documents"
                used={quota?.usage?.documents ?? analytics?.total_documents}
                limit={documentLimit}
              />
              <QuotaMeter
                label="Storage"
                used={quota?.usage?.storage_bytes}
                limit={storageLimit}
                formatter={formatBytesShort}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <StatusPanel label="Provider key" value={!keyStatus ? "Key status unavailable" : byokActive ? "Your BYOK configured" : keyStatus.server_key_configured ? "Server key configured" : "No key configured"} />
              <StatusPanel label="Vector backend" value={vectorBackend} />
              <StatusPanel label="Cache hits" value={analytics?.measurement_states?.cache === "DISABLED" ? "Disabled" : displayCount(analytics?.llm_cache_hits ?? analytics?.cache_hits)} />
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ReceiptText size={16} className="text-brand-500" />
                  <p className="text-sm font-semibold">Durable usage ledger</p>
                </div>
                <span className="text-xs font-semibold text-[var(--text-muted)]">
                  {billing?.storage === "supabase" ? "Reconciled in Supabase" : "Runtime only"}
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <StatusPanel label="Reconciled calls" value={displayCount(billing?.totals.query_count)} />
                <StatusPanel label="Reconciled tokens" value={displayCount(billing?.totals.total_tokens)} />
                <StatusPanel label="Estimated cost" value={estimatedCost} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">
                Unknown means at least one provider call has no reconciled price. Account-key (BYOK) calls are billed by Google to the key&apos;s project owner and are not a verified NexusRAG cost.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <p className="text-sm font-semibold">Provider Health</p>
              {providerHealth.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {providerHealth.map((item, index) => (
                    <div
                      key={`${item.provider}-${item.model}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--bg-secondary)] px-3 py-2 text-xs"
                    >
                      <span className="font-semibold">{item.provider} / {item.model}</span>
                      <span className={item.circuit_open ? "text-red-600 dark:text-red-300" : "text-emerald-600 dark:text-emerald-300"}>
                        {item.circuit_open ? "Circuit open" : "Available"}
                        {item.quota_exhausted ? " - quota exhausted" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                  Provider readiness has not been verified. Missing health observations do not establish availability.
                </p>
              )}
            </div>

            <Link
              href="/settings/api-keys"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500"
            >
              <KeyRound size={16} />
              Manage provider keys
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytesShort(value: number) {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function deriveVectorBackendLabel(status: SystemStatusResponse | null) {
  const settings = status?.settings;
  if (!settings) return "unknown";
  if (settings.vector_backend) return settings.vector_backend;
  if (settings.qdrant_configured || settings.enable_qdrant) {
    return settings.enable_local_faiss ? "qdrant+local_faiss" : "qdrant";
  }
  if (settings.enable_pgvector_fallback) return "pgvector";
  if (settings.enable_local_faiss) return "local_faiss";
  return "unknown";
}

function QuotaMeter({
  label,
  used,
  limit,
  formatter = (value: number) => value.toLocaleString(),
}: {
  label: string;
  used?: number;
  limit?: number;
  formatter?: (value: number) => string;
}) {
  const percent = used === undefined || limit === undefined ? undefined : limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : used > 0 ? 100 : 0;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-[var(--text-muted)]">{percent === undefined ? "Not verified" : `${percent}%`}</p>
      </div>
      <div className="h-2 rounded-full bg-[var(--bg-secondary)]">
        <div className="h-2 rounded-full bg-brand-500" style={{ width: `${percent ?? 0}%` }} />
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        {used === undefined ? "Usage not measured" : formatter(used)} / {limit === undefined ? "Limit not configured" : formatter(limit)}
      </p>
    </div>
  );
}

function UsageCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
        <span className="text-brand-500">{icon}</span>
        {label}
      </div>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{detail}</p>
    </div>
  );
}

function StatusPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <p className="text-xs font-semibold text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold">{value}</p>
    </div>
  );
}
