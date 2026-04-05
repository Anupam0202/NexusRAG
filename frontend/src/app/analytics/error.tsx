"use client";

import { useEffect } from "react";
import { BarChart3, RefreshCw } from "lucide-react";

export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Analytics error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4 animate-fade-in">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/20 mb-4">
        <BarChart3 size={24} className="text-amber-500" />
      </div>
      <h2 className="text-lg font-bold mb-2">Analytics Error</h2>
      <p className="text-sm text-[var(--text-muted)] mb-6 max-w-sm">
        {error.message || "Failed to load analytics. Please try again."}
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-purple-600 text-white px-5 py-2.5 text-sm font-semibold shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
      >
        <RefreshCw size={15} />
        Try Again
      </button>
    </div>
  );
}
