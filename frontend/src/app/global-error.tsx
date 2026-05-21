"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global app error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-center text-white">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/15">
            <AlertTriangle size={24} className="text-red-300" />
          </div>
          <h1 className="mb-2 text-xl font-bold">Something went wrong</h1>
          <p className="mb-6 max-w-sm text-sm text-slate-300">
            {error.message || "An unexpected error occurred. Please try again."}
          </p>
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
          >
            <RefreshCw size={15} />
            Try Again
          </button>
        </main>
      </body>
    </html>
  );
}
