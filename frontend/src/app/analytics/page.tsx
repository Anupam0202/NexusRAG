"use client";

import { useEffect, useState } from "react";
import { getAnalytics, healthCheck } from "@/lib/api";
import type { AnalyticsSummary } from "@/types";
import {
  RefreshCw, BarChart3, FileText, Database,
  Clock, Target, Activity, CheckCircle2, XCircle,
} from "lucide-react";

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [health, setHealth] = useState<{ status: string; total_chunks: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, h] = await Promise.all([getAnalytics(), healthCheck()]);
      setData(a);
      setHealth(h);
    } catch (err: any) {
      setError(err.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const isHealthy = health?.status === "healthy";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Analytics</h2>
            <p className="text-xs text-[var(--text-muted)]">System performance overview</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] transition disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <XCircle size={16} />
            {error}
          </div>
        )}

        {/* Status banner */}
        <div className="rounded-2xl bg-gradient-to-r from-brand-500 to-purple-600 p-4 md:p-5 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <Activity size={18} />
            <h3 className="font-semibold">System Status</h3>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {loading ? (
              <span className="opacity-90">⏳ Checking…</span>
            ) : isHealthy ? (
              <>
                <CheckCircle2 size={16} className="text-green-200" />
                <span className="opacity-90">All systems operational</span>
              </>
            ) : (
              <>
                <XCircle size={16} className="text-red-200" />
                <span className="opacity-90">System unavailable — check backend</span>
              </>
            )}
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Metric icon={<BarChart3 size={18} />} label="Queries" value={data?.total_queries ?? 0} color="brand" />
          <Metric icon={<FileText size={18} />} label="Documents" value={data?.total_documents ?? 0} color="green" />
          <Metric icon={<Database size={18} />} label="Chunks" value={data?.total_chunks ?? health?.total_chunks ?? 0} color="purple" />
          <Metric icon={<Clock size={18} />} label="Avg Response" value={data?.avg_response_time ? `${data.avg_response_time.toFixed(1)}s` : "—"} color="orange" />
          <Metric icon={<Target size={18} />} label="Confidence" value={data?.avg_confidence ? `${(data.avg_confidence * 100).toFixed(0)}%` : "—"} color="blue" />
        </div>

        {/* Queries today */}
        {data && data.queries_today > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 animate-fade-in">
            <p className="text-sm text-[var(--text-muted)] mb-1">Queries Today</p>
            <p className="text-2xl font-bold">{data.queries_today}</p>
          </div>
        )}

        {/* System Info Panel */}
        {!loading && data && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 animate-fade-in space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Database size={15} className="text-brand-500" />
              Pipeline Configuration
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-0.5">Retrieval</p>
                <p className="font-medium">Hybrid BM25 + Vector</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-0.5">Re-ranker</p>
                <p className="font-medium">Cross-Encoder</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-0.5">Enrichment</p>
                <p className="font-medium">Contextual (Anthropic-style)</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-0.5">Embed Model</p>
                <p className="font-medium truncate">all-MiniLM-L6-v2</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-0.5">OCR</p>
                <p className="font-medium">Gemini Vision + Cloud Vision</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-0.5">Cache</p>
                <p className="font-medium">Semantic Query Cache</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: "brand" | "green" | "purple" | "orange" | "blue";
}) {
  const gradients: Record<string, string> = {
    brand: "from-brand-500 to-indigo-600",
    green: "from-green-500 to-emerald-600",
    purple: "from-purple-500 to-fuchsia-600",
    orange: "from-orange-400 to-red-500",
    blue: "from-blue-500 to-cyan-600",
  };
  return (
    <div className={`rounded-xl bg-gradient-to-br ${gradients[color]} p-3 md:p-4 text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200`}>
      <div className="opacity-80 mb-1">{icon}</div>
      <p className="text-xl md:text-2xl font-bold">{value}</p>
      <p className="text-[11px] opacity-80">{label}</p>
    </div>
  );
}