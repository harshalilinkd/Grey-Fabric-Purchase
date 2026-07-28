import { createClient } from "@/lib/supabase/client";
import { CYCLE_ORIGINAL, CYCLE_REISSUE } from "@/lib/cycle";
import { DF_COLUMNS } from "@/lib/columns";
import type { DyeingFollowup, DyeingFollowupFormValues } from "@/lib/types";

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Every dispatch to a dyeing house, newest first. */
export async function fetchDyeingFollowups(): Promise<DyeingFollowup[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dyeing_followups")
    .select(DF_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DyeingFollowup[];
}

/**
 * Record a dispatch of metres out to a dyeing house.
 *
 * BOTH legs live in this one table, told apart by `cycle` (migration 025):
 *   'original' — the FIRST trip out, recorded per LOT once its program card exists. The
 *                lot and its card travel together (or, on a drop-shipped lot, the card
 *                travels alone to rolls already at the dyer).
 *   'reissue'  — Stage 6 proper: QC-rejected metres going back out, recorded per PO,
 *                because one parcel bundles rejected metres from several lots.
 * The grains differ deliberately, so `lot_no` is set on the original leg and left blank
 * on the reissue leg. The column default is 'reissue'; we always write the value
 * explicitly rather than relying on it.
 *
 * `sent_qty` is the quantity dispatched — what the return is reconciled against;
 * `remaining_meters` is the outstanding balance, a different number entirely.
 */
export async function createDyeingFollowup(values: DyeingFollowupFormValues): Promise<void> {
  const supabase = createClient();
  const followup_id = `DF-${Date.now()}`;
  const cycle = values.cycle === CYCLE_ORIGINAL ? CYCLE_ORIGINAL : CYCLE_REISSUE;
  const { error } = await supabase.from("dyeing_followups").insert({
    followup_id,
    lot_no: values.lot_no.trim() || null,
    po_unique_id: values.po_unique_id || null,
    dying_house_name: values.dying_house_name.trim() || null,
    sent_qty: numOrNull(values.sent_qty),
    cycle,
    remaining_meters: numOrNull(values.remaining_meters),
    next_followup_date: values.next_followup_date || null,
    remark: values.remark.trim() || null,
  });
  if (error) throw new Error(error.message);
}
