import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import type {
  DyeingFollowup,
  FabricReceipt,
  FinalReceipt,
  ProgramCard,
  PurchaseOrder,
  QcInspection,
  ReissueReturn,
  Shipment,
  WarehouseLog,
} from "@/lib/types";

const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at, sourcing_path, quality_name, selling_merchant_no, vendor_design_no, sampling_status, cad_ref, handloom_ref, direct_subtype";
const SH_COLUMNS = "id, shipment_id, po_unique_id, shipment_date, sent_quantity, lot_no, created_at";
const PC_COLUMNS =
  "id, program_uid, lot_no, po_unique_id, program_date, dying_house_name, total_meters, color_cutting_attached, total_color_cutting, delivery_days, pdf_url, created_at";
const QC_COLUMNS =
  "id, check_id, program_uid, lot_no, design_no, checked_date, meter_qty_check, colour_check, strength_check, fabric_quality_check, overall_status, passed_qty, failed_qty, created_at";
const WH_COLUMNS = "id, store_id, po_unique_id, lot_no, design_no, passed_qty, stored_date, status, created_at";
const RR_COLUMNS =
  "id, reissue_id, original_po_unique_id, original_lot_no, original_design_no, reissue_date, reissue_qty, reason, new_lot_no, status, created_at";
const FAB_COLUMNS = "id, receipt_id, lot_no, po_unique_id, design_no, programmed_meters, received_meters, received_date, remark, created_at";
const DF_COLUMNS = "id, followup_id, lot_no, po_unique_id, dying_house_name, remaining_meters, next_followup_date, remark, created_at";
const FR_COLUMNS = "id, receipt_id, lot_no, po_unique_id, final_qty, status, remark, received_date, created_at";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [po, sh, pc, qc, wh, rr, fab, df, fr] = await Promise.all([
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("shipments").select(SH_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("program_cards").select(PC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("qc_checklist").select(QC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("warehouse_log").select(WH_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("reissue_return").select(RR_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("fabric_receipts").select(FAB_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("dyeing_followups").select(DF_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("final_receipts").select(FR_COLUMNS).order("created_at", { ascending: false }),
  ]);

  return (
    <DashboardClient
      initialPos={(po.data ?? []) as PurchaseOrder[]}
      initialShipments={(sh.data ?? []) as Shipment[]}
      initialPrograms={(pc.data ?? []) as ProgramCard[]}
      initialQc={(qc.data ?? []) as QcInspection[]}
      initialWarehouse={(wh.data ?? []) as WarehouseLog[]}
      initialReissues={(rr.data ?? []) as ReissueReturn[]}
      initialFabric={(fab.data ?? []) as FabricReceipt[]}
      initialFollowups={(df.data ?? []) as DyeingFollowup[]}
      initialFinals={(fr.data ?? []) as FinalReceipt[]}
    />
  );
}
