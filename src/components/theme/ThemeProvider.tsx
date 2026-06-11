"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  toggle: () => void;
  /** false until the client has read the real theme — avoids icon flash/mismatch */
  mounted: boolean;
};

const STORAGE_KEY = "grey-fms-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * The actual initial theme is applied to <html> by an inline script in the
 * root layout (before paint, so there's no flash). This provider just mirrors
 * that state into React and handles toggling + persistence.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = document.documentElement.classList.contains("dark") ? "dark" : "light";
    setTheme(current);
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* private mode / storage disabled — ignore */
      }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle, mounted }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
