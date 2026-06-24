import { createClient } from "@/lib/supabase/server";
import { DyeingFollowupClient } from "@/components/dyeing-follow-up/DyeingFollowupClient";
import type { DyeingFollowup, ProgramCard, PurchaseOrder } from "@/lib/types";

const DF_COLUMNS = "id, followup_id, lot_no, po_unique_id, dying_house_name, remaining_meters, next_followup_date, remark, created_at";
const PC_COLUMNS =
  "id, program_uid, lot_no, po_unique_id, program_date, dying_house_name, total_meters, color_cutting_attached, total_color_cutting, delivery_days, pdf_url, created_at";
const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at, sourcing_path, quality_name, selling_merchant_no, vendor_design_no, sampling_status, cad_ref, handloom_ref, direct_subtype";

export default async function DyeingFollowUpPage() {
  const supabase = await createClient();

  const [{ data: df }, { data: pcs }, { data: pos }, { data: qc }] = await Promise.all([
    supabase.from("dyeing_followups").select(DF_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("program_cards").select(PC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("qc_checklist").select("lot_no"),
  ]);

  const qcLots = [...new Set(((qc ?? []) as { lot_no: string | null }[]).map((r) => r.lot_no).filter((x): x is string => !!x))];

  return (
    <DyeingFollowupClient
      initialFollowups={(df ?? []) as DyeingFollowup[]}
      initialPrograms={(pcs ?? []) as ProgramCard[]}
      initialPos={(pos ?? []) as PurchaseOrder[]}
      initialQcLots={qcLots}
    />
  );
}
