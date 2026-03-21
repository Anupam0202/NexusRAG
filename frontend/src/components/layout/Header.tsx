"use client";

import { usePathname } from "next/navigation";
import { Moon, Sun, Wifi, WifiOff } from "lucide-react";
import { useStore } from "@/hooks/useStore";
import { useEffect, useState } from "react";

const PAGE_TITLES: Record<string, string> = {
  "/chat": "Chat",
  "/documents": "Documents",
  "/analytics": "Analytics",
  "/settings": "Settings",
};

export function Header() {
  const pathname = usePathname();
  const store = useStore();
  const title = PAGE_TITLES[pathname] ?? "Chat";
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const check = () => setOnline(navigator.onLine);
    check();
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, []);

  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-primary)]/80 backdrop-blur-xl px-4 sm:px-6 h-14 shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        {/* Spacer for mobile hamburger */}
        <div className="w-9 lg:hidden" />

        <h1 className="text-base sm:text-lg font-bold tracking-tight">{title}</h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Connection status */}
        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
          online
            ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400"
            : "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400"
        }`}>
          {online ? <Wifi size={11} /> : <WifiOff size={11} />}
          {online ? "Connected" : "Offline"}
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={() => store.toggleDark()}
          className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all hover:scale-105 active:scale-95"
          title="Toggle theme"
        >
          {store.darkMode ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}