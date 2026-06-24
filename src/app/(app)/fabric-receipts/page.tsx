import { createClient } from "@/lib/supabase/server";
import { FabricReceiptsClient } from "@/components/fabric-receipts/FabricReceiptsClient";
import type { FabricReceipt, ProgramCard, PurchaseOrder } from "@/lib/types";

const FAB_COLUMNS = "id, receipt_id, lot_no, po_unique_id, design_no, programmed_meters, received_meters, received_date, remark, created_at";
const PC_COLUMNS =
  "id, program_uid, lot_no, po_unique_id, program_date, dying_house_name, total_meters, color_cutting_attached, total_color_cutting, delivery_days, pdf_url, created_at";
const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at, sourcing_path, quality_name, selling_merchant_no, vendor_design_no, sampling_status, cad_ref, handloom_ref, direct_subtype";

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
