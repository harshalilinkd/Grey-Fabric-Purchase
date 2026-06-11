import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client (Client Components). Session lives in cookies. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
