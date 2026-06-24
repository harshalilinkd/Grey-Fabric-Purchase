"use client";

import { Icon } from "@/components/ui/Icon";
import { useTheme } from "@/components/theme/ThemeProvider";
import type { TeamMember } from "@/lib/types";

const ROLE_LABEL: Record<string, string> = { super_admin: "Super admin", admin: "Admin", operator: "Operator" };
const ROLE_PILL: Record<string, string> = { super_admin: "brand", admin: "info", operator: "plain" };

export function ProfileTab({ me }: { me: TeamMember | null }) {
  const { theme, toggle, mounted } = useTheme();
  const role = me?.role ?? "operator";

  return (
    <div className="panel first">
      <div className="panel-head"><h3>Your profile</h3></div>
      <div className="panel-body">
        <div className="sum">
          <div className="sum-row"><span>Name</span><b>{me?.full_name ?? "—"}</b></div>
          <div className="sum-row"><span>Email</span><b>{me?.email ?? "—"}</b></div>
          <div className="sum-row">
            <span>Role</span>
            <b><span className={`pill ${ROLE_PILL[role] ?? "plain"}`}>{ROLE_LABEL[role] ?? role}</span></b>
          </div>
          <div className="sum-row">
            <span>Theme</span>
            <button className="btn btn-ghost" onClick={toggle} aria-label="Toggle light/dark theme">
              <Icon name={mounted && theme === "dark" ? "sun" : "moon"} size={15} />
              {mounted ? (theme === "dark" ? "Switch to light" : "Switch to dark") : "Theme"}
            </button>
          </div>
        </div>
        <div className="subtle-note">
          <Icon name="info" size={16} />
          <span>Your role is set by a super admin in the Team tab. Theme also lives in the top bar and is remembered on this device.</span>
        </div>
      </div>
    </div>
  );
}
