import { createClient } from "@/lib/supabase/server";
import { PO_COLUMNS, SH_COLUMNS } from "@/lib/columns";
import { GreyHouseClient } from "@/components/grey-house/GreyHouseClient";
import type { Profile, PurchaseOrder, Shipment } from "@/lib/types";

export default async function GreyHouseFollowUpPage() {
  const supabase = await createClient();

  const [{ data: pos }, { data: ships }, { data: userData }] = await Promise.all([
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("shipments").select(SH_COLUMNS).order("shipment_date", { ascending: false }),
    supabase.auth.getUser(),
  ]);

  let isAdmin = false;
  if (userData.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single<Pick<Profile, "role">>();
    isAdmin = profile?.role === "admin";
  }

  return (
    <GreyHouseClient
      initialPos={(pos ?? []) as PurchaseOrder[]}
      initialShipments={(ships ?? []) as Shipment[]}
      isAdmin={isAdmin}
    />
  );
}
