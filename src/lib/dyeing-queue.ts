import { createClient } from "@/lib/supabase/client";

const onlyLotNos = (rows: { lot_no: string | null }[] | null): string[] =>
  (rows ?? []).map((r) => r.lot_no).filter((x): x is string => !!x);

/** lot_no values that already have a program card (→ "Program Created"). */
export async function fetchProgramCardLotNos(): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("program_cards").select("lot_no");
  if (error) throw new Error(error.message);
  return onlyLotNos(data);
}

/**
 * lot_no values that are CLOSED — fully accounted for by QC, i.e. remainingForQC = 0.
 *
 * QC is incremental: a lot routinely has several inspection rows over weeks, each
 * disposing of part of it. So a lot must NOT disappear from the upstream screens on its
 * first inspection — only when nothing remains:
 *
 *   remainingForQC = lot qty − (goodQty + reissueQty)
 *
 * where lot qty is what was programmed to the dyeing house. Rows with no program card
 * (finished-goods receipts, which are QC'd on arrival and have no dyeing program) have
 * no lot qty to compare against, so any QC on them closes them.
 */
export async function fetchClosedQcLotNos(): Promise<string[]> {
  const supabase = createClient();
  const [qcRes, pcRes] = await Promise.all([
    supabase.from("qc_checklist").select("lot_no, passed_qty, failed_qty"),
    supabase.from("program_cards").select("lot_no, total_meters"),
  ]);
  if (qcRes.error) throw new Error(qcRes.error.message);
  if (pcRes.error) throw new Error(pcRes.error.message);

  const target: Record<string, number> = {};
  for (const p of (pcRes.data ?? []) as { lot_no: string | null; total_meters: number | null }[]) {
    if (p.lot_no) target[p.lot_no] = (target[p.lot_no] ?? 0) + (p.total_meters ?? 0);
  }

  const accounted: Record<string, number> = {};
  for (const q of (qcRes.data ?? []) as { lot_no: string | null; passed_qty: number | null; failed_qty: number | null }[]) {
    if (!q.lot_no) continue;
    accounted[q.lot_no] = (accounted[q.lot_no] ?? 0) + (q.passed_qty ?? 0) + (q.failed_qty ?? 0);
  }

  return Object.keys(accounted).filter((lot) => {
    const lotQty = target[lot] ?? 0;
    return lotQty > 0 ? accounted[lot] >= lotQty : accounted[lot] > 0;
  });
}
