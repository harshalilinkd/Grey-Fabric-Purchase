import { createClient } from "@/lib/supabase/client";
import { round2 } from "@/lib/format";
import { QC_OKAY, QC_REISSUE } from "@/lib/qc-status";
import { WH_FINAL, WH_WAITING } from "@/lib/warehouse-status";
import { CYCLE_REISSUE } from "@/lib/cycle";
import type { QcInspection, QcSubmitInput } from "@/lib/types";

type Supabase = ReturnType<typeof createClient>;

const QC_COLUMNS =
  "id, check_id, program_uid, lot_no, design_no, checked_date, meter_qty_check, colour_check, strength_check, fabric_quality_check, overall_status, passed_qty, failed_qty, actual_design_no, actual_color, actual_qty, remark, cycle, created_at";

/** All past QC inspection rows, newest first. One lot has many. */
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

const numOrNull = (s: string): number | null => {
  const t = (s ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Reissue qty clamped into [0, received] so the good qty can never go negative. */
const clampFailed = (input: QcSubmitInput): number =>
  input.result === QC_REISSUE ? Math.min(Math.max(0, input.failedQty), input.receivedQty) : 0;

/** PostgREST reports a missing RPC as PGRST202 / "Could not find the function …". */
const isMissingFunction = (e: { code?: string; message?: string } | null): boolean =>
  !!e && (e.code === "PGRST202" || /could not find the function|schema cache|submit_qc_inspection/i.test(e.message ?? ""));

/**
 * Record ONE inspection event against the selected designs.
 *
 * QC is incremental: this disposes of part of the lot, and the lot stays open until
 * remainingForQC reaches zero. Each row branches exactly one way, so per design we write
 * up to TWO rows — one per disposition — never a single row carrying both quantities:
 *
 *   good qty > 0    → qc_checklist (OKAY & WAITING FOR REMAINING QTY) + warehouse_log
 *   reissue qty > 0 → qc_checklist (RETURN & REISSUE)                 + reissue_return
 *
 * Prefers the atomic RPC (migration 023 replaces 006's) so every write commits or rolls
 * back together. The fallback below is NOT transactional: it writes the side-effect rows
 * first and the qc_checklist rows last, so a mid-failure leaves the lot's remaining-for-QC
 * unchanged and the event retryable.
 */
export async function submitQcInspection(
  input: QcSubmitInput,
): Promise<{ qc: number; warehouse: number; reissue: number }> {
  const supabase = createClient();
  const failedQty = clampFailed(input);
  const goodQty = round2(input.receivedQty - failedQty);

  const payload = {
    program_uid: input.program.program_uid,
    lot_no: input.program.lot_no,
    po_unique_id: input.program.po_unique_id,
    designs: input.designs.map((d) => ({
      design_no: d.design_no,
      actual_design_no: d.actual_design_no,
      actual_color: d.actual_color,
      actual_qty: d.actual_qty,
    })),
    received_qty: input.receivedQty,
    result: input.result,
    cycle: input.cycle,
    meter_qty_check: input.checks.meter_qty_check,
    colour_check: input.checks.colour_check,
    strength_check: input.checks.strength_check,
    fabric_quality_check: input.checks.fabric_quality_check,
    failed_qty: failedQty,
    reason: input.reason,
    remark: input.remark,
    return_and_reissue: input.returnAndReissue,
  };

  const { data, error } = await supabase.rpc("submit_qc_inspection", { payload });
  if (!error) {
    const r = (data ?? {}) as { qc?: number; warehouse?: number; reissue?: number };
    return { qc: r.qc ?? input.designs.length, warehouse: r.warehouse ?? 0, reissue: r.reissue ?? 0 };
  }
  if (!isMissingFunction(error)) throw new Error(error.message);

  // ---- fallback: RPC not installed ----
  return submitSequential(supabase, input, goodQty, failedQty);
}

async function submitSequential(
  supabase: Supabase,
  input: QcSubmitInput,
  goodQty: number,
  failedQty: number,
): Promise<{ qc: number; warehouse: number; reissue: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const stamp = Date.now();
  const remark = input.remark.trim() || null;
  const reason = input.reason.trim() || null;

  // Side-effect rows FIRST, so a mid-failure leaves remaining-for-QC unchanged.
  let warehouse = 0;
  if (goodQty > 0) {
    const whRows = input.designs.map((d, i) => ({
      store_id: `STORE-${stamp}${i}${rand6()}`,
      po_unique_id: input.program.po_unique_id,
      lot_no: input.program.lot_no,
      // the stored design no. is what was actually found, falling back to the programmed one
      design_no: d.actual_design_no.trim() || d.design_no,
      color: d.actual_color.trim() || null,
      passed_qty: goodQty,
      stored_date: today,
      status: WH_WAITING,
      remark,
      cycle: input.cycle,
    }));
    const { error } = await supabase.from("warehouse_log").insert(whRows);
    if (error) throw new Error(`Couldn't store the good fabric: ${error.message}`);
    warehouse = whRows.length;
  }

  let reissue = 0;
  if (failedQty > 0) {
    const status = input.returnAndReissue ? "Reissue Pending" : "Returned";
    const reRows = input.designs.map((d, i) => ({
      reissue_id: `RE-${stamp}${i}${rand6()}`,
      original_po_unique_id: input.program.po_unique_id,
      original_lot_no: input.program.lot_no,
      original_design_no: d.design_no,
      reissue_date: today,
      reissue_qty: failedQty,
      reason,
      status,
      cycle: input.cycle,
    }));
    const { error } = await supabase.from("reissue_return").insert(reRows);
    if (error) throw new Error(`Couldn't record the reissue/return: ${error.message}`);
    reissue = reRows.length;
  }

  // qc_checklist LAST — one row per design per disposition.
  const base = (d: QcSubmitInput["designs"][number], i: number, suffix: string) => ({
    check_id: `QC-${stamp}${i}${suffix}`,
    program_uid: input.program.program_uid,
    lot_no: input.program.lot_no,
    design_no: d.design_no,
    checked_date: today,
    meter_qty_check: input.checks.meter_qty_check,
    colour_check: input.checks.colour_check,
    strength_check: input.checks.strength_check,
    fabric_quality_check: input.checks.fabric_quality_check,
    actual_design_no: d.actual_design_no.trim() || null,
    actual_color: d.actual_color.trim() || null,
    actual_qty: numOrNull(d.actual_qty),
    cycle: input.cycle,
  });

  const qcRows: Record<string, unknown>[] = [];
  input.designs.forEach((d, i) => {
    if (goodQty > 0) {
      qcRows.push({ ...base(d, i, `g${rand6()}`), overall_status: QC_OKAY, passed_qty: goodQty, failed_qty: 0, remark });
    }
    if (failedQty > 0) {
      qcRows.push({ ...base(d, i, `r${rand6()}`), overall_status: QC_REISSUE, passed_qty: 0, failed_qty: failedQty, remark: remark ?? reason });
    }
  });

  const { error } = await supabase.from("qc_checklist").insert(qcRows);
  if (error) throw new Error(`Couldn't save the QC checklist: ${error.message}`);

  await stampLotWarehouseStatus(supabase, input.program.lot_no, input.cycle);

  return { qc: qcRows.length, warehouse, reissue };
}

/**
 * Stage-5/9 status for a lot ON ONE CYCLE: "Final Qty Received" once nothing remains for
 * QC on that leg, otherwise "Waiting For More Qty". Stamps every warehouse row for the
 * (lot, cycle), because a row written weeks ago must stop saying "waiting" when today's
 * inspection closes it.
 *
 * Scoped by cycle throughout: the two tracks run concurrently on the same lot, so closing
 * the reissue loop must not close the original lot — in production a lot's whole reissue
 * cycle finished in ten minutes while the original still had 750 m awaiting QC a month on.
 *
 * The RPC does this inside its transaction; this mirrors it for the fallback path.
 */
async function stampLotWarehouseStatus(supabase: Supabase, lotNo: string | null, cycle: string): Promise<void> {
  if (!lotNo) return;
  // the reissue leg's target is what came back at Stage 7, not the program card total
  const targetQ =
    cycle === CYCLE_REISSUE
      ? supabase.from("fabric_receipts").select("received_meters").eq("lot_no", lotNo).eq("cycle", CYCLE_REISSUE)
      : supabase.from("program_cards").select("total_meters").eq("lot_no", lotNo);

  const [tRes, qcRes] = await Promise.all([
    targetQ,
    supabase.from("qc_checklist").select("passed_qty, failed_qty").eq("lot_no", lotNo).eq("cycle", cycle),
  ]);
  if (tRes.error || qcRes.error) return; // best-effort: the next submit re-stamps it

  const lotQty = ((tRes.data ?? []) as { total_meters?: number | null; received_meters?: number | null }[])
    .reduce((s, r) => s + (r.total_meters ?? r.received_meters ?? 0), 0);
  const accounted = ((qcRes.data ?? []) as { passed_qty: number | null; failed_qty: number | null }[])
    .reduce((s, q) => s + (q.passed_qty ?? 0) + (q.failed_qty ?? 0), 0);
  const closed = lotQty > 0 ? accounted >= lotQty : accounted > 0;

  await supabase
    .from("warehouse_log")
    .update({ status: closed ? WH_FINAL : WH_WAITING })
    .eq("lot_no", lotNo)
    .eq("cycle", cycle);
}
