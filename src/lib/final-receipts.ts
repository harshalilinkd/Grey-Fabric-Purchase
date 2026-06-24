import { createClient } from "@/lib/supabase/client";
import type { FinalReceipt, FinalReceiptFormValues } from "@/lib/types";

const FR_COLUMNS =
  "id, receipt_id, lot_no, po_unique_id, final_qty, status, remark, received_date, created_at";

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Every final receipt, newest first. */
export async function fetchFinalReceipts(): Promise<FinalReceipt[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("final_receipts")
    .select(FR_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as FinalReceipt[];
}

/** Record a final receipt — closes the lot with its confirmed good quantity. */
export async function createFinalReceipt(values: FinalReceiptFormValues): Promise<void> {
  const supabase = createClient();
  const receipt_id = `FR-${Date.now()}`;
  const { error } = await supabase.from("final_receipts").insert({
    receipt_id,
    lot_no: values.lot_no.trim() || null,
    po_unique_id: values.po_unique_id || null,
    final_qty: numOrNull(values.final_qty),
    status: values.status,
    remark: values.remark.trim() || null,
    received_date: values.received_date || null,
  });
  if (error) throw new Error(error.message);
}
