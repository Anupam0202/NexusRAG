"use client";

import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";
import type { AuthMode } from "@/hooks/useStore";
import { cn } from "@/lib/utils";

interface Props {
  authMode: AuthMode;
  nextPath: string;
  title?: string;
  description?: string;
  className?: string;
}

export function AuthRequiredState({
  authMode,
  nextPath,
  title = "Sign in required",
  description = "Sign in to access this workspace data.",
  className,
}: Props) {
  const loading = authMode === "loading";

  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-5 py-6 text-center",
        className
      )}
    >
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
        {loading ? <Loader2 size={22} className="animate-spin" /> : <ShieldCheck size={22} />}
      </div>
      <h2 className="text-base font-bold">
        {loading ? "Checking session" : title}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">
        {loading ? "Please wait while NexusRAG verifies your session." : description}
      </p>
      {!loading && (
        <Link
          href={`/auth/login?next=${encodeURIComponent(nextPath)}`}
          className="mt-5 inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
        >
          Sign in
        </Link>
      )}
    </div>
  );
}
