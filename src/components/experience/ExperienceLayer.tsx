"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { NAV, TOP_ITEMS } from "@/lib/nav";
import { useTheme } from "@/components/theme/ThemeProvider";
import {
  CommandProvider,
  useCommandActions,
  useCommandState,
  useRegisterCommands,
  type Command,
} from "./CommandProvider";
import { RealtimeProvider } from "./RealtimeProvider";
import { KeyboardManager } from "./KeyboardManager";
import { RouteProgress } from "./RouteProgress";

// Lazy-loaded + only mounted while open — the palette/shortcuts chunks (and fuzzy
// matcher) never load or run until the user actually opens them.
const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => ({ default: m.CommandPalette })), { ssr: false });
const ShortcutsModal = dynamic(() => import("./ShortcutsModal").then((m) => ({ default: m.ShortcutsModal })), { ssr: false });

/**
 * App-wide experience layer — mount once around the authed shell. Provides the
 * command palette, global keyboard shortcuts, Realtime cache bridge, and route
 * progress bar, and registers the always-available navigation + global commands.
 */
export function ExperienceLayer({ children }: { children: ReactNode }) {
  return (
    <CommandProvider>
      <RealtimeProvider>
        <ExperienceInner>{children}</ExperienceInner>
      </RealtimeProvider>
    </CommandProvider>
  );
}

function ExperienceInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { setShortcutsOpen } = useCommandActions();
  const { paletteOpen, shortcutsOpen } = useCommandState();

  // Static navigation commands — registered once (router is stable).
  useRegisterCommands(
    () =>
      [...TOP_ITEMS, ...NAV.flatMap((g) => g.items)].map<Command>((item) => ({
        id: `nav:${item.path}`,
        title: item.label,
        group: "Navigation",
        icon: item.icon,
        keywords: item.path,
        run: () => router.push(item.path),
      })),
    [router],
  );

  // Global actions — re-registered only when the theme flips (for the toggle icon).
  useRegisterCommands(
    () => [
      { id: "act:theme", title: "Toggle theme", group: "Actions", icon: theme === "dark" ? "sun" : "moon", run: toggle },
      { id: "act:shortcuts", title: "Keyboard shortcuts", group: "Actions", icon: "keyboard", run: () => setShortcutsOpen(true) },
    ],
    [theme, toggle, setShortcutsOpen],
  );

  return (
    <>
      <RouteProgress />
      {children}
      <KeyboardManager />
      {paletteOpen && <CommandPalette />}
      {shortcutsOpen && <ShortcutsModal />}
    </>
  );
}
