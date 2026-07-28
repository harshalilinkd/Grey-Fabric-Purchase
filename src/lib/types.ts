// Row shapes mirroring the Supabase schema (migration 002).

export type PurchaseOrder = {
  id: string;
  unique_id: string;
  vendor_name: string | null;
  process: string | null;
  quality: string | null;
  order_date: string | null;
  order_no: string | null;
  po_no: string | null;
  delivery_days: number | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  created_at: string;
  updated_at: string;
  // migration 007: sourcing path + quality metadata (all nullable in DB; form-required)
  sourcing_path: string | null;
  quality_name: string | null;
  selling_merchant_no: string | null;
  vendor_design_no: string | null;
  sampling_status: string | null;
  cad_ref: string | null;
  handloom_ref: string | null;
  direct_subtype: string | null;
  /** migration 015: Checks & weaves route (cad/handloom) + weaving-design note. */
  checks_method: string | null;
  weaving_design: string | null;
  /** migration 016: super-admin reversible archive (hidden from every screen via RLS). */
  archived?: boolean;
  /** migration 019: the dyeing house this PO is destined for (one PO → one dyeing
   *  house). NULL on finished-goods POs, which never go to a dyeing house.
   *  Spelling matches program_cards.dying_house_name. */
  dying_house_name: string | null;
};

/** Linked-row counts for one PO — preview before archiving / contents of an archived PO. */
export type PoLinkCounts = {
  shipments: number;
  programs: number;
  qc: number;
  warehouse: number;
  reissue: number;
  final_receipts: number;
  dyeing_followups: number;
  fabric_receipts: number;
};

/** What an archive/restore touched (link counts + the PO itself). */
export type PoArchiveResult = PoLinkCounts & { po: number };

/** A colour variant of a PO's bulk (po_color_variants). */
export type PoColorVariant = {
  id: string;
  purchase_order: string;
  code: string | null;
  color_name: string | null;
  meters: number | null;
};

/** One editable colour row in the PO form. */
export type PoColorVariantInput = {
  code: string;
  color_name: string;
  meters: string;
};

/** Fields editable in the New/Edit PO form. */
export type PoFormValues = {
  vendor_name: string;
  process: string;
  quality: string;
  order_date: string;
  order_no: string;
  po_no: string;
  delivery_days: string;
  quantity: string;
  rate: string;
  // 007 metadata
  sourcing_path: string;
  quality_name: string;
  selling_merchant_no: string;
  vendor_design_no: string;
  sampling_status: string;
  cad_ref: string;
  handloom_ref: string;
  direct_subtype: string;
  checks_method: string;
  weaving_design: string;
  // 019: dyeing house (required on the dyeing paths, blank on finished goods)
  dying_house_name: string;
  variants: PoColorVariantInput[];
};

/** A LOT record. One grey instalment can produce several of these. */
export type Shipment = {
  id: string;
  shipment_id: string;
  po_unique_id: string;
  shipment_date: string | null;
  sent_quantity: number | null;
  lot_no: string | null;
  created_at: string;
  /** migration 020: the instalment that delivered this lot (null on pre-020 lots). */
  grey_instalment?: string | null;
  /** migration 026: 'warehouse' (delivered to our dock) | 'direct_to_dyer' (drop-shipped
   *  straight to the dyeing house, logged virtually off the vendor's invoice). */
  delivery_mode?: string | null;
};

/**
 * One grey-house delivery instalment against a PO (migration 020).
 * `remaining_qty` is a SNAPSHOT of what was outstanding immediately BEFORE this entry —
 * it is persisted at write time and must never be recomputed on read.
 */
export type GreyInstalment = {
  id: string;
  instalment_id: string;
  po_unique_id: string;
  received_date: string | null;
  sent_quantity: number | null;
  remaining_qty: number | null;
  next_followup_date: string | null;
  remark: string | null;
  created_at?: string;
};

/** One lot line entered on an instalment — the instalment is split into these. */
export type InstalmentLotInput = { lot_no: string; meters: string };

/** What the "Log grey receipt" form submits: the instalment + the lots it splits into. */
export type GreyInstalmentInput = {
  received_date: string;
  next_followup_date: string | null;
  remark: string | null;
  /** Snapshot of the outstanding quantity immediately before this entry. */
  remaining_qty: number | null;
  /** migration 026: how this instalment travelled — 'warehouse' (to our dock) or
   *  'direct_to_dyer' (drop-shipped to the dyeing house, logged off the vendor invoice).
   *  One instalment ships one way, so every lot it creates is stamped with this. */
  delivery_mode: string;
  lots: InstalmentLotInput[];
};

