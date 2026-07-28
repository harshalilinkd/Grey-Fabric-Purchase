import { createClient } from "@/lib/supabase/server";
import { PO_COLUMNS } from "@/lib/columns";
import { ReissueReturnClient } from "@/components/reissue-return/ReissueReturnClient";
import type { PurchaseOrder, ReissueReturn } from "@/lib/types";

const RR_COLUMNS =
  "id, reissue_id, original_po_unique_id, original_lot_no, original_design_no, reissue_date, reissue_qty, reason, new_lot_no, status, created_at";

export default async function ReissueReturnPage() {
  const supabase = await createClient();

  const [{ data: rr }, { data: pos }] = await Promise.all([
    supabase.from("reissue_return").select(RR_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
  ]);

  return (
    <ReissueReturnClient
      initialRows={(rr ?? []) as ReissueReturn[]}
      initialPos={(pos ?? []) as PurchaseOrder[]}
    />
  );
}
