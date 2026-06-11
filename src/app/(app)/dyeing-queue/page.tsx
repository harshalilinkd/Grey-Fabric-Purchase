import { createClient } from "@/lib/supabase/server";
import { DyeingQueueClient } from "@/components/dyeing-queue/DyeingQueueClient";
import type { PurchaseOrder, Shipment } from "@/lib/types";

const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at";
const SH_COLUMNS = "id, shipment_id, po_unique_id, shipment_date, sent_quantity, lot_no, created_at";

const toLots = (rows: { lot_no: string | null }[] | null): string[] =>
  (rows ?? []).map((r) => r.lot_no).filter((x): x is string => !!x);

export default async function DyeingQueuePage() {
  const supabase = await createClient();

  const [{ data: ships }, { data: pos }, { data: pcLots }, { data: qcLots }] = await Promise.all([
    supabase.from("shipments").select(SH_COLUMNS).order("shipment_date", { ascending: false }),
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("program_cards").select("lot_no"),
    supabase.from("qc_checklist").select("lot_no"),
  ]);

  return (
    <DyeingQueueClient
      initialShipments={(ships ?? []) as Shipment[]}
      initialPos={(pos ?? []) as PurchaseOrder[]}
      initialProgramLots={toLots(pcLots)}
      initialQcLots={toLots(qcLots)}
    />
  );
}
