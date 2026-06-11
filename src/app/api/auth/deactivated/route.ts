import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Lands here when the app layout sees profiles.active === false.
 *  Route handlers may set cookies (Server Components can't), so the sign-out
 *  happens here, then the user is bounced to the login screen with a notice. */
export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login?deactivated=1", request.url));
}
