import { createClient } from "@/lib/supabase/client";
import type { WarehouseLog } from "@/lib/types";

const WH_COLUMNS = "id, store_id, po_unique_id, lot_no, design_no, color, passed_qty, stored_date, status, remark, cycle, created_at";

/**
 * The Ready-Goods ledger: every warehouse_log row (one per QC-passed design), newest
 * first. Read-only — entries are written by QC on a pass. The screen groups these by
 * lot, joins to the parent PO for the Quality Name, and sums stored metres.
 */
export async function fetchWarehouseLog(): Promise<WarehouseLog[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("warehouse_log")
    .select(WH_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WarehouseLog[];
}
