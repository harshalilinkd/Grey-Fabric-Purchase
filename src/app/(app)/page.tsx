import { createClient } from "@/lib/supabase/server";
import {
  DF_COLUMNS, FAB_COLUMNS, FR_COLUMNS, PC_COLUMNS, PO_COLUMNS,
  QC_COLUMNS, RR_COLUMNS, SH_COLUMNS, WH_COLUMNS,
} from "@/lib/columns";
import { fetchHolidayDates } from "@/lib/masters";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import type {
  DyeingFollowup,
  FabricReceipt,
  FinalReceipt,
  ProgramCard,
  PurchaseOrder,
  QcInspection,
  ReissueReturn,
  Shipment,
  WarehouseLog,
} from "@/lib/types";

/* Column lists come from `@/lib/columns` — this page used to carry its own copies, which
   silently went stale: they were missing `cycle`, the QC `actual_*` fields and the 024
   remarks, so every cycle-aware derivation here read `undefined`. Don't reintroduce them. */

export default async function DashboardPage() {
  const supabase = await createClient();

  // holidays feed the working-day SLA clocks (`lib/sla.ts`) — Sunday + these are skipped
  const [po, sh, pc, qc, wh, rr, fab, df, fr, holidays] = await Promise.all([
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("shipments").select(SH_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("program_cards").select(PC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("qc_checklist").select(QC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("warehouse_log").select(WH_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("reissue_return").select(RR_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("fabric_receipts").select(FAB_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("dyeing_followups").select(DF_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("final_receipts").select(FR_COLUMNS).order("created_at", { ascending: false }),
    fetchHolidayDates(),
  ]);

  return (
    <DashboardClient
      initialPos={(po.data ?? []) as PurchaseOrder[]}
      initialShipments={(sh.data ?? []) as Shipment[]}
      initialPrograms={(pc.data ?? []) as ProgramCard[]}
      initialQc={(qc.data ?? []) as QcInspection[]}
      initialWarehouse={(wh.data ?? []) as WarehouseLog[]}
      initialReissues={(rr.data ?? []) as ReissueReturn[]}
      initialFabric={(fab.data ?? []) as FabricReceipt[]}
      initialFollowups={(df.data ?? []) as DyeingFollowup[]}
      initialFinals={(fr.data ?? []) as FinalReceipt[]}
      initialHolidays={holidays}
    />
  );
}
