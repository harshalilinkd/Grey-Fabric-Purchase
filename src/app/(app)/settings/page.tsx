import { createClient } from "@/lib/supabase/server";
import { SettingsClient } from "@/components/settings/SettingsClient";
import type { TeamMember } from "@/lib/types";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS scopes this list: operators see only themselves, admins+ see everyone.
  const { data: team } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  return <SettingsClient initialTeam={(team ?? []) as TeamMember[]} selfId={user?.id ?? ""} />;
}
