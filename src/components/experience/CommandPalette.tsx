"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { fuzzyScore } from "@/lib/fuzzy";
import { useCommandActions, useCommandState, type Command } from "./CommandProvider";

export function CommandPalette() {
  const { paletteOpen, commands, pagePrimary } = useCommandState();
  const { setPaletteOpen } = useCommandActions();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Synthesize the current page's primary action as a "This page" command.
  const all = useMemo<Command[]>(() => {
    const list = [...commands];
    if (pagePrimary) {
      list.unshift({ id: "page.primary", title: pagePrimary.label, group: "This page", icon: "plus", run: pagePrimary.run });
    }
    return list;
  }, [commands, pagePrimary]);

  const results = useMemo(() => {
    const scored = all
      .map((c) => ({ c, s: fuzzyScore(query, `${c.title} ${c.keywords ?? ""}`) }))
      .filter((x): x is { c: Command; s: number } => x.s !== null);
    scored.sort((a, b) => b.s - a.s);
    // Keep each group's items contiguous (in first-appearance order) so a group header
    // never renders twice when score-sort would otherwise interleave groups.
    const order: string[] = [];
    const byGroup = new Map<string, Command[]>();
    for (const { c } of scored.slice(0, 12)) {
      const g = c.group ?? "";
      if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
      byGroup.get(g)!.push(c);
    }
    return order.flatMap((g) => byGroup.get(g)!);
  }, [all, query]);

  // reset on open
  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setActive(0);
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [paletteOpen]);

  useEffect(() => setActive(0), [query]);

  // keep the active row in view
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!paletteOpen) return null;

  const close = () => setPaletteOpen(false);
  const runAt = (i: number) => {
    const cmd = results[i];
    if (!cmd || cmd.disabled) return;
    close();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.max(0, Math.min(a + 1, results.length - 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); runAt(active); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  let lastGroup: string | undefined;

  return (
    <div className="overlay cmdk-overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="cmdk-input">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a screen or run an action…"
            aria-label="Command palette search"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="kbd">esc</kbd>
        </div>

        <div className="cmdk-list" ref={listRef}>
          {results.length === 0 ? (
            <div className="cmdk-empty">No matching commands</div>
          ) : (
            results.map((cmd, i) => {
              const header = cmd.group && cmd.group !== lastGroup ? cmd.group : null;
              lastGroup = cmd.group;
              return (
                <div key={cmd.id}>
                  {header && <div className="cmdk-group">{header}</div>}
                  <button
                    type="button"
                    data-i={i}
                    className={`cmdk-item${i === active ? " active" : ""}`}
                    onMouseMove={() => setActive(i)}
                    onClick={() => runAt(i)}
                  >
                    <Icon name={cmd.icon ?? "chevron"} size={16} />
                    <span className="cmdk-title">{cmd.title}</span>
                    {cmd.shortcut && (
                      <span className="cmdk-keys">
                        {cmd.shortcut.map((k) => <kbd key={k} className="kbd">{k}</kbd>)}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="cmdk-foot">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navigate</span>
          <span><kbd className="kbd">↵</kbd> run</span>
          <span><kbd className="kbd">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
