"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * App-wide command + page-chrome registry powering the ⌘K palette and the global
 * keyboard shortcuts.
 *
 * PERF: the context is split in two so registering a screen's action/search does NOT
 * re-render that screen when palette state changes:
 *   • ActionsContext — STABLE function identities (register / setPagePrimary / open /
 *     close …). Screens consume only this (via the hooks below), so opening the palette
 *     or a registry change never re-renders a heavy table screen.
 *   • StateContext — the volatile state (paletteOpen, commands, pagePrimary). Only the
 *     palette UI / top bar / keyboard manager consume it.
 */
export type Command = {
  id: string;
  title: string;
  group?: string;
  keywords?: string;
  icon?: string;
  shortcut?: string[];
  run: () => void;
  disabled?: boolean;
};

type PagePrimary = { label: string; run: () => void } | null;

type CommandActions = {
  setPaletteOpen: (o: boolean) => void;
  togglePalette: () => void;
  setShortcutsOpen: (o: boolean) => void;
  register: (cmds: Command[]) => () => void;
  setPagePrimary: (p: PagePrimary) => void;
  registerSearch: (el: HTMLInputElement | null) => void;
  focusSearch: () => boolean;
};

type CommandState = {
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  commands: Command[];
  pagePrimary: PagePrimary;
};

const ActionsContext = createContext<CommandActions | null>(null);
const StateContext = createContext<CommandState | null>(null);

export function CommandProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pagePrimary, setPagePrimary] = useState<PagePrimary>(null);
  const [version, setVersion] = useState(0); // bumps when the registry changes
  const registry = useRef(new Map<string, Command>());
  const searchEl = useRef<HTMLInputElement | null>(null);

  const register = useCallback((cmds: Command[]) => {
    const map = registry.current;
    for (const c of cmds) map.set(c.id, c);
    setVersion((v) => v + 1);
    return () => {
      for (const c of cmds) map.delete(c.id);
      setVersion((v) => v + 1);
    };
  }, []);

  const registerSearch = useCallback((el: HTMLInputElement | null) => {
    searchEl.current = el;
  }, []);

  const focusSearch = useCallback(() => {
    const el = searchEl.current;
    if (el) {
      el.focus();
      el.select();
      return true;
    }
    return false;
  }, []);

  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);

  // Stable forever (setState setters + useCallbacks never change identity) — so
  // ActionsContext consumers never re-render from this provider.
  const actions = useMemo<CommandActions>(
    () => ({ setPaletteOpen, togglePalette, setShortcutsOpen, register, setPagePrimary, registerSearch, focusSearch }),
    [togglePalette, register, registerSearch, focusSearch],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commands = useMemo(() => Array.from(registry.current.values()), [version]);

  const state = useMemo<CommandState>(
    () => ({ paletteOpen, shortcutsOpen, commands, pagePrimary }),
    [paletteOpen, shortcutsOpen, commands, pagePrimary],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useCommandActions(): CommandActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useCommandActions must be used within a CommandProvider");
  return ctx;
}

export function useCommandState(): CommandState {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error("useCommandState must be used within a CommandProvider");
  return ctx;
}

/** Register a screen's commands; auto-unregister on unmount. Consumes only the stable
 *  actions context, so the screen never re-renders when palette state changes. */
export function useRegisterCommands(factory: () => Command[], deps: unknown[]) {
  const { register } = useCommandActions();
  useEffect(() => {
    return register(factory());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Set the current screen's primary action ("n" key + a palette command). */
export function usePagePrimaryAction(label: string, run: () => void) {
  const { setPagePrimary } = useCommandActions();
  useEffect(() => {
    setPagePrimary({ label, run });
    return () => setPagePrimary(null);
  }, [label, run, setPagePrimary]);
}

/** Register the screen's search input so "/" focuses it. */
export function usePageSearchInput(ref: React.RefObject<HTMLInputElement | null>) {
  const { registerSearch } = useCommandActions();
  useEffect(() => {
    registerSearch(ref.current);
    return () => registerSearch(null);
  }, [ref, registerSearch]);
}
