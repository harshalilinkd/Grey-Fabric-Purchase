import { createClient } from "@/lib/supabase/server";
import { ProgramCardsClient } from "@/components/program-cards/ProgramCardsClient";
import type { ProgramCard, PurchaseOrder, Shipment } from "@/lib/types";

const PC_COLUMNS =
  "id, program_uid, lot_no, po_unique_id, program_date, dying_house_name, total_meters, color_cutting_attached, total_color_cutting, delivery_days, pdf_url, created_at";
const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at";
const SH_COLUMNS = "id, shipment_id, po_unique_id, shipment_date, sent_quantity, lot_no, created_at";

const toLots = (rows: { lot_no: string | null }[] | null): string[] =>
  (rows ?? []).map((r) => r.lot_no).filter((x): x is string => !!x);

export default async function ProgramCardsPage() {
  const supabase = await createClient();

  const [{ data: pcs }, { data: pos }, { data: ships }, { data: qcLots }] = await Promise.all([
    supabase.from("program_cards").select(PC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("shipments").select(SH_COLUMNS).order("shipment_date", { ascending: false }),
    supabase.from("qc_checklist").select("lot_no"),
  ]);

  return (
    <ProgramCardsClient
      initialProgramCards={(pcs ?? []) as ProgramCard[]}
      initialPos={(pos ?? []) as PurchaseOrder[]}
      initialShipments={(ships ?? []) as Shipment[]}
      initialQcLots={toLots(qcLots)}
    />
  );
}
