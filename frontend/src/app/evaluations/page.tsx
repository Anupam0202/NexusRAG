"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { runSampleEvaluation } from "@/lib/api";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { useWorkspaceApiAccess } from "@/hooks/useAuthGate";
import type { EvaluationMode, EvaluationReportResponse } from "@/types";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Gauge,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Target,
  XCircle,
} from "lucide-react";

const GATE_LABELS: Record<string, string> = {
  retrieval_recall: "Recall@K",
  citation_precision: "Citation precision",
  cross_workspace_leaks: "Workspace leaks",
  case_pass_rate: "Case pass rate",
};

export default function EvaluationsPage() {
  const { authMode, canAccessWorkspaceApi } = useWorkspaceApiAccess();
  const [mode, setMode] = useState<EvaluationMode>("retrieval");
  const [topK, setTopK] = useState(5);
  const [report, setReport] = useState<EvaluationReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (nextMode = mode, nextTopK = topK) => {
    if (!canAccessWorkspaceApi) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextReport = await runSampleEvaluation({
        mode: nextMode,
        top_k: nextTopK,
        fail_under_recall: 0.8,
        fail_under_citation_precision: 0.8,
      });
      setReport(nextReport);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Evaluation run failed");
    } finally {
      setLoading(false);
    }
  }, [canAccessWorkspaceApi, mode, topK]);

  useEffect(() => {
    if (!canAccessWorkspaceApi) {
      setLoading(false);
      return;
    }
    void run();
    // Run the bundled quality gate once on first page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessWorkspaceApi]);

  const totalCases = summaryNumber(report, "total");
  const passedCases = summaryNumber(report, "passed");
  const failedCases = summaryNumber(report, "failed");
  const passRate = summaryNumber(report, "pass_rate");
  const recall = summaryNumber(report, "avg_retrieval_recall_at_k");
  const citationPrecision = summaryNumber(report, "avg_citation_precision");
  const latency = summaryNumber(report, "avg_latency_ms");
  const leakCount = summaryNumber(report, "cross_workspace_leaks");

  const cases = report?.results ?? [];
  const statusTone = report?.gates.passed ? "emerald" : "amber";
  const generatedAt = report?.generated_at
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(report.generated_at))
    : "Not run yet";

  if (!canAccessWorkspaceApi) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-8">
          <AuthRequiredState
            authMode={authMode}
            nextPath="/evaluations"
            title="Sign in to run evaluations"
            description="Quality gates use workspace data and require an authenticated session."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-5 md:px-6 md:py-7 space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ClipboardCheck size={20} className="text-brand-500" />
              <h2 className="text-lg font-bold">Evaluation Dashboard</h2>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Golden dataset quality gates for retrieval, citations, latency, and tenant isolation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-1">
              {(["retrieval", "extractive"] as EvaluationMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setMode(item);
                    void run(item, topK);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    mode === item
                      ? "bg-brand-500 text-white shadow-sm"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium">
              <span className="text-[var(--text-muted)]">Top K</span>
              <input
                type="number"
                min={1}
                max={20}
                value={topK}
                onChange={(event) => setTopK(Number(event.target.value))}
                className="w-12 bg-transparent text-center font-semibold outline-none"
              />
            </label>

            <button
              type="button"
              onClick={() => run()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-60"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Run Gate
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            <XCircle size={16} />
            {error}
          </div>
        )}

        <div className={`rounded-2xl border p-4 md:p-5 ${
          statusTone === "emerald"
            ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/60 dark:bg-emerald-950/20"
            : "border-amber-200 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/20"
        }`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                report?.gates.passed
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              }`}>
                {report?.gates.passed ? <ShieldCheck size={22} /> : <AlertTriangle size={22} />}
              </div>
              <div>
                <p className="text-sm font-bold">
                  {loading ? "Running evaluation" : report?.gates.passed ? "Quality gate passed" : "Quality gate needs attention"}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {report?.dataset ?? "sample_corpus.json"} - {mode} - {generatedAt}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center md:w-[300px]">
              <Badge label="Cases" value={`${passedCases}/${totalCases}`} />
              <Badge label="Failed" value={`${failedCases}`} />
              <Badge label="Leaks" value={`${leakCount}`} />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={<SearchCheck size={18} />} label="Recall@K" value={formatPct(recall)} tone="brand" />
          <Metric icon={<Target size={18} />} label="Citation Precision" value={formatPct(citationPrecision)} tone="green" />
          <Metric icon={<Gauge size={18} />} label="Pass Rate" value={formatPct(passRate)} tone="blue" />
          <Metric icon={<Clock size={18} />} label="Avg Latency" value={latency ? `${latency.toFixed(0)}ms` : "-"} tone="orange" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <Activity size={16} className="text-brand-500" />
                Gates
              </h3>
              <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--text-muted)]">
                {report?.mode ?? mode}
              </span>
            </div>

            {loading && !report ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="h-14 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(report?.gates.checks ?? {}).map(([key, check]) => (
                  <GateRow
                    key={key}
                    label={GATE_LABELS[key] ?? key}
                    value={check.value}
                    threshold={check.threshold}
                    passed={check.passed}
                    inverse={key === "cross_workspace_leaks"}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <ClipboardCheck size={16} className="text-brand-500" />
                Cases
              </h3>
              <span className="text-xs text-[var(--text-muted)]">
                {report ? `${report.duration_ms.toFixed(0)}ms run` : "Pending"}
              </span>
            </div>

            <div className="space-y-3">
              {loading && !report ? (
                [0, 1, 2].map((item) => (
                  <div key={item} className="h-24 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
                ))
              ) : cases.length > 0 ? (
                cases.map((item) => (
                  <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold text-[var(--text-muted)]">{item.id}</span>
                          <StatusChip passed={item.passed} />
                        </div>
                        <p className="text-sm font-semibold leading-5">{item.question}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--bg-card)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                        {item.workspace_id.slice(0, 8)}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <SmallMetric label="Recall" value={formatMetric(item.metrics.retrieval_recall_at_k)} />
                      <SmallMetric label="MRR" value={formatMetric(item.metrics.mrr)} />
                      <SmallMetric label="Support" value={formatMetric(item.metrics.answer_support)} />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {item.sources.slice(0, 4).map((source) => (
                        <span
                          key={`${item.id}-${source.filename}-${source.score}`}
                          className="rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
                          title={source.document_id}
                        >
                          {source.filename} ({source.score.toFixed(2)})
                        </span>
                      ))}
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--text-muted)]">
                  No evaluation results yet
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function summaryNumber(report: EvaluationReportResponse | null, key: string) {
  const value = report?.summary[key];
  return typeof value === "number" ? value : 0;
}

function formatPct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMetric(value: number | string | boolean | undefined) {
  return typeof value === "number" ? value.toFixed(2) : "-";
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
      <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "brand" | "green" | "blue" | "orange";
}) {
  const toneClass = {
    brand: "bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300",
    green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300",
    blue: "bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300",
    orange: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300",
  }[tone];

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${toneClass}`}>
        {icon}
      </div>
      <p className="text-xs font-medium text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
    </div>
  );
}

function GateRow({
  label,
  value,
  threshold,
  passed,
  inverse = false,
}: {
  label: string;
  value: number;
  threshold: number;
  passed: boolean;
  inverse?: boolean;
}) {
  const percent = inverse ? (value === 0 ? 100 : 0) : Math.min(value, 1) * 100;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{label}</p>
          <p className="text-[11px] text-[var(--text-muted)]">
            {inverse ? `target ${threshold}` : `target ${formatPct(threshold)}`}
          </p>
        </div>
        {passed ? (
          <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
        ) : (
          <XCircle size={18} className="shrink-0 text-red-500" />
        )}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-card)]">
        <div
          className={`h-full rounded-full ${passed ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-right text-xs font-semibold tabular-nums">
        {inverse ? value : formatPct(value)}
      </p>
    </div>
  );
}

function StatusChip({ passed }: { passed: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
      passed
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
    }`}>
      {passed ? "Pass" : "Fail"}
    </span>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--bg-card)] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}
