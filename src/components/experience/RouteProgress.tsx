"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Slim top-of-page progress bar during route transitions. Starts when an internal
 * link is clicked and completes when the pathname changes (App Router exposes no
 * router events, so we bracket the navigation ourselves). Subtle + reduced-motion safe.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };

  // start on internal-link clicks (to a DIFFERENT path — not same-page hash/query links)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // external
      if (url.pathname === window.location.pathname) return; // same page (hash/query only)
      setPhase("loading");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // safety net: never strand the bar if a navigation aborts and the pathname never changes
  useEffect(() => {
    if (phase !== "loading") return;
    const t = window.setTimeout(() => setPhase("idle"), 3000);
    return () => clearTimeout(t);
  }, [phase]);

  // complete when the route actually changes
  useEffect(() => {
    setPhase((p) => (p === "loading" ? "done" : p));
    clearTimers();
    timers.current.push(window.setTimeout(() => setPhase("idle"), 350));
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (phase === "idle") return null;
  return (
    <div className="route-progress" aria-hidden="true">
      <span className={`route-progress-bar ${phase}`} />
    </div>
  );
}
