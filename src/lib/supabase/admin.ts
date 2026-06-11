import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-ONLY Supabase client using the service-role key — it BYPASSES RLS and
 * can manage auth users (create / delete / update email + password).
 *
 * NEVER import this into a Client Component. Only use it inside route handlers
 * after verifying the caller is a super admin.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the server environment (.env.local).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // accept either env var name
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) is not configured on the server");
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
