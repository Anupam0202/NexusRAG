"use client";

import { useEffect } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";

export default function EvaluationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Evaluations error:", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center animate-fade-in">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/20">
        <ClipboardCheck size={24} className="text-amber-500" />
      </div>
      <h2 className="mb-2 text-lg font-bold">Evaluation Error</h2>
      <p className="mb-6 max-w-sm text-sm text-[var(--text-muted)]">
        {error.message || "Failed to load evaluations. Please try again."}
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
      >
        <RefreshCw size={15} />
        Try Again
      </button>
    </div>
  );
}
