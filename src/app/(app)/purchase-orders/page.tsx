import { createClient } from "@/lib/supabase/server";
import { PO_COLUMNS } from "@/lib/columns";
import { PurchaseOrdersClient } from "@/components/purchase-orders/PurchaseOrdersClient";
import type { Profile, PurchaseOrder } from "@/lib/types";

export default async function PurchaseOrdersPage() {
  const supabase = await createClient();

  const [{ data: rows }, { data: qualityRows }, { data: userData }] = await Promise.all([
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("qualities").select("name, active").order("name", { ascending: true }),
    supabase.auth.getUser(),
  ]);

  const qualityNames = ((qualityRows ?? []) as { name: string | null; active: boolean | null }[])
    .filter((r) => r.active !== false && !!r.name)
    .map((r) => r.name as string);

  let isAdmin = false;
  let isSuperAdmin = false;
  if (userData.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single<Pick<Profile, "role">>();
    isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
    isSuperAdmin = profile?.role === "super_admin";
  }

  return (
    <PurchaseOrdersClient
      initialData={(rows ?? []) as PurchaseOrder[]}
      isAdmin={isAdmin}
      isSuperAdmin={isSuperAdmin}
      initialQualityNames={qualityNames}
    />
  );
}
