import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Verify the caller is an active super admin and the target is editable.
 *  Returns the target row, or a NextResponse to short-circuit with an error. */
async function guard(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };

  const { data: me } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (me?.role !== "super_admin") {
    return { error: NextResponse.json({ error: "Only a super admin can manage team access" }, { status: 403 }) };
  }
  if (me?.active === false) {
    return { error: NextResponse.json({ error: "Your access has been deactivated" }, { status: 403 }) };
  }
  if (id === user.id) {
    return { error: NextResponse.json({ error: "You can't change your own access" }, { status: 400 }) };
  }

  const { data: target } = await supabase.from("profiles").select("*").eq("id", id).single();
  if (!target) return { error: NextResponse.json({ error: "Member not found" }, { status: 404 }) };
  if (target.role === "super_admin") {
    return { error: NextResponse.json({ error: "Super admin accounts can't be modified" }, { status: 403 }) };
  }

  return { supabase };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.error) return g.error;
  const supabase = g.supabase;

  const body = (await request.json().catch(() => ({}))) as {
    full_name?: unknown;
    email?: unknown;
    role?: unknown;
    department?: unknown;
    active?: unknown;
    password?: unknown;
  };

  // ---- profile fields (RLS + guard trigger still apply) ----
  const patch: Record<string, unknown> = {};
  if (body.full_name !== undefined) {
    patch.full_name = typeof body.full_name === "string" && body.full_name.trim() ? body.full_name.trim() : null;
  }
  if (body.department !== undefined) {
    patch.department = typeof body.department === "string" && body.department.trim() ? body.department.trim() : null;
  }
  if (body.role !== undefined) {
    if (body.role !== "admin" && body.role !== "operator") {
      return NextResponse.json({ error: "Role must be 'admin' or 'operator'" }, { status: 400 });
    }
    patch.role = body.role;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "'active' must be a boolean" }, { status: 400 });
    }
    patch.active = body.active;
  }

  // ---- auth-level changes (need the service role) ----
  const newEmail = typeof body.email === "string" && body.email.trim() ? body.email.trim() : undefined;
  const newPassword = typeof body.password === "string" && body.password ? body.password : undefined;

  if (newEmail || newPassword) {
    if (newPassword && newPassword.length < 6) {
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
    const attrs: { email?: string; email_confirm?: boolean; password?: string } = {};
    if (newEmail) {
      attrs.email = newEmail;
      attrs.email_confirm = true;
    }
    if (newPassword) attrs.password = newPassword;
    const { error: authErr } = await admin.auth.admin.updateUserById(id, attrs);
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 });
    if (newEmail) patch.email = newEmail; // keep the profile mirror in sync
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("profiles").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.error) return g.error;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Service role key not configured on the server (.env.local → SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  // deleting the auth user cascades the profile row (FK on delete cascade)
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
