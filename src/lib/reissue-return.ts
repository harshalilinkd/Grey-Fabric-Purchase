import { createClient } from "@/lib/supabase/client";
import type { ReissueReturn, ReissueStatus } from "@/lib/types";

const RR_COLUMNS =
  "id, reissue_id, original_po_unique_id, original_lot_no, original_design_no, reissue_date, reissue_qty, reason, new_lot_no, status, created_at";

/** Every reissue/return row, newest first. */
export async function fetchReissueReturns(): Promise<ReissueReturn[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("reissue_return")
    .select(RR_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReissueReturn[];
}

/** Assign a new lot number — the failed fabric is being reissued under it. */
export async function assignNewLot(id: string, newLotNo: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("reissue_return")
    .update({ new_lot_no: newLotNo.trim() || null, status: "Reissue Pending" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Mark the failed fabric as Returned (no reissue) — clears any reissue lot for consistency. */
export async function markReturned(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("reissue_return")
    .update({ status: "Returned", new_lot_no: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Restore a row to a prior {status, new_lot_no} — used by the Undo on assign/return. */
export async function updateReissueState(
  id: string,
  patch: { status: ReissueStatus; new_lot_no: string | null },
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("reissue_return").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}
