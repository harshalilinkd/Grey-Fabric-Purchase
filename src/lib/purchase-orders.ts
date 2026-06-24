import { createClient } from "@/lib/supabase/client";
import { variantCode } from "@/lib/po-meta";
import { round2 } from "@/lib/format";
import type {
  PoArchiveResult,
  PoColorVariant,
  PoColorVariantInput,
  PoFormValues,
  PoLinkCounts,
  ProgramCard,
  PurchaseOrder,
  Shipment,
  WarehouseLog,
} from "@/lib/types";

const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at, sourcing_path, quality_name, selling_merchant_no, vendor_design_no, sampling_status, cad_ref, handloom_ref, direct_subtype, checks_method, weaving_design";

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const intOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
};

/** Sample/approval state implied by the path (direct/imported never sample). */
function samplingFor(path: string | null, sampling: string): string | null {
  if (path === "direct_purchase" || path === "imported") return "not_required";
  if (path === "grey" || path === "client_fabric" || path === "checks_weaves") return sampling || "pending";
  return sampling || null;
}

/** Build the PO insert/update payload. `amount` is omitted — it's a generated column.
 *  Path-irrelevant metadata is nulled so the row stays clean for its sourcing path. */
function toPayload(v: PoFormValues) {
  const path = v.sourcing_path || null;
  return {
    vendor_name: v.vendor_name.trim() || null,
    process: v.process.trim() || null,
    quality: v.quality.trim() || null,
    order_date: v.order_date || null,
    order_no: v.order_no.trim() || null,
    po_no: v.po_no.trim() || null,
    delivery_days: intOrNull(v.delivery_days),
    quantity: numOrNull(v.quantity),
    rate: numOrNull(v.rate),
    sourcing_path: path,
    quality_name: v.quality_name.trim() || null,
    selling_merchant_no: v.selling_merchant_no.trim() || null,
    vendor_design_no: v.vendor_design_no.trim() || null,
    sampling_status: samplingFor(path, v.sampling_status),
    cad_ref: path === "checks_weaves" && v.checks_method === "cad" ? v.cad_ref.trim() || null : null,
    handloom_ref: path === "checks_weaves" && v.checks_method === "handloom" ? v.handloom_ref.trim() || null : null,
    checks_method: path === "checks_weaves" ? v.checks_method || null : null,
    weaving_design: path === "checks_weaves" && v.checks_method === "handloom" ? v.weaving_design.trim() || null : null,
    direct_subtype: path === "direct_purchase" ? v.direct_subtype || null : null,
  };
}

/**
 * Persist a PO's colour variants via the privileged route handler (server re-syncs the
 * full set). Variant DELETE is admin-only (migration 007 RLS), so removals during an
 * operator's PO edit must go server-side — not a direct client delete.
 */
async function syncVariants(poId: string, variants: PoColorVariantInput[]): Promise<void> {
  // letter by the row's ORIGINAL position (what the form showed) THEN drop blanks, so a
  // saved colour keeps the code the user saw even if an earlier row was left empty.
  const rows = variants
    .map((x, i) => ({ code: variantCode(i), color_name: x.color_name.trim() || null, meters: numOrNull(x.meters) }))
    .filter((x) => x.color_name !== null || x.meters !== null);
  const res = await fetch(`/api/purchase-orders/${poId}/variants`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variants: rows }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to save colour variants");
  }
}

export async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(PO_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PurchaseOrder[];
}

export async function createPurchaseOrder(values: PoFormValues): Promise<void> {
  const supabase = createClient();
  const unique_id = `UID-${Date.now()}`;
  // Colours are split later (Program Card stage) — PO save no longer writes variants.
  const { error } = await supabase.from("purchase_orders").insert({ unique_id, ...toPayload(values) });
  if (error) throw new Error(error.message);
}

