import { createClient } from "@/lib/supabase/server";
import { PO_COLUMNS, PC_COLUMNS } from "@/lib/columns";
import { WarehouseClient } from "@/components/warehouse/WarehouseClient";
import type { ProgramCard, PurchaseOrder, ReissueReturn, WarehouseLog } from "@/lib/types";

const WH_COLUMNS = "id, store_id, po_unique_id, lot_no, design_no, passed_qty, stored_date, status, created_at";
const RR_COLUMNS =
  "id, reissue_id, original_po_unique_id, original_lot_no, original_design_no, reissue_date, reissue_qty, reason, new_lot_no, status, created_at";

export default async function WarehousePage() {
  const supabase = await createClient();

  const [{ data: wh }, { data: pos }, { data: pcs }, { data: rr }] = await Promise.all([
    supabase.from("warehouse_log").select(WH_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("program_cards").select(PC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("reissue_return").select(RR_COLUMNS).order("created_at", { ascending: false }),
  ]);

  return (
    <WarehouseClient
      initialWarehouse={(wh ?? []) as WarehouseLog[]}
      initialPos={(pos ?? []) as PurchaseOrder[]}
      initialPrograms={(pcs ?? []) as ProgramCard[]}
      initialReissues={(rr ?? []) as ReissueReturn[]}
    />
  );
}
