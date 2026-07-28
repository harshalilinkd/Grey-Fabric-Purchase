import { createClient } from "@/lib/supabase/server";
import { PO_COLUMNS } from "@/lib/columns";
import { FinalReceiptsClient } from "@/components/final-receipts/FinalReceiptsClient";
import type { FinalReceipt, PurchaseOrder, WarehouseLog } from "@/lib/types";

const FR_COLUMNS = "id, receipt_id, lot_no, po_unique_id, final_qty, status, remark, received_date, created_at";
const WH_COLUMNS = "id, store_id, po_unique_id, lot_no, design_no, passed_qty, stored_date, status, created_at";

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
