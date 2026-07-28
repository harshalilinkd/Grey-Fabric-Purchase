import { createClient } from "@/lib/supabase/server";
import { PO_COLUMNS, PC_COLUMNS } from "@/lib/columns";
import { QcInspectionClient } from "@/components/qc-inspection/QcInspectionClient";
import type { ProgramCard, PurchaseOrder, QcInspection } from "@/lib/types";

const QC_COLUMNS =
  "id, check_id, program_uid, lot_no, design_no, checked_date, meter_qty_check, colour_check, strength_check, fabric_quality_check, overall_status, passed_qty, failed_qty, created_at";

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
