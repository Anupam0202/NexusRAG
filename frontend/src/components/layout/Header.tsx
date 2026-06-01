"use client";

import { usePathname } from "next/navigation";
import { Moon, Sun, Wifi, WifiOff } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { useEffect, useState } from "react";
import { getSystemStatus } from "@/lib/api";
import { AuthMenu } from "@/components/auth/AuthMenu";

const PAGE_TITLES: Record<string, string> = {
  "/chat": "Chat",
  "/documents": "Documents",
  "/analytics": "Analytics",
  "/evaluations": "Evaluations",
  "/settings": "Settings",
};

export function Header() {
  const pathname = usePathname();
  const store = useStore();
  const title = PAGE_TITLES[pathname] ?? "Chat";
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
      if (!navigator.onLine) {
        store.setConnectionStatus("offline");
        return;
      }
      try {
        await getSystemStatus();
        if (!cancelled) store.setConnectionStatus("online");
      } catch {
        if (!cancelled) store.setConnectionStatus("offline");
      }
    };
    void checkBackend();
    const timer = window.setInterval(checkBackend, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectionLabel = !browserOnline
    ? "Offline"
    : store.connectionStatus === "online"
      ? "Backend live"
      : store.connectionStatus === "reconnecting"
        ? "Reconnecting"
        : store.connectionStatus === "offline"
          ? "Backend offline"
          : "Checking";
  const connectionOnline = browserOnline && store.connectionStatus === "online";

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
            : "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400"
        }`}>
          {connectionOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
          {connectionLabel}
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={() => store.toggleDark()}
          aria-label="Toggle dark mode"
          className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all hover:scale-105 active:scale-95"
          title="Toggle theme"
        >
          {store.darkMode ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}
