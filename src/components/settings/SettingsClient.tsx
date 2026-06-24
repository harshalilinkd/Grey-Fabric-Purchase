"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TeamClient } from "./TeamClient";
import { MasterListsClient } from "./MasterListsClient";
import { ProfileTab } from "./ProfileTab";
import { fetchTeam } from "@/lib/team";
import type { TeamMember } from "@/lib/types";

type Tab = "team" | "masters" | "profile";

export function SettingsClient({ initialTeam, selfId }: { initialTeam: TeamMember[]; selfId: string }) {
  const { data: team = [] } = useQuery({ queryKey: ["team"], queryFn: fetchTeam, initialData: initialTeam });
  const me = team.find((m) => m.id === selfId) ?? null;
  const isAdmin = me?.role === "admin" || me?.role === "super_admin";

  const [tab, setTab] = useState<Tab>("team");

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p>Team access, master lists &amp; your profile</p>
      </div>

      <div className="seg" role="group" aria-label="Settings section" style={{ marginBottom: 16 }}>
        <button className={tab === "team" ? "on" : ""} aria-pressed={tab === "team"} onClick={() => setTab("team")}>Team</button>
        <button className={tab === "masters" ? "on" : ""} aria-pressed={tab === "masters"} onClick={() => setTab("masters")}>Master Lists</button>
        <button className={tab === "profile" ? "on" : ""} aria-pressed={tab === "profile"} onClick={() => setTab("profile")}>Profile</button>
      </div>

      {tab === "team" && <TeamClient initialTeam={initialTeam} selfId={selfId} />}
      {tab === "masters" && <MasterListsClient isAdmin={isAdmin} />}
      {tab === "profile" && <ProfileTab me={me} />}
    </>
  );
}
