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
};

/** One editable cutting row in the New Program form. */
export type ProgramCardDesignInput = {
  design_no: string;
  color: string;
  meter: string;
};

/** Fields captured by the New Program form (program id is auto-assigned). */
export type ProgramCardFormValues = {
  lot_no: string;
  po_unique_id: string;
  dying_house_name: string;
  program_date: string;
  total_meters: string;
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
