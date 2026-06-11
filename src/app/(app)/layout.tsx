import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/shell/AppShell";
import type { Profile } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards this, but double-check on the server.
  if (!user) redirect("/login");

  // select("*") so this keeps working before migration 003 adds email/active.
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Deactivated by a super admin → sign out (route handler) + login notice.
  if (profile?.active === false) redirect("/api/auth/deactivated");

  const display: Profile = (profile as Profile | null) ?? {
    id: user.id,
    full_name: user.email ?? null,
    role: "operator",
  };

  return (
    <AppShell profile={display} email={user.email ?? ""}>
      {children}
    </AppShell>
  );
}
