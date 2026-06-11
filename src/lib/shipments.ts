import { createClient } from "@/lib/supabase/client";
import type { Shipment } from "@/lib/types";

const SH_COLUMNS = "id, shipment_id, po_unique_id, shipment_date, sent_quantity, lot_no, created_at";

export type ShipmentInput = { sent_quantity: number | null; lot_no: string | null };

/** All shipments — used to aggregate sent-qty per PO on the follow-up table. */
export async function fetchAllShipments(): Promise<Shipment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shipments")
    .select(SH_COLUMNS)
    .order("shipment_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Shipment[];
}

/** Logging a shipment is how a lot enters the system. */
export async function createShipment(poUniqueId: string, input: ShipmentInput): Promise<void> {
  const supabase = createClient();
  const shipment_id = `SHID-${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("shipments").insert({
    shipment_id,
    po_unique_id: poUniqueId,
    sent_quantity: input.sent_quantity,
    lot_no: input.lot_no,
    shipment_date: today,
  });
  if (error) throw new Error(error.message);
}

export async function updateShipment(id: string, input: ShipmentInput): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("shipments")
    .update({ sent_quantity: input.sent_quantity, lot_no: input.lot_no })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Admin-only — via the privileged route handler. */
export async function deleteShipment(id: string): Promise<void> {
  const res = await fetch(`/api/shipments/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to delete shipment");
  }
}
