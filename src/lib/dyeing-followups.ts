import { createClient } from "@/lib/supabase/client";
import type { DyeingFollowup, DyeingFollowupFormValues } from "@/lib/types";

const DF_COLUMNS =
  "id, followup_id, lot_no, po_unique_id, dying_house_name, remaining_meters, next_followup_date, remark, created_at";

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Every dyeing-house follow-up, newest first. */
export async function fetchDyeingFollowups(): Promise<DyeingFollowup[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dyeing_followups")
    .select(DF_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DyeingFollowup[];
}

/** Log a follow-up for a lot at the dyeing house. */
export async function createDyeingFollowup(values: DyeingFollowupFormValues): Promise<void> {
  const supabase = createClient();
  const followup_id = `DF-${Date.now()}`;
  const { error } = await supabase.from("dyeing_followups").insert({
    followup_id,
    lot_no: values.lot_no.trim() || null,
    po_unique_id: values.po_unique_id || null,
    dying_house_name: values.dying_house_name.trim() || null,
    remaining_meters: numOrNull(values.remaining_meters),
    next_followup_date: values.next_followup_date || null,
    remark: values.remark.trim() || null,
  });
  if (error) throw new Error(error.message);
}
