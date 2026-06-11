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

/** lot_no values that have been QC'd (→ hidden from the dyeing queue). */
export async function fetchQcCheckedLotNos(): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("qc_checklist").select("lot_no");
  if (error) throw new Error(error.message);
  return onlyLotNos(data);
}
