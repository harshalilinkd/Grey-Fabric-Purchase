import { createClient } from "@/lib/supabase/server";
import { QcInspectionClient } from "@/components/qc-inspection/QcInspectionClient";
import type { ProgramCard, PurchaseOrder, QcInspection } from "@/lib/types";

const QC_COLUMNS =
  "id, check_id, program_uid, lot_no, design_no, checked_date, meter_qty_check, colour_check, strength_check, fabric_quality_check, overall_status, passed_qty, failed_qty, created_at";
const PC_COLUMNS =
  "id, program_uid, lot_no, po_unique_id, program_date, dying_house_name, total_meters, color_cutting_attached, total_color_cutting, delivery_days, pdf_url, created_at";
const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at";

export default async function QcInspectionPage() {
  const supabase = await createClient();

  const [{ data: qcs }, { data: pcs }, { data: pos }] = await Promise.all([
    supabase.from("qc_checklist").select(QC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("program_cards").select(PC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
  ]);

  return (
    <QcInspectionClient
      initialInspections={(qcs ?? []) as QcInspection[]}
      initialPrograms={(pcs ?? []) as ProgramCard[]}
      initialPos={(pos ?? []) as PurchaseOrder[]}
    />
  );
}