export type ProgramCard = {
  id: string;
  program_uid: string;
  lot_no: string | null;
  po_unique_id: string;
  program_date: string | null;
  dying_house_name: string | null;
  total_meters: number | null;
  /** Optional: only selected by the Program Cards screen (not the lighter PO/Track fetches). */
  color?: string | null;
  color_cutting_attached?: boolean;
  total_color_cutting?: number | null;
  delivery_days?: number | null;
  pdf_url?: string | null;
  created_at?: string;
};

/** A single design cutting belonging to a program card (program_card_designs). */
export type ProgramCardDesign = {
  id: string;
  program_card: string;
  design_no: string | null;
  color: string | null;
  meter: number | null;
  /** migration 008: per-colour cutting photo/PDF (null for White / legacy rows). */
  cutting_url?: string | null;
};

/** One editable colour-cutting row in the New Program form (code is auto A/B/C).
 *  `file` is the cutting photo/PDF — not required when the colour is White. */
export type ProgramCardDesignInput = {
  design_no: string;
  color: string;
  meter: string;
  file: File | null;
};

/** Fields captured by the New Program form (program id is auto-assigned). */
export type ProgramCardFormValues = {
  lot_no: string;
  po_unique_id: string;
  dying_house_name: string;
  program_date: string;
  total_meters: string;
  color: string;
  delivery_days: string;
  /** User-set Yes/No flag (optional; defaults false in the data layer). */
  color_cutting_attached?: boolean;
  /** Photo/scan of the finished physical card → `program_cards.pdf_url`. Optional.
   *  This is the card ITSELF (swatches pinned, metres written beside them) — not to be
   *  confused with the per-colour close-ups in `designs[].file`. */
  cardFile?: File | null;
  designs: ProgramCardDesignInput[];
};

export type ReissueStatus = "Reissue Pending" | "Returned" | "Pending Assignment";

/** A row in the reissue_return table (a failed-QC quantity sent back). */
export type ReissueReturn = {
  id: string;
  reissue_id: string;
  original_po_unique_id: string | null;
  original_lot_no: string | null;
  original_design_no: string | null;
  reissue_date: string | null;
  reissue_qty: number | null;
  reason: string | null;
  new_lot_no: string | null;
  status: ReissueStatus;
  created_at?: string;
  /** migration 025: which QC pass rejected these metres ('original' | 'reissue').
   *  A Stage-8 rejection writes another row here — that is how the loop repeats. */
  cycle?: string | null;
};

export type FinalReceiptStatus = "Closed" | "Partial" | "On Hold";

/** A final receipt (final_receipts) — closes a lot with its confirmed good quantity. */
export type FinalReceipt = {
  id: string;
  receipt_id: string;
  lot_no: string | null;
  po_unique_id: string | null;
  final_qty: number | null;
  status: FinalReceiptStatus;
  remark: string | null;
  received_date: string | null;
  created_at?: string;
};

/** Fields captured by the Record-Final-Receipt form (receipt id auto-assigned). */
export type FinalReceiptFormValues = {
  lot_no: string;
  po_unique_id: string;
  final_qty: string;
  status: FinalReceiptStatus;
  remark: string;
  received_date: string;
};

/** A dyeing-house follow-up log entry (dyeing_followups). */
export type DyeingFollowup = {
  id: string;
  followup_id: string;
  lot_no: string | null;
  po_unique_id: string | null;
  /** The house this dispatch went to — often NOT the house named on the PO. */
  dying_house_name: string | null;
  /** migration 022: metres dispatched on this entry. Stage 6's defining column — the
   *  reissue cycle reconciles against this when the fabric comes back at Stage 7. */
  sent_qty?: number | null;
  remaining_meters: number | null;
  next_followup_date: string | null;
  remark: string | null;
  created_at?: string;
  /** migration 025: defaults to 'reissue' here — this table IS Stage 6. */
  cycle?: string | null;
};

/** Fields captured by the dispatch form (followup id auto-assigned). */
export type DyeingFollowupFormValues = {
  lot_no: string;
  po_unique_id: string;
  dying_house_name: string;
  sent_qty: string;
  remaining_meters: string;
  next_followup_date: string;
  remark: string;
  /** Which leg this dispatch belongs to (migration 025):
   *   'original' — the FIRST trip out, per LOT, once its program card exists
   *   'reissue'  — QC-rejected metres going back out, per PO (several lots in one parcel)
   *  The two legs have different grains on purpose; see the dispatch modal. */
  cycle: string;
};

