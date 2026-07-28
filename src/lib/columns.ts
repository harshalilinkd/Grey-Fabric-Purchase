/**
 * Single source of truth for the PostgREST column lists.
 *
 * These strings used to be copy-pasted into every Server Component that seeds a screen,
 * which meant a column-adding migration silently missed most of them — migration 015's
 * `checks_method`/`weaving_design` never reached the first render on any page. Import
 * from here instead, and add new columns in exactly one place.
 *
 * Safe to use from both server and client modules — it contains no Supabase client.
 */

/** purchase_orders — every column the app reads (002 + 007 + 015 + 019). */
export const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at, sourcing_path, quality_name, selling_merchant_no, vendor_design_no, sampling_status, cad_ref, handloom_ref, direct_subtype, checks_method, weaving_design, dying_house_name";

/** shipments — the LOT record (002 + 020 + 026). */
export const SH_COLUMNS =
  "id, shipment_id, po_unique_id, shipment_date, sent_quantity, lot_no, created_at, grey_instalment, delivery_mode";

/** program_cards (002 + 014). */
export const PC_COLUMNS =
  "id, program_uid, lot_no, po_unique_id, program_date, dying_house_name, total_meters, color, color_cutting_attached, total_color_cutting, delivery_days, pdf_url, created_at";

/** fabric_receipts — one row per design/colour received back from dyeing (011 + 021). */
export const FAB_COLUMNS =
  "id, receipt_id, lot_no, po_unique_id, design_no, color, programmed_meters, received_meters, received_date, remark, next_followup_date, remaining_qty, cycle, created_at";

/** dyeing_followups — one row per dispatch out to a dyeing house (010 + 022).
 *  Attached at PO grain: `lot_no` is legacy/optional, `po_unique_id` is the real link. */
export const DF_COLUMNS =
  "id, followup_id, lot_no, po_unique_id, dying_house_name, sent_qty, remaining_meters, next_followup_date, remark, cycle, created_at";

/** reissue_return — QC-rejected metres (002 + 025). */
export const RR_COLUMNS =
  "id, reissue_id, original_po_unique_id, original_lot_no, original_design_no, reissue_date, reissue_qty, reason, new_lot_no, status, cycle, created_at";

/** grey_instalments — one row per delivery instalment (020). */
export const GI_COLUMNS =
  "id, instalment_id, po_unique_id, received_date, sent_quantity, remaining_qty, next_followup_date, remark, created_at";

/** qc_checklist — one row per design PER DISPOSITION (002 + 023 + 025). */
export const QC_COLUMNS =
  "id, check_id, program_uid, lot_no, design_no, checked_date, meter_qty_check, colour_check, strength_check, fabric_quality_check, overall_status, passed_qty, failed_qty, actual_design_no, actual_color, actual_qty, remark, cycle, created_at";

/** warehouse_log — the Ready-Goods ledger (002 + 013 + 024 + 025). */
export const WH_COLUMNS =
  "id, store_id, po_unique_id, lot_no, design_no, color, passed_qty, stored_date, status, remark, cycle, created_at";

/** final_receipts — the closing quantity per lot (009). */
export const FR_COLUMNS =
  "id, receipt_id, lot_no, po_unique_id, final_qty, status, remark, received_date, created_at";
