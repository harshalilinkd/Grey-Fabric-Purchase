import { createClient } from "@/lib/supabase/server";
import { DF_COLUMNS, PC_COLUMNS, PO_COLUMNS, RR_COLUMNS, SH_COLUMNS } from "@/lib/columns";
import { DyeingFollowupClient } from "@/components/dyeing-follow-up/DyeingFollowupClient";
import type { DyeingFollowup, ProgramCard, PurchaseOrder, ReissueReturn, Shipment } from "@/lib/types";

export default async function DyeingFollowUpPage() {
  const supabase = await createClient();

  /* Both legs of the dispatch live here, and they need different sources:
       first trip out (cycle 'original') — program_cards give the lots and their authorised
         metres; shipments give each lot's delivery_mode (drop-shipped or not)
       reissue (cycle 'reissue')         — reissue_return gives the PO's QC-rejected metres */
  const [{ data: df }, { data: pos }, { data: rr }, { data: pc }, { data: sh }] = await Promise.all([
    supabase.from("dyeing_followups").select(DF_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("purchase_orders").select(PO_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("reissue_return").select(RR_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("program_cards").select(PC_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("shipments").select(SH_COLUMNS).order("created_at", { ascending: false }),
  ]);

  return (
    <DyeingFollowupClient
      initialFollowups={(df ?? []) as DyeingFollowup[]}
      initialPos={(pos ?? []) as PurchaseOrder[]}
      initialReissues={(rr ?? []) as ReissueReturn[]}
      initialPrograms={(pc ?? []) as ProgramCard[]}
      initialShipments={(sh ?? []) as Shipment[]}
    />
  );
}
