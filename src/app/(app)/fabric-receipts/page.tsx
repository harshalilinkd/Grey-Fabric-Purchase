import { createClient } from "@/lib/supabase/server";
import { PO_COLUMNS, PC_COLUMNS } from "@/lib/columns";
import { FabricReceiptsClient } from "@/components/fabric-receipts/FabricReceiptsClient";
import type { FabricReceipt, ProgramCard, PurchaseOrder } from "@/lib/types";

const FAB_COLUMNS = "id, receipt_id, lot_no, po_unique_id, design_no, programmed_meters, received_meters, received_date, remark, created_at";

export default async function FabricReceiptsPage() {
  const supabase = await createClient();

  const [{ data: fab }, { data: pcs }, { data: pos }, { data: qc }] = await Promise.all([
    supabase.from("fabric_receipts").select(FAB_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("program_cards").select(PC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("qc_checklist").select("lot_no"),
  ]);

  const qcLots = [...new Set(((qc ?? []) as { lot_no: string | null }[]).map((r) => r.lot_no).filter((x): x is string => !!x))];

  return (
    <FabricReceiptsClient
      initialReceipts={(fab ?? []) as FabricReceipt[]}
      initialPrograms={(pcs ?? []) as ProgramCard[]}
      initialPos={(pos ?? []) as PurchaseOrder[]}
      initialQcLots={qcLots}
    />
  );
}
