import { createClient } from "@/lib/supabase/client";

export type MasterTable = "qualities" | "vendors" | "dyeing_houses" | "processes";

export type MasterRow = { id: string; name: string; active: boolean; created_at?: string };

/** The master lists managed in Settings, in display order. */
export const MASTER_META: { table: MasterTable; label: string; singular: string }[] = [
  { table: "qualities", label: "Quality Names", singular: "quality name" },
  { table: "vendors", label: "Vendors", singular: "vendor" },
  { table: "dyeing_houses", label: "Dyeing Houses", singular: "dyeing house" },
  { table: "processes", label: "Processes", singular: "process" },
];

/** All entries of a master (including inactive) — for the management list. */
export async function fetchMasters(table: MasterTable): Promise<MasterRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from(table).select("id, name, active, created_at").order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MasterRow[];
}

/** Active entry names of a master — for the form dropdowns. Empty (not throwing) if
 *  the `active` column isn't there yet (pre-migration 012), so forms keep working. */
export async function fetchActiveMasterNames(table: MasterTable): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from(table).select("name, active").order("name", { ascending: true });
  if (error) return [];
  return ((data ?? []) as { name: string | null; active: boolean | null }[])
    .filter((r) => r.active !== false && !!r.name)
    .map((r) => r.name as string);
}

export async function createMaster(table: MasterTable, name: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(table).insert({ name: name.trim() });
  if (error) throw new Error(error.message);
}

export async function updateMaster(table: MasterTable, id: string, patch: { name?: string; active?: boolean }): Promise<void> {
  const supabase = createClient();
  const clean: { name?: string; active?: boolean } = {};
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.active !== undefined) clean.active = patch.active;
  const { error } = await supabase.from(table).update(clean).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Admin-only — via the privileged route handler so the role is enforced with a clear error. */
export async function deleteMaster(table: MasterTable, id: string): Promise<void> {
  const res = await fetch(`/api/masters/${table}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to delete entry");
  }
}
