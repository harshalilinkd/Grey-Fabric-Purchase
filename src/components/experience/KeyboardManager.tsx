"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCommandActions, useCommandState } from "./CommandProvider";

/**
 * Global keyboard map (mounted once). Never hijacks typing inside inputs.
 *   ⌘K / Ctrl-K   open the command palette (works everywhere)
 *   /             focus the page search
 *   n             run the page's primary action
 *   g then <key>  navigate (g d Dashboard, g p Purchase Orders, …)
 *   ?             open the shortcuts cheat-sheet
 * See GO_TO for the full chord map; mirror any change in ShortcutsModal.
 */
export const GO_TO: Record<string, { path: string; label: string }> = {
  d: { path: "/", label: "Dashboard" },
  p: { path: "/purchase-orders", label: "Purchase Orders" },
  r: { path: "/grey-receipts", label: "Grey House Follow Up" },
  q: { path: "/dyeing-queue", label: "Dyeing Queue" },
  i: { path: "/qc-inspection", label: "QC Inspection" },
  x: { path: "/reissue-return", label: "Reissue & Return" },
  w: { path: "/warehouse", label: "Warehouse" },
  s: { path: "/settings", label: "Settings" },
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function KeyboardManager() {
  const router = useRouter();
  const { togglePalette, setShortcutsOpen, focusSearch } = useCommandActions();
  const { paletteOpen, pagePrimary } = useCommandState();
  const gPending = useRef<number | null>(null); // timestamp of a pending "g" chord

  // keep latest handlers without rebinding the listener every render
  const handlers = useRef({ togglePalette, paletteOpen, setShortcutsOpen, pagePrimary, focusSearch });
  handlers.current = { togglePalette, paletteOpen, setShortcutsOpen, pagePrimary, focusSearch };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = handlers.current;

      // ⌘K / Ctrl-K works even while typing
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        h.togglePalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (h.paletteOpen) return; // palette owns its own keys
      if (isTypingTarget(e.target)) return; // don't hijack typing
      // don't fire page shortcuts under an open form/confirm modal (focus may be on a button,
      // not an input) — every modal renders a .overlay backdrop
      if (document.querySelector(".overlay")) return;

      // pending "g" chord → navigate
      if (gPending.current && Date.now() - gPending.current < 1200) {
        const dest = GO_TO[e.key.toLowerCase()];
        gPending.current = null;
        if (dest) { e.preventDefault(); router.push(dest.path); return; }
      }

      if (e.key === "g") { gPending.current = Date.now(); return; }
      gPending.current = null;

      if (e.key === "/") { if (h.focusSearch()) e.preventDefault(); return; }
      if (e.key === "?") { e.preventDefault(); h.setShortcutsOpen(true); return; }
      if (e.key === "n") { if (h.pagePrimary) { e.preventDefault(); h.pagePrimary.run(); } return; }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return null;
}