export async function updatePurchaseOrder(id: string, values: PoFormValues): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("purchase_orders").update(toPayload(values)).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Admin-only — goes through the privileged route handler so RLS + role are enforced. */
export async function deletePurchaseOrder(id: string): Promise<void> {
  const res = await fetch(`/api/purchase-orders/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to delete purchase order");
  }
}

/** Re-insert a just-deleted PO (Undo). Keeps unique_id so text-linked shipments/programs
 *  still resolve. `amount` is generated (omitted). The colour variants were CASCADE-deleted
 *  with the PO; we replay the snapshot captured before the delete so Undo is full-fidelity. */
export async function restorePurchaseOrder(po: PurchaseOrder, variants: PoColorVariant[] = []): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({
      unique_id: po.unique_id,
      vendor_name: po.vendor_name,
      process: po.process,
      quality: po.quality,
      order_date: po.order_date,
      order_no: po.order_no,
      po_no: po.po_no,
      delivery_days: po.delivery_days,
      quantity: po.quantity,
      rate: po.rate,
      sourcing_path: po.sourcing_path,
      quality_name: po.quality_name,
      selling_merchant_no: po.selling_merchant_no,
      vendor_design_no: po.vendor_design_no,
      sampling_status: po.sampling_status,
      cad_ref: po.cad_ref,
      handloom_ref: po.handloom_ref,
      direct_subtype: po.direct_subtype,
      checks_method: po.checks_method,
      weaving_design: po.weaving_design,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (variants.length) {
    const inputs = variants.map((x) => ({ code: x.code ?? "", color_name: x.color_name ?? "", meters: x.meters?.toString() ?? "" }));
    await syncVariants((data as { id: string }).id, inputs);
  }
}

/** Colour variants for one PO (detail modal + edit-form seed). */
export async function fetchPoColorVariants(poId: string): Promise<PoColorVariant[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("po_color_variants")
    .select("id, purchase_order, code, color_name, meters")
    .eq("purchase_order", poId)
    .order("code", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PoColorVariant[];
}

/** Active internal quality names from the masters list (suggestions; empty is fine).
 *  Filters out deactivated entries so Settings → Master Lists controls the dropdown. */
export async function fetchQualityNames(): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("qualities").select("name, active").order("name", { ascending: true });
  if (error) return [];
  return ((data ?? []) as { name: string | null; active: boolean | null }[])
    .filter((r) => r.active !== false && !!r.name)
    .map((r) => r.name as string);
}

export async function fetchPoShipments(poUniqueId: string): Promise<Shipment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shipments")
    .select("id, shipment_id, po_unique_id, shipment_date, sent_quantity, lot_no, created_at")
    .eq("po_unique_id", poUniqueId)
    .order("shipment_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Shipment[];
}

export async function fetchPoProgramCards(poUniqueId: string): Promise<ProgramCard[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("program_cards")
    .select("id, program_uid, lot_no, po_unique_id, program_date, dying_house_name, total_meters")
    .eq("po_unique_id", poUniqueId)
    .order("program_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProgramCard[];
}

/* ───────────────────────── Super-admin archive (migration 016) ─────────────────────────
 * Reversible archive of a PO + everything linked to it. Hidden from every screen at the RLS
 * layer; the DB functions self-enforce super-admin (and bypass the hide so archived rows can
 * be listed + restored). All three are SECURITY DEFINER RPCs. */

/** Linked-row counts for a PO — preview before archiving, or the contents of an archived PO. */
export async function previewPoArchive(poUniqueId: string): Promise<PoLinkCounts> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("po_link_counts", { po_uid: poUniqueId });
  if (error) throw new Error(error.message);
  return data as PoLinkCounts;
}

/** Archive (true) or restore (false) a PO and its whole linked graph, atomically. */
export async function setPoArchived(poUniqueId: string, archived: boolean): Promise<PoArchiveResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("set_po_archived", { po_uid: poUniqueId, want_archived: archived });
  if (error) throw new Error(error.message);
  return data as PoArchiveResult;
}

/** Every archived PO (super-admin only) — for the restore view. */
export async function fetchArchivedPos(): Promise<PurchaseOrder[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_archived_pos");
  if (error) throw new Error(error.message);
  return (data ?? []) as PurchaseOrder[];
}

/* ─────────────────────── Finished-goods receive + QC ────────────────────────
 * Direct-purchase + imported POs are bought ready, so they skip the grey-house +
 * dyeing pipeline — but QC is still mandatory before anything is stored. A receipt
 * is QC'd per design: only QC-passed metres land in the Ready-Goods ledger
 * (warehouse_log); failed metres go to Reissue & Return; and a qc_checklist row is
 * written for each design (program_uid is null — there is no dyeing program) so the
 * receipt shows up in the QC audit alongside dyed lots. */

/** Ready-Goods rows already recorded for one PO (for the Track lifecycle). */
export async function fetchPoStock(poUniqueId: string): Promise<WarehouseLog[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("warehouse_log")
    .select("id, store_id, po_unique_id, lot_no, design_no, color, passed_qty, stored_date, status, created_at")
    .eq("po_unique_id", poUniqueId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WarehouseLog[];
}

const rand6 = () => Math.floor(Math.random() * 1e6).toString();

/** One inspected item on a finished-goods receipt. `passed` = QC verdict; on a fail,
 *  `failed_metres` (≤ metres) go to reissue and the rest are stored. */
export type ReceiveQcLine = { design_no: string; color: string; metres: number; passed: boolean; failed_metres: number };

export type ReceiveQcInput = {
  lot_no: string;
  stored_date: string;
  checks: { meter_qty_check: boolean; colour_check: boolean; strength_check: boolean; fabric_quality_check: boolean };
  /** Applied to the failed designs. */
  reason: string;
  /** A fail → "Reissue Pending" (send back) when true, else "Returned". */
  return_and_reissue: boolean;
  lines: ReceiveQcLine[];
};

/**
 * Receive a finished-goods PO with mandatory QC. Per design line:
 *   passed_qty = metres − failed_metres   (failed_metres is 0 on a pass, clamped to ≤ metres)
 *   • always: a qc_checklist row (program_uid null — no dyeing program)
 *   • if passed_qty > 0: a warehouse_log "Stored" row (the Ready-Goods ledger)
 *   • if failed_qty > 0: a reissue_return row ("Reissue Pending" / "Returned")
 * Side-effect rows are written first and the qc_checklist rows last, so a mid-failure
 * stays retryable (mirrors the dyeing-lot QC writer).
 */
export async function receiveAndQc(
  poUniqueId: string,
  input: ReceiveQcInput,
): Promise<{ qc: number; warehouse: number; reissue: number }> {
  const supabase = createClient();
  const stamp = Date.now();
  const date = input.stored_date || new Date().toISOString().slice(0, 10);
  const lot = input.lot_no.trim() || null;

  const norm = input.lines.map((ln) => {
    const failed = ln.passed ? 0 : round2(Math.min(Math.max(0, ln.failed_metres || 0), ln.metres));
    const passed = round2(Math.max(0, ln.metres - failed));
    const status: "Passed" | "Failed" = failed > 0 ? "Failed" : "Passed";
    return {
      design_no: ln.design_no.trim() || null,
      color: ln.color.trim() || null,
      passed,
      failed,
      status,
    };
  });

  // 1) warehouse_log for the QC-passed metres
  let warehouse = 0;
  const whRows = norm
    .filter((l) => l.passed > 0)
    .map((l, i) => ({
      store_id: `STORE-${stamp}${i}${rand6()}`,
      po_unique_id: poUniqueId,
      lot_no: lot,
      design_no: l.design_no,
      color: l.color,
      passed_qty: l.passed,
      stored_date: date,
      status: "Stored",
    }));
  if (whRows.length) {
    const { error } = await supabase.from("warehouse_log").insert(whRows);
    if (error) throw new Error(`Couldn't store the QC-passed fabric: ${error.message}`);
    warehouse = whRows.length;
  }

  // 2) reissue_return for the failed metres
  let reissue = 0;
  const reStatus = input.return_and_reissue ? "Reissue Pending" : "Returned";
  const reReason = input.reason.trim() || null;
  const reRows = norm
    .filter((l) => l.failed > 0)
    .map((l, i) => ({
      reissue_id: `RE-${stamp}${i}${rand6()}`,
      original_po_unique_id: poUniqueId,
      original_lot_no: lot,
      original_design_no: l.design_no,
      reissue_date: date,
      reissue_qty: l.failed,
      reason: reReason,
      status: reStatus,
    }));
  if (reRows.length) {
    const { error } = await supabase.from("reissue_return").insert(reRows);
    if (error) throw new Error(`Couldn't record the reissue/return: ${error.message}`);
    reissue = reRows.length;
  }

  // 3) qc_checklist LAST (program_uid null — finished goods have no dyeing program)
  const qcRows = norm.map((l, i) => ({
    check_id: `QC-${stamp}${i}${rand6()}`,
    program_uid: null,
    lot_no: lot,
    design_no: l.design_no,
    checked_date: date,
    meter_qty_check: input.checks.meter_qty_check,
    colour_check: input.checks.colour_check,
    strength_check: input.checks.strength_check,
    fabric_quality_check: input.checks.fabric_quality_check,
    overall_status: l.status,
    passed_qty: l.passed,
    failed_qty: l.failed,
  }));
  const { error } = await supabase.from("qc_checklist").insert(qcRows);
  if (error) throw new Error(`Couldn't save the QC checklist: ${error.message}`);

  return { qc: qcRows.length, warehouse, reissue };
}
