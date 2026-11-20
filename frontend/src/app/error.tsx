"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/** What a person sees when a page fails to render, instead of a blank screen and a message in the console. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error && typeof error === "object" && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <div className="flex h-full items-center justify-center px-4 py-10">
      <section role="alert" className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center shadow-sm">
        <AlertTriangle size={28} className="mx-auto text-amber-500" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-bold">This page could not be shown</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          Something went wrong while loading it. Nothing you saved was lost. Try again, or open another page from the
          menu.
        </p>
        {digest && <p className="mt-2 text-xs text-[var(--text-muted)]">Reference: {digest}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500"
          >
            <RotateCcw size={15} aria-hidden="true" /> Try again
          </button>
          <a href="/chat" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--bg-hover)]">
            Go to Chat
          </a>
        </div>
      </section>
    </div>
  );
}
