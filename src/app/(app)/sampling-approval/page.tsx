import { createClient } from "@/lib/supabase/server";
import { SampleApprovalClient } from "@/components/sample-approval/SampleApprovalClient";
import type { Profile, SampleApproval } from "@/lib/types";

const SA_COLUMNS =
  "id, approval_id, sourcing_path, checks_method, vendor_name, quality_name, vendor_design_no, selling_merchant_no, cad_ref, handloom_ref, sample_date, remark, status, approved_date, po_unique_id, created_at";

export default async function SamplingApprovalPage() {
  const supabase = await createClient();

  const [{ data: rows }, { data: userData }] = await Promise.all([
    supabase.from("sample_approvals").select(SA_COLUMNS).order("created_at", { ascending: false }),
    supabase.auth.getUser(),
  ]);

  let isAdmin = false;
  if (userData.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single<Pick<Profile, "role">>();
    isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  }

  return <SampleApprovalClient initialSamples={(rows ?? []) as SampleApproval[]} isAdmin={isAdmin} />;
}
