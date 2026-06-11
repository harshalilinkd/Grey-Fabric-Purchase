import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Public routes that don't require a session. */
const PUBLIC_PREFIXES = ["/login", "/auth"];

/**
 * Refreshes the Supabase session on every request and guards routes:
 *  - no session + protected route  → redirect to /login
 *  - session + on /login           → redirect to /
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // PERF: getSession() reads/refreshes the session from the cookie locally (no network
  // on the common valid-token path), instead of getUser() which hits Supabase Auth on
  // EVERY navigation. This is only the redirect gate (UX). The authoritative,
  // server-verified check stays in (app)/layout.tsx (getUser + profile + deactivated),
  // and RLS protects all data — so a forged cookie that slips past here is still rejected
  // at the layout and the database.
  // IMPORTANT: do not run code between createServerClient and the auth call.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!session && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (session && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
