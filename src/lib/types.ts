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
  variants: PoColorVariantInput[];
};

export type Shipment = {
  id: string;
  shipment_id: string;
  po_unique_id: string;
  shipment_date: string | null;
  sent_quantity: number | null;
  lot_no: string | null;
  created_at: string;
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
  dying_house_name: string | null;
  remaining_meters: number | null;
  next_followup_date: string | null;
  remark: string | null;
  created_at?: string;
};

/** Fields captured by the Log-Follow-Up form (followup id auto-assigned). */
export type DyeingFollowupFormValues = {
  lot_no: string;
  po_unique_id: string;
  dying_house_name: string;
  remaining_meters: string;
  next_followup_date: string;
  remark: string;
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
};

/** One editable design row in the Fabric-Receipt form. */
export type FabricReceiptDesignInput = {
  design_no: string;
  color: string;
  programmed: number | null;
  received: string;
};

/** Fields captured by the Record-Fabric-Receipt form. */
export type FabricReceiptFormValues = {
  lot_no: string;
  po_unique_id: string;
  received_date: string;
  remark: string;
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
  status: string;
  created_at?: string;
};

export type QcResult = "Passed" | "Failed";

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
  passed_qty: number | null;
  failed_qty: number | null;
  created_at?: string;
};

/** The complete result of the QC wizard, applied to every selected design on submit. */
export type QcSubmitInput = {
  program: { program_uid: string; lot_no: string | null; po_unique_id: string };
  /** design_no of each ticked design (a design may have a null design_no). */
  designNos: (string | null)[];
  receivedQty: number;
  result: QcResult;
  checks: {
    meter_qty_check: boolean;
    colour_check: boolean;
    strength_check: boolean;
    fabric_quality_check: boolean;
  };
  /** 0 when the result is Pass. */
  failedQty: number;
  reason: string;
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
