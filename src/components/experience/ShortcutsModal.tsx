"use client";

import { Icon } from "@/components/ui/Icon";
import { useEscClose } from "@/lib/use-esc-close";
import { useCommandActions, useCommandState } from "./CommandProvider";
import { GO_TO } from "./KeyboardManager";

const GENERAL: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "K"], label: "Open command palette" },
  { keys: ["/"], label: "Focus the page search" },
  { keys: ["n"], label: "Run this page's primary action" },
  { keys: ["?"], label: "Open this shortcuts sheet" },
  { keys: ["esc"], label: "Close any dialog" },
];

export function ShortcutsModal() {
  const { shortcutsOpen } = useCommandState();
  const { setShortcutsOpen } = useCommandActions();
  useEscClose(shortcutsOpen, () => setShortcutsOpen(false));
  if (!shortcutsOpen) return null;

  const close = () => setShortcutsOpen(false);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal sm" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="modal-head">
          <div>
            <h3>Keyboard shortcuts</h3>
            <p>Move through Grey FMS without the mouse</p>
          </div>
          <button className="close-x" onClick={close} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">
          <div className="sum-title">General</div>
          <div className="sc-list">
            {GENERAL.map((s) => (
              <div className="sc-row" key={s.label}>
                <span>{s.label}</span>
                <span className="sc-keys">{s.keys.map((k) => <kbd key={k} className="kbd">{k}</kbd>)}</span>
              </div>
            ))}
          </div>

          <div className="sum-title">Go to</div>
          <div className="sc-list">
            {Object.entries(GO_TO).map(([key, dest]) => (
              <div className="sc-row" key={key}>
                <span>{dest.label}</span>
                <span className="sc-keys"><kbd className="kbd">g</kbd><kbd className="kbd">{key}</kbd></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
