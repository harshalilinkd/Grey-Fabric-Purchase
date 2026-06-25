import { createClient } from "@/lib/supabase/client";
import type { SampleApproval, SampleApprovalFormValues, SampleApprovalStatus } from "@/lib/types";

const SA_COLUMNS =
  "id, approval_id, sourcing_path, checks_method, vendor_name, quality_name, vendor_design_no, selling_merchant_no, cad_ref, handloom_ref, sample_date, remark, status, approved_date, po_unique_id, created_at";

const today = () => new Date().toISOString().slice(0, 10);
const rand6 = () => Math.floor(Math.random() * 1e6).toString();

/** All sample-approval records, newest first. */
export async function fetchSampleApprovals(): Promise<SampleApproval[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sample_approvals")
    .select(SA_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SampleApproval[];
}

/** Create a new sample request (status starts "Pending"). approval_id = "SA-{ts}{rand}". */
export async function createSampleApproval(values: SampleApprovalFormValues): Promise<void> {
  const supabase = createClient();
  const isChecks = values.sourcing_path === "checks_weaves";
  const method = isChecks ? values.checks_method || null : null;
  const { error } = await supabase.from("sample_approvals").insert({
    approval_id: `SA-${Date.now()}${rand6()}`,
    sourcing_path: values.sourcing_path || null,
    checks_method: method,
    vendor_name: values.vendor_name.trim() || null,
    quality_name: values.quality_name.trim() || null,
    vendor_design_no: values.vendor_design_no.trim() || null,
    selling_merchant_no: values.selling_merchant_no.trim() || null,
    cad_ref: isChecks && method === "cad" ? values.cad_ref.trim() || null : null,
    handloom_ref: isChecks && method === "handloom" ? values.handloom_ref.trim() || null : null,
    sample_date: values.sample_date || null,
    remark: values.remark.trim() || null,
    status: "Pending",
  });
  if (error) throw new Error(error.message);
}

/** Set a sample's status (Approved stamps approved_date; clears it otherwise). */
export async function setSampleStatus(id: string, status: SampleApprovalStatus): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("sample_approvals")
    .update({ status, approved_date: status === "Approved" ? today() : null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Link a PO raised from this approved sample. */
export async function linkSampleToPo(id: string, poUniqueId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("sample_approvals").update({ po_unique_id: poUniqueId }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Admin-only delete — via the privileged route handler. */
export async function deleteSampleApproval(id: string): Promise<void> {
  const res = await fetch(`/api/sample-approvals/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to delete sample");
  }
}
