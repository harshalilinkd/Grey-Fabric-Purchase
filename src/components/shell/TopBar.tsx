"use client";

import { useTheme } from "@/components/theme/ThemeProvider";
import { Icon } from "@/components/ui/Icon";
import { useCommandActions } from "@/components/experience/CommandProvider";
import { useLiveStatus } from "@/components/experience/RealtimeProvider";
import type { Profile } from "@/lib/types";

const LIVE_LABEL: Record<string, string> = { live: "Live", connecting: "Connecting", offline: "Offline" };

export function TopBar({
  onToggleSidebar,
  profile,
  email,
}: {
  onToggleSidebar: () => void;
  profile: Profile;
  email: string;
}) {
  const { theme, toggle, mounted } = useTheme();
  const isDark = mounted && theme === "dark";
  const { togglePalette, setShortcutsOpen } = useCommandActions();
  const live = useLiveStatus();

  const name = profile.full_name?.trim() || email || "User";
  const firstName = name.split(/\s+/)[0];

  return (
    <header className="topnav">
      <div className="tn-left">
        <button className="icon-btn" onClick={onToggleSidebar} aria-label="Toggle navigation">
          <Icon name="menu" />
        </button>
        <div className="tn-greet">
          Good afternoon, <b>{firstName}</b>
        </div>
      </div>

      <div className="tn-right">
        <button
          className="cmdk-trigger"
          onClick={togglePalette}
          aria-label="Open command palette"
          title="Command palette"
        >
          <Icon name="search" size={15} />
          <span>Search</span>
          <kbd className="kbd">⌘K</kbd>
        </button>

        <div className={`conn-dot ${live}`} title={`Realtime connection: ${LIVE_LABEL[live]}`}>
          <i />
          {LIVE_LABEL[live]}
        </div>

        <button
          className="icon-btn"
          onClick={() => setShortcutsOpen(true)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          <Icon name="keyboard" />
        </button>
        <button
          className="icon-btn"
          onClick={toggle}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <Icon name={isDark ? "moon" : "sun"} />
        </button>
        <button className="icon-btn" aria-label="Notifications">
          <Icon name="bell" />
          <span className="badge-dot" />
        </button>
      </div>
    </header>
  );
}
