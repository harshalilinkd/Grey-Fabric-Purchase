import { createClient } from "@/lib/supabase/server";
import { FinalReceiptsClient } from "@/components/final-receipts/FinalReceiptsClient";
import type { FinalReceipt, PurchaseOrder, WarehouseLog } from "@/lib/types";

const FR_COLUMNS = "id, receipt_id, lot_no, po_unique_id, final_qty, status, remark, received_date, created_at";
const WH_COLUMNS = "id, store_id, po_unique_id, lot_no, design_no, passed_qty, stored_date, status, created_at";
const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at, sourcing_path, quality_name, selling_merchant_no, vendor_design_no, sampling_status, cad_ref, handloom_ref, direct_subtype";

export default async function FinalReceiptsPage() {
  const supabase = await createClient();

  const [{ data: fr }, { data: wh }, { data: pos }] = await Promise.all([
    supabase.from("final_receipts").select(FR_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("warehouse_log").select(WH_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
  ]);

  return (
    <FinalReceiptsClient
      initialReceipts={(fr ?? []) as FinalReceipt[]}
      initialWarehouse={(wh ?? []) as WarehouseLog[]}
      initialPos={(pos ?? []) as PurchaseOrder[]}
    />
  );
}
