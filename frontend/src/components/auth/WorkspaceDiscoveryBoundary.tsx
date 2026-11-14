"use client";

import { usePathname } from "next/navigation";
import { Loader2, Building2, RefreshCw } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import Link from "@/components/layout/StaticLink";
import { reloadStatic } from "@/lib/static-navigation";
import { isWorkspaceRoute } from "@/lib/workspace-discovery";

export { isWorkspaceRoute } from "@/lib/workspace-discovery";

/** Do not mount private route effects until a workspace context is available. */
export function WorkspaceDiscoveryBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const authMode = useStore(state => state.authMode);
  const workspaceId = useStore(state => state.workspaceId);
  const discovery = useStore(state => state.workspaceDiscovery);
  if (authMode !== "authenticated" || workspaceId || !isWorkspaceRoute(pathname)) return children;
  const loading = discovery === "loading";
  const missing = discovery === "missing";
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-8">
      <section aria-labelledby="workspace-discovery-title" className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
        {loading ? <Loader2 aria-hidden="true" className="mx-auto mb-4 animate-spin" /> : <Building2 aria-hidden="true" className="mx-auto mb-4" />}
        <h2 id="workspace-discovery-title" className="text-lg font-semibold">
          {loading ? "Checking your workspace" : missing ? "Set up your workspace" : "Workspace discovery unavailable"}
        </h2>
        <p role={loading ? "status" : undefined} className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
          {loading ? "Verifying your current workspace membership."
            : missing ? "Your signed-in account has no workspace yet. Continue to onboarding to create one."
              : "We could not verify workspace membership. No workspace was created and private data has not been loaded. Retry when the connection is available."}
        </p>
        {missing && <Link href="/onboarding" className="mt-5 inline-flex rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-white">Continue to onboarding</Link>}
        {!loading && <button type="button" onClick={reloadStatic} className="mx-auto mt-4 flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm"><RefreshCw size={16} aria-hidden="true" />Retry workspace discovery</button>}
      </section>
    </div>
  );
}
