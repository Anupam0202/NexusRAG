"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  MessageSquare, FileText, BarChart3, Settings, ChevronLeft,
  ChevronRight, Sparkles, Menu, X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useStore } from "@/hooks/useStore";
import { useState, useEffect } from "react";

const NAV = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const store = useStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const docCount = store.documents?.length ?? 0;

  // Close mobile on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={mobileOpen}
        className="lg:hidden fixed top-3 left-3 z-50 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-md text-[var(--text-secondary)] hover:text-brand-500 transition"
      >
        <Menu size={18} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="sidebar-backdrop lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)] transition-all duration-300 ease-in-out z-50 shrink-0",
          /* Desktop */
          "hidden lg:flex",
          collapsed ? "w-[68px]" : "w-[240px]",
          /* Mobile override (absolute) */
          mobileOpen && "!flex fixed inset-y-0 left-0 w-[260px] shadow-2xl"
        )}
      >
        {/* Brand header */}
        <div className={cn(
          "flex items-center gap-3 border-b border-[var(--border)] px-4 h-14 shrink-0",
          collapsed && "justify-center px-2"
        )}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 via-purple-500 to-pink-500 shadow-md">
            <Sparkles size={16} className="text-white" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <p className="text-sm font-bold leading-tight gradient-text">NexusRAG</p>
                <p className="text-[10px] text-[var(--text-muted)] font-medium whitespace-nowrap">Enterprise Document Intelligence</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mobile close */}
          {mobileOpen && (
            <button onClick={() => setMobileOpen(false)} className="ml-auto lg:hidden rounded-lg p-1.5 hover:bg-[var(--bg-hover)] transition">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1" role="navigation" aria-label="Main navigation">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  collapsed && "justify-center px-2",
                  active
                    ? "bg-gradient-to-r from-brand-500/10 to-purple-500/10 text-brand-600 dark:text-brand-400"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                )}
              >
                {/* Active indicator */}
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-gradient-to-b from-brand-500 to-purple-500" />
                )}

                <Icon
                  size={18}
                  className={cn(
                    "shrink-0 transition-transform duration-200",
                    active ? "text-brand-500" : "group-hover:scale-110"
                  )}
                />
                {!collapsed && <span>{item.label}</span>}

                {/* Active dot for collapsed mode */}
                {collapsed && active && (
                  <span className="absolute -right-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-brand-500" />
                )}

                {/* Tooltip for collapsed */}
                {collapsed && (
                  <span className="absolute left-full ml-3 px-2.5 py-1 rounded-lg bg-gray-900 text-white text-xs font-medium whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity shadow-lg z-50">
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={cn(
          "border-t border-[var(--border)] px-3 py-3 shrink-0 space-y-2",
          collapsed && "px-2"
        )}>
          {/* Doc count badge */}
          {docCount > 0 && !collapsed && (
            <div className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500/10 to-purple-500/10 px-3 py-2 animate-fade-in">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                {docCount} document{docCount !== 1 ? "s" : ""} loaded
              </span>
            </div>
          )}

          {/* Collapse toggle (desktop only) */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex w-full items-center justify-center gap-2 rounded-xl py-2 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition text-xs"
          >
            {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /> Collapse</>}
          </button>
        </div>
      </aside>
    </>
  );
}