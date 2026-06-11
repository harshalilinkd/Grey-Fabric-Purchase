import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Admin-only delete. RLS also enforces this, but we check the role here so we
 *  can return a clear 403 (instead of a silent 0-row delete) for non-admins.
 *  Deleting a PO does NOT touch its shipments/programs (no cascade by design). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "Only admins can delete purchase orders" }, { status: 403 });
  }
  if (profile?.active === false) {
    return NextResponse.json({ error: "Your access has been deactivated" }, { status: 403 });
  }

  const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
