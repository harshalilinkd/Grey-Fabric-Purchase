import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Super-admin-only: create a new login + profile.
 *  Uses the service-role admin API (the anon key cannot create auth users). */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (me?.role !== "super_admin") {
    return NextResponse.json({ error: "Only a super admin can add members" }, { status: 403 });
  }
  if (me?.active === false) {
    return NextResponse.json({ error: "Your access has been deactivated" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    full_name?: unknown;
    email?: unknown;
    password?: unknown;
    role?: unknown;
    department?: unknown;
  };

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const role = body.role === "admin" ? "admin" : "operator";
  const department =
    typeof body.department === "string" && body.department.trim() ? body.department.trim() : null;

  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Service role key not configured on the server (.env.local → SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createErr || !created?.user) {
    return NextResponse.json({ error: createErr?.message ?? "Could not create user" }, { status: 400 });
  }

  // The signup trigger created the profile (operator + email + name); set the
  // chosen role/department/name. Service-role bypasses RLS + the guard trigger.
  const { error: updErr } = await admin
    .from("profiles")
    .update({ role, department, full_name: fullName || null })
    .eq("id", created.user.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
