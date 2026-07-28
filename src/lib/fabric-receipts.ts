import { createClient } from "@/lib/supabase/client";
import { FAB_COLUMNS } from "@/lib/columns";
import type { FabricReceipt, FabricReceiptFormValues } from "@/lib/types";

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Every fabric-receipt row (one per design received), newest first. */
export async function fetchFabricReceipts(): Promise<FabricReceipt[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("fabric_receipts")
    .select(FAB_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as FabricReceipt[];
}

/**
 * Record dyed fabric received back — one row per design that has a received value.
 * `receipt_id` carries a per-row suffix because one submit inserts many rows into the
 * UNIQUE column. `programmed_meters` is the "total should receive" snapshot.
 *
 * The follow-up fields are lot-level: `next_followup_date` and the `remaining_qty`
 * SNAPSHOT (the lot's outstanding metres immediately BEFORE this entry) are written
 * onto every row of the submit, so each line records the state it was entered under.
 * Neither is ever recalculated on read.
 */
export async function createFabricReceipt(values: FabricReceiptFormValues): Promise<void> {
  const supabase = createClient();
  const ts = Date.now();
  const rows = values.designs
    .filter((d) => d.received.trim() !== "")
    .map((d, i) => ({
      receipt_id: `FAB-${ts}${i}${Math.round(Math.random() * 1e6)}`,
      lot_no: values.lot_no.trim() || null,
      po_unique_id: values.po_unique_id || null,
      design_no: d.design_no.trim() || null,
      color: d.color.trim() || null,
      programmed_meters: d.programmed,
      received_meters: numOrNull(d.received),
      received_date: values.received_date || null,
      remark: values.remark.trim() || null,
      next_followup_date: values.next_followup_date,
      remaining_qty: values.remaining_qty,
      // Stage 3 ('original') or Stage 7 ('reissue') — same table, same fields
      cycle: values.cycle,
    }));
  if (rows.length === 0) throw new Error("Enter received metres for at least one design.");
  const { error } = await supabase.from("fabric_receipts").insert(rows);
  if (error) throw new Error(error.message);
}
