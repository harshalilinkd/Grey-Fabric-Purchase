import { createClient } from "@/lib/supabase/server";
import { PurchaseOrdersClient } from "@/components/purchase-orders/PurchaseOrdersClient";
import type { Profile, PurchaseOrder } from "@/lib/types";

const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at";

export default async function PurchaseOrdersPage() {
  const supabase = await createClient();

  const [{ data: rows }, { data: userData }] = await Promise.all([
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
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

  return <PurchaseOrdersClient initialData={(rows ?? []) as PurchaseOrder[]} isAdmin={isAdmin} />;
}
