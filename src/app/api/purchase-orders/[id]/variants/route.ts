import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type VariantIn = { code?: unknown; color_name?: unknown; meters?: unknown };

/**
 * Replace a PO's colour variants in one shot (delete-all + insert the new set).
 *
 * Any authenticated user who can edit a PO may manage its colour split. We use the
 * service-role client only to satisfy the admin-only DELETE policy on po_color_variants
 * (migration 007) during re-sync — an operator removing a colour row in the PO form
 * can't issue a direct client delete. The PO itself is still admin-only to delete.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // The (app)/layout bounce only guards page navigations — this is a service-role route,
  // so reject deactivated accounts here too (mirrors the PO delete + team routes).
  const { data: profile } = await supabase.from("profiles").select("active").eq("id", user.id).single();
  if (profile?.active === false) {
    return NextResponse.json({ error: "Your access has been deactivated" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { variants?: VariantIn[] };
  const incoming = Array.isArray(body.variants) ? body.variants : [];
  if (incoming.length > 50) {
    return NextResponse.json({ error: "Too many colour variants (max 50)" }, { status: 400 });
  }
  const rows = incoming.map((x) => ({
    purchase_order: id,
    code: typeof x.code === "string" && x.code.trim() ? x.code.trim() : null,
    color_name: typeof x.color_name === "string" && x.color_name.trim() ? x.color_name.trim() : null,
    meters: typeof x.meters === "number" && Number.isFinite(x.meters) ? x.meters : null,
  }));

  const admin = createAdminClient();

  const { error: delErr } = await admin.from("po_color_variants").delete().eq("purchase_order", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

  if (rows.length) {
    const { error: insErr } = await admin.from("po_color_variants").insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
