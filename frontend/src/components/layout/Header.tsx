"use client";

import { usePathname } from "next/navigation";
import { Building2, Moon, Sun, Wifi, WifiOff } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { shallow } from "zustand/shallow";
import { useEffect, useState } from "react";
import { getSystemStatus } from "@/lib/api";
import { AuthMenu } from "@/components/auth/AuthMenu";

const PAGE_TITLES: Record<string, string> = {
  "/evidence-os": "Evidence OS",
  "/findings": "Findings & Reviews",
  "/chat": "Chat",
  "/documents": "Documents",
  "/workspaces": "Workspaces",
  "/onboarding": "Onboarding",
  "/auth/login": "Sign In",
  "/auth/callback": "Sign In",
  "/analytics": "Analytics",
  "/evaluations": "Evaluations",
  "/settings": "Settings",
  "/settings/api-keys": "API Keys",
  "/settings/billing-or-usage": "Billing & Usage",
  "/settings/members": "Members",
  "/settings/privacy": "Privacy & Data",
  "/settings/security": "Account Security",
};

export function Header() {
  const pathname = usePathname();
  const { authMode, userId, workspaceId, workspaceDiscovery, connectionStatus, setConnectionStatus, darkMode, toggleDark } = useStore(state => ({
    authMode: state.authMode,
    userId: state.authUser?.id ?? null,
    workspaceId: state.workspaceId,
    workspaceDiscovery: state.workspaceDiscovery,
    connectionStatus: state.connectionStatus,
    setConnectionStatus: state.setConnectionStatus,
    darkMode: state.darkMode,
    toggleDark: state.toggleDark,
  }), shallow);
  const title = pathname.startsWith("/documents/")
    ? "Document Detail"
    : PAGE_TITLES[pathname] ?? "NexusRAG";
  const [browserOnline, setBrowserOnline] = useState(true);

  useEffect(() => {
    const check = () => setBrowserOnline(navigator.onLine);
    check();
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkBackend = async () => {
      if (authMode === "loading") return;
      if (authMode === "signed_out") {
        setConnectionStatus("auth_required");
        return;
      }
      if (authMode === "authenticated" && !workspaceId) {
        // Status is workspace-authorized, not a public connectivity probe.
        // Missing membership must not become an outage or private status request.
        setConnectionStatus("checking");
        return;
      }
      if (!navigator.onLine) {
        setConnectionStatus("offline");
        return;
      }
      try {
        const status = await getSystemStatus(authMode === "authenticated"
          ? { workspaceId: workspaceId, expectedUserId: userId ?? null }
          : {});
        const authSetupRequired =
          status.settings.anonymous_demo_enabled === false &&
          (!status.settings.supabase_configured || !status.settings.supabase_auth_configured);
        const dataSetupRequired =
          status.settings.anonymous_demo_enabled === false &&
          status.settings.supabase_configured === true &&
          status.settings.supabase_auth_configured === true &&
          status.settings.supabase_data_api_reachable === false;
        if (!cancelled) {
          setConnectionStatus(
            authSetupRequired
              ? "auth_setup_required"
              : dataSetupRequired
                ? "data_setup_required"
                : "online"
          );
        }
      } catch (error) {
        const authenticationRequired =
          error instanceof Error &&
          "code" in error &&
          ["AUTH_REQUIRED", "AUTH_CONTEXT_CHANGED"].includes(String((error as Error & { code?: unknown }).code));
        if (!cancelled) {
          setConnectionStatus(authenticationRequired ? "auth_required" : "offline");
        }
      }
    };
    void checkBackend();
    const timer = window.setInterval(checkBackend, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authMode, userId, workspaceId, setConnectionStatus]);

  const needsWorkspace = authMode === "authenticated" && !workspaceId;
  const connectionLabel = !browserOnline
    ? "Offline"
    : needsWorkspace
      ? workspaceDiscovery === "missing"
        ? "Workspace required"
        : workspaceDiscovery === "error" || workspaceDiscovery === "ready"
          ? "Workspace unavailable"
          : "Checking workspace"
    : connectionStatus === "online"
      ? "Gateway reachable"
      : connectionStatus === "auth_setup_required"
        ? "Auth setup required"
        : connectionStatus === "data_setup_required"
          ? "Data setup required"
          : connectionStatus === "auth_required"
            ? "Sign in required"
          : connectionStatus === "reconnecting"
            ? "Reconnecting"
            : connectionStatus === "offline"
              ? "Backend offline"
              : "Checking";
  const connectionOnline = browserOnline && !needsWorkspace && connectionStatus === "online";
  const connectionNeedsSetup =
    browserOnline &&
    (needsWorkspace || connectionStatus === "auth_setup_required" ||
      connectionStatus === "data_setup_required" ||
      connectionStatus === "auth_required");
  const connectionReachable =
    browserOnline &&
    (connectionOnline || connectionStatus === "auth_required");

  return (
    <header className="flex w-full min-w-0 items-center justify-between border-b border-white/10 dark:border-white/5 bg-white/70 dark:bg-[#0a0e1a]/70 backdrop-blur-xl px-4 sm:px-6 h-14 shrink-0 sticky top-0 z-30 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Spacer for mobile hamburger */}
        <div className="w-9 lg:hidden" />

        <h1 className="truncate text-base sm:text-lg font-bold tracking-tight">{title}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <AuthMenu />

        {/* Connection status */}
        <div className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors sm:flex ${
          connectionOnline
            ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400"
            : connectionNeedsSetup
              ? "bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
            : "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400"
        }`}>
          {needsWorkspace && browserOnline ? <Building2 size={11} /> : connectionReachable ? <Wifi size={11} /> : <WifiOff size={11} />}
          {connectionLabel}
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={() => toggleDark()}
          aria-label="Toggle dark mode"
          className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all hover:scale-105 active:scale-95"
          title="Toggle theme"
        >
          {darkMode ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}
