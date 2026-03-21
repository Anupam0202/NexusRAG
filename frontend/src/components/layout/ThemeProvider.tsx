"use client";

import { useEffect } from "react";
import { useStore } from "@/hooks/useStore";

/**
 * Initialises the theme on first render.
 * - Reads `localStorage` and system `prefers-color-scheme`.
 * - Applies the `dark` class to <html> so Tailwind dark: utilities work.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { darkMode, setDarkMode } = useStore();

  // One-time initialisation from localStorage / system preference
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark =
      stored === "dark" ||
      (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDarkMode(prefersDark);
    document.documentElement.classList.toggle("dark", prefersDark);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync whenever darkMode toggles
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  return <>{children}</>;
}
