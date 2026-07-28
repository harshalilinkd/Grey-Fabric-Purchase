import { createClient } from "@/lib/supabase/server";
import { PO_COLUMNS, SH_COLUMNS, PC_COLUMNS } from "@/lib/columns";
import { DyeingQueueClient } from "@/components/dyeing-queue/DyeingQueueClient";
import type { Profile, ProgramCard, PurchaseOrder, Shipment } from "@/lib/types";

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
