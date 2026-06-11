import { createClient } from "@/lib/supabase/client";
import { round2 } from "@/lib/format";
import type { QcInspection, QcSubmitInput } from "@/lib/types";

type Supabase = ReturnType<typeof createClient>;

const QC_COLUMNS =
  "id, check_id, program_uid, lot_no, design_no, checked_date, meter_qty_check, colour_check, strength_check, fabric_quality_check, overall_status, passed_qty, failed_qty, created_at";

/** All past QC inspections (one row per design checked), newest first. */
export async function fetchQcInspections(): Promise<QcInspection[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("qc_checklist")
    .select(QC_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as QcInspection[];
}

const rand6 = () => Math.floor(Math.random() * 1e6).toString();

/** Failed qty clamped into [0, received] so passed_qty can never go negative. */
const clampFailed = (input: QcSubmitInput): number =>
  input.result === "Failed" ? Math.min(Math.max(0, input.failedQty), input.receivedQty) : 0;

/** PostgREST reports a missing RPC as PGRST202 / "Could not find the function …". */
const isMissingFunction = (e: { code?: string; message?: string } | null): boolean =>
  !!e && (e.code === "PGRST202" || /could not find the function|schema cache|submit_qc_inspection/i.test(e.message ?? ""));

/**
 * Apply one QC decision to every selected design, in a single submit. For each design:
 *   passed_qty = received_qty − failed_qty (failed_qty is 0 on Pass, and clamped to ≤ received)
 *   • always: a qc_checklist row (this is what hides the lot from the Dyeing Queue / Program Cards)
 *   • if passed_qty > 0: a warehouse_log row (status "Stored")
 *   • if Fail and failed_qty > 0: a reissue_return row ("Reissue Pending" if returning, else "Returned")
 *
 * Prefers the atomic Postgres RPC (migration 006) so all writes commit-or-roll-back together. If that
 * function isn't installed yet, falls back to sequential inserts — these are NOT transactional, so they
 * write the side-effect rows first and the lot-hiding qc_checklist row last, leaving a mid-failure
 * retryable rather than stranding a hidden lot.
 */
export async function submitQcInspection(
  input: QcSubmitInput,
): Promise<{ qc: number; warehouse: number; reissue: number }> {
  const supabase = createClient();
  const failedQty = clampFailed(input);
  const passedQty = round2(input.receivedQty - failedQty);

  const payload = {
    program_uid: input.program.program_uid,
    lot_no: input.program.lot_no,
    po_unique_id: input.program.po_unique_id,
    design_nos: input.designNos,
    received_qty: input.receivedQty,
    result: input.result,
    meter_qty_check: input.checks.meter_qty_check,
    colour_check: input.checks.colour_check,
    strength_check: input.checks.strength_check,
    fabric_quality_check: input.checks.fabric_quality_check,
    failed_qty: failedQty,
    reason: input.reason,
    return_and_reissue: input.returnAndReissue,
  };

  const { data, error } = await supabase.rpc("submit_qc_inspection", { payload });
  if (!error) {
    const r = (data ?? {}) as { qc?: number; warehouse?: number; reissue?: number };
    return { qc: r.qc ?? input.designNos.length, warehouse: r.warehouse ?? 0, reissue: r.reissue ?? 0 };
  }
  if (!isMissingFunction(error)) throw new Error(error.message);

  // ---- fallback: RPC not installed (pre-migration 006) ----
  return submitSequential(supabase, input, passedQty, failedQty);
}

async function submitSequential(
  supabase: Supabase,
  input: QcSubmitInput,
  passedQty: number,
  failedQty: number,
): Promise<{ qc: number; warehouse: number; reissue: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const stamp = Date.now();

  // Side-effect rows FIRST, so if one fails the lot stays un-hidden and retryable.
  let warehouse = 0;
  if (passedQty > 0) {
    const whRows = input.designNos.map((design_no, i) => ({
      store_id: `STORE-${stamp}${i}${rand6()}`,
      po_unique_id: input.program.po_unique_id,
      lot_no: input.program.lot_no,
      design_no,
      passed_qty: passedQty,
      stored_date: today,
      status: "Stored",
    }));
    const { error } = await supabase.from("warehouse_log").insert(whRows);
    if (error) throw new Error(`Couldn't store the passed fabric: ${error.message}`);
    warehouse = whRows.length;
  }

  let reissue = 0;
  if (input.result === "Failed" && failedQty > 0) {
    const status = input.returnAndReissue ? "Reissue Pending" : "Returned";
    const reReason = input.reason.trim() || null;
    const reRows = input.designNos.map((design_no, i) => ({
      reissue_id: `RE-${stamp}${i}${rand6()}`,
      original_po_unique_id: input.program.po_unique_id,
      original_lot_no: input.program.lot_no,
      original_design_no: design_no,
      reissue_date: today,
      reissue_qty: failedQty,
      reason: reReason,
      status,
    }));
    const { error } = await supabase.from("reissue_return").insert(reRows);
    if (error) throw new Error(`Couldn't record the reissue/return: ${error.message}`);
    reissue = reRows.length;
  }

  // qc_checklist LAST — this is the row that hides the lot from the upstream screens.
  const qcRows = input.designNos.map((design_no, i) => ({
    check_id: `QC-${stamp}${i}${rand6()}`,
    program_uid: input.program.program_uid,
    lot_no: input.program.lot_no,
    design_no,
    checked_date: today,
    meter_qty_check: input.checks.meter_qty_check,
    colour_check: input.checks.colour_check,
    strength_check: input.checks.strength_check,
    fabric_quality_check: input.checks.fabric_quality_check,
    overall_status: input.result,
    passed_qty: passedQty,
    failed_qty: failedQty,
  }));
  const { error } = await supabase.from("qc_checklist").insert(qcRows);
  if (error) throw new Error(`Couldn't save the QC checklist: ${error.message}`);

  return { qc: qcRows.length, warehouse, reissue };
}
