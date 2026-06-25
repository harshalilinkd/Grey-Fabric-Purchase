import { createClient } from "@/lib/supabase/server";
import { DyeingQueueClient } from "@/components/dyeing-queue/DyeingQueueClient";
import type { Profile, ProgramCard, PurchaseOrder, Shipment } from "@/lib/types";

const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at, sourcing_path, quality_name, selling_merchant_no, vendor_design_no, sampling_status, cad_ref, handloom_ref, direct_subtype";
const SH_COLUMNS = "id, shipment_id, po_unique_id, shipment_date, sent_quantity, lot_no, created_at";
const PC_COLUMNS =
  "id, program_uid, lot_no, po_unique_id, program_date, dying_house_name, total_meters, color_cutting_attached, total_color_cutting, delivery_days, pdf_url, created_at";

const toLots = (rows: { lot_no: string | null }[] | null): string[] =>
  (rows ?? []).map((r) => r.lot_no).filter((x): x is string => !!x);

export default async function DyeingQueuePage() {
  const supabase = await createClient();

  const [{ data: ships }, { data: pos }, { data: pcs }, { data: qcLots }, { data: userData }] = await Promise.all([
    supabase.from("shipments").select(SH_COLUMNS).order("shipment_date", { ascending: false }),
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("program_cards").select(PC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("qc_checklist").select("lot_no"),
    supabase.auth.getUser(),
  ]);

  let isAdmin = false;
  if (userData.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single<Pick<Profile, "role">>();
    isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  }

  return (
    <DyeingQueueClient
      initialShipments={(ships ?? []) as Shipment[]}
      initialPos={(pos ?? []) as PurchaseOrder[]}
      initialPrograms={(pcs ?? []) as ProgramCard[]}
      initialQcLots={toLots(qcLots)}
      isAdmin={isAdmin}
    />
  );
}
