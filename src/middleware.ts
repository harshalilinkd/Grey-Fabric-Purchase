import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (err) {
    // A throw here returns MIDDLEWARE_INVOCATION_FAILED and 500s the ENTIRE site. This is
    // only the redirect-gate UX — the (app) layout (getUser) + RLS are the authoritative
    // guards — so it's safe to fail open: log it and let the request through.
    console.error("[middleware] updateSession failed:", err);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - _next/static, _next/image, favicon
     *  - image files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
