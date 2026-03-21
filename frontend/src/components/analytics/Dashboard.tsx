"use client";

import { useEffect, useState } from "react";
import { getAnalytics, healthCheck } from "@/lib/api";
import type { AnalyticsSummary } from "@/types";
import {
  Activity,
  BarChart3,
  Clock,
  Database,
  FileText,
  RefreshCw,
  Target,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Reusable analytics dashboard component.
 *
 * Can be embedded in the analytics page or in a modal / sidebar.
 */
export function Dashboard() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [health, setHealth] = useState<{
    status: string;
    total_chunks: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [a, h] = await Promise.all([getAnalytics(), healthCheck()]);
      setData(a);
      setHealth(h);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const metrics = [
    {
      icon: <BarChart3 size={18} />,
      label: "Queries",
      value: data?.total_queries ?? 0,
      color: "from-brand-500 to-indigo-600",
    },
    {
      icon: <FileText size={18} />,
      label: "Documents",
      value: data?.total_documents ?? 0,
      color: "from-green-500 to-emerald-600",
    },
    {
      icon: <Database size={18} />,
      label: "Chunks",
      value: data?.total_chunks ?? health?.total_chunks ?? 0,
      color: "from-purple-500 to-fuchsia-600",
    },
    {
      icon: <Clock size={18} />,
      label: "Avg Latency",
      value: data?.avg_response_time
        ? `${data.avg_response_time.toFixed(1)}s`
        : "—",
      color: "from-orange-400 to-red-500",
    },
    {
      icon: <Target size={18} />,
      label: "Avg Confidence",
      value: data?.avg_confidence
        ? `${(data.avg_confidence * 100).toFixed(0)}%`
        : "—",
      color: "from-blue-500 to-cyan-600",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Zap size={18} className="text-brand-500" />
          System Metrics
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-secondary)] transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Status banner */}
      <div className="rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 p-4 text-white shadow-lg">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Activity size={16} />
          {health?.status === "healthy"
            ? "All systems operational"
            : "Connecting to backend…"}
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {metrics.map((m) => (
          <div
            key={m.label}
            className={cn(
              "rounded-xl bg-gradient-to-br p-4 text-white shadow-md animate-fade-in",
              m.color
            )}
          >
            <div className="mb-2 opacity-80">{m.icon}</div>
            <p className="text-xl font-bold">{m.value}</p>
            <p className="text-[11px] opacity-80">{m.label}</p>
          </div>
        ))}
      </div>

      {/* Cache stats placeholder */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <h3 className="text-sm font-semibold mb-2">Cache & Performance</h3>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Real-time cache hit/miss ratios and per-query latency
          distributions are available via the{" "}
          <code className="bg-[var(--bg-secondary)] px-1 rounded text-brand-600 dark:text-brand-400">
            /api/v1/analytics
          </code>{" "}
          endpoint. Session-level charts will populate as you interact
          with the chatbot.
        </p>
      </div>
    </div>
  );
}
