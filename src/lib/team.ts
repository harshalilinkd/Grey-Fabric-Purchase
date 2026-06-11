import { createClient } from "@/lib/supabase/client";
import type { TeamMember } from "@/lib/types";

/** Fields a super admin may change on another member. */
export type TeamPatch = {
  full_name?: string | null;
  email?: string;
  role?: "admin" | "operator";
  department?: string | null;
  active?: boolean;
  /** new login password; leave undefined to keep the current one */
  password?: string;
};

/** Payload for creating a brand-new member (login + profile). */
export type NewMember = {
  full_name: string;
  email: string;
  password: string;
  role: "admin" | "operator";
  department: string | null;
};

/** RLS scopes this: operators get only their own row; admins+ get everyone. */
export async function fetchTeam(): Promise<TeamMember[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamMember[];
}

/** Super-admin-only — creates the auth login + profile via the admin route. */
export async function createTeamMember(input: NewMember): Promise<void> {
  const res = await fetch("/api/team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to add member");
  }
}

/** Super-admin-only — update name / email / role / department / active / password. */
export async function updateTeamMember(id: string, patch: TeamPatch): Promise<void> {
  const res = await fetch(`/api/team/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to update team member");
  }
}

/** Super-admin-only — permanently deletes the login + profile. */
export async function deleteTeamMember(id: string): Promise<void> {
  const res = await fetch(`/api/team/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to delete member");
  }
}
