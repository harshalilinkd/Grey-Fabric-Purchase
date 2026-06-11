import { createClient } from "@/lib/supabase/client";
import type { PoFormValues, ProgramCard, PurchaseOrder, Shipment } from "@/lib/types";

const PO_COLUMNS =
  "id, unique_id, vendor_name, process, quality, order_date, order_no, po_no, delivery_days, quantity, rate, amount, created_at, updated_at";

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

/** Build the insert/update payload. `amount` is intentionally omitted — it's a
 *  generated column in the DB (= quantity × rate). */
function toPayload(v: PoFormValues) {
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
  };
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

/** Re-insert a just-deleted PO (Undo). Keeps its unique_id so text-linked shipments/
 *  programs still resolve; `amount` is generated so it's omitted. */
export async function restorePurchaseOrder(po: PurchaseOrder): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("purchase_orders").insert({
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
  });
  if (error) throw new Error(error.message);
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