/** A dyed-fabric receipt row (fabric_receipts) — one per design received back. */
export type FabricReceipt = {
  id: string;
  receipt_id: string;
  lot_no: string | null;
  po_unique_id: string | null;
  design_no: string | null;
  programmed_meters: number | null;
  received_meters: number | null;
  received_date: string | null;
  remark: string | null;
  created_at?: string;
  /** migration 025: which track this row belongs to ('original' | 'reissue'). */
  cycle?: string | null;
  /** migration 021: dyeing follow-up state carried by each received line. */
  color?: string | null;
  next_followup_date?: string | null;
  /** SNAPSHOT of the lot's outstanding metres immediately BEFORE this entry. Never recomputed. */
  remaining_qty?: number | null;
};

/** One editable design row in the Fabric-Receipt form. */
export type FabricReceiptDesignInput = {
  design_no: string;
  color: string;
  /** The "total should receive" for this design (programmed metres). */
  programmed: number | null;
  /** Already received against this design before this entry. */
  receivedBefore?: number;
  received: string;
};

/** Fields captured by the Record-Fabric-Receipt form. */
export type FabricReceiptFormValues = {
  lot_no: string;
  po_unique_id: string;
  received_date: string;
  remark: string;
  next_followup_date: string | null;
  /** Lot-level outstanding metres immediately before this entry — stored on every row. */
  remaining_qty: number | null;
  /** Stage 3 ('original') or Stage 7 ('reissue') — the same form serves both legs. */
  cycle: string;
  designs: FabricReceiptDesignInput[];
};

/** A stored Ready-Goods entry (warehouse_log) — written by QC on a pass. */
export type WarehouseLog = {
  id: string;
  store_id: string;
  po_unique_id: string | null;
  lot_no: string | null;
  design_no: string | null;
  color: string | null;
  passed_qty: number | null;
  stored_date: string | null;
  /** migration 024: "Waiting For More Qty" (lot open) or "Final Qty Received" (terminal). */
  status: string;
  created_at?: string;
  /** migration 025: which track this row belongs to ('original' | 'reissue'). */
  cycle?: string | null;
  /** migration 024: note recorded against the stored metres. */
  remark?: string | null;
};

/** The two Stage-4 dispositions. Values live in `@/lib/qc-status` (verbatim business spellings). */
export type QcResult = "OKAY & WAITING FOR REMAINING QTY" | "RETURN & REISSUE";

/** A past QC inspection row (one per design checked) for the qc_checklist table. */
export type QcInspection = {
  id: string;
  check_id: string;
  program_uid: string | null;
  lot_no: string | null;
  design_no: string | null;
  checked_date: string | null;
  meter_qty_check: boolean;
  colour_check: boolean;
  strength_check: boolean;
  fabric_quality_check: boolean;
  overall_status: QcResult | null;
  /** Good metres on an OKAY row; 0 on a reissue row. */
  passed_qty: number | null;
  /** Reissue metres on a RETURN & REISSUE row; 0 on an okay row. */
  failed_qty: number | null;
  created_at?: string;
  /** migration 025: which track this row belongs to ('original' | 'reissue'). */
  cycle?: string | null;
  /** migration 023: what was actually FOUND at inspection — may differ from the program card. */
  actual_design_no?: string | null;
  actual_color?: string | null;
  actual_qty?: number | null;
  remark?: string | null;
};

/** One design being inspected, with the actual design/colour/qty found on it. */
export type QcDesignInput = {
  design_no: string | null;
  actual_design_no: string;
  actual_color: string;
  actual_qty: string;
};

/** The complete result of the QC wizard, applied to every selected design on submit. */
export type QcSubmitInput = {
  program: { program_uid: string; lot_no: string | null; po_unique_id: string };
  /** Each ticked design + what was actually found on it. */
  designs: QcDesignInput[];
  /** Metres being disposed of by THIS inspection event, per design. */
  receivedQty: number;
  result: QcResult;
  checks: {
    meter_qty_check: boolean;
    colour_check: boolean;
    strength_check: boolean;
    fabric_quality_check: boolean;
  };
  /** 0 on an OKAY & WAITING FOR REMAINING QTY event. */
  failedQty: number;
  reason: string;
  /** Free-text note kept on the QC row itself, whichever way it branches. */
  remark: string;
  /** Stage 4 ('original') or Stage 8 ('reissue') — the same wizard serves both legs. */
  cycle: string;
  /** Fail path only — ticked = "Reissue Pending", unticked = "Returned". */
  returnAndReissue: boolean;
};

export type Role = "super_admin" | "admin" | "operator";

export type Profile = {
  id: string;
  full_name: string | null;
  role: Role;
  /** Optional until migration 003 is applied. */
  email?: string | null;
  active?: boolean;
  /** Optional until migration 004 is applied. */
  department?: string | null;
};

/** A row in Settings → Team Management (profiles incl. audit fields). */
export type TeamMember = Profile & {
  created_at?: string;
};
