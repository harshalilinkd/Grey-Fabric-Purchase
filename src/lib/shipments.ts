import { createClient } from "@/lib/supabase/client";
import { round2 } from "@/lib/format";
import { GI_COLUMNS, SH_COLUMNS } from "@/lib/columns";
import { DELIVERY_WAREHOUSE } from "@/lib/delivery-mode";
import type { GreyInstalment, GreyInstalmentInput, Shipment } from "@/lib/types";

export type ShipmentInput = { sent_quantity: number | null; lot_no: string | null };

const rand6 = () => Math.floor(Math.random() * 1e6).toString();

const numOrNull = (s: string): number | null => {
  const t = (s ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

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

/* ─────────────────────── Grey instalments (migration 020) ───────────────────────
 * Grey arrives in instalments, and ONE instalment can be split into SEVERAL lots.
 * The instalment row carries the follow-up fields + the remaining-qty snapshot; each
 * lot is still a `shipments` row, so everything downstream keeps working on lots. */

/** Every instalment — for the follow-up columns on the Grey House table. */
export async function fetchAllGreyInstalments(): Promise<GreyInstalment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("grey_instalments")
    .select(GI_COLUMNS)
    .order("received_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as GreyInstalment[];
}

/** Instalments logged against one PO (the manage-shipments history). */
export async function fetchPoGreyInstalments(poUniqueId: string): Promise<GreyInstalment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("grey_instalments")
    .select(GI_COLUMNS)
    .eq("po_unique_id", poUniqueId)
    .order("received_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as GreyInstalment[];
}

/**
 * Record one instalment and the lot(s) it was split into.
 *
 * Writes the instalment first, then one `shipments` row per lot pointing back at it.
 * The instalment's sent quantity is the sum of its lots, so the two can never disagree.
 * `remaining_qty` is passed in already computed — it is the snapshot of what was
 * outstanding immediately BEFORE this entry and is never recalculated afterwards.
 *
 * If the lot inserts fail we try to remove the instalment row again. That cleanup is
 * best-effort — instalment DELETE is admin-only under RLS — but it can't corrupt the
 * numbers either way: every "sent to date" figure is summed from the LOT rows, so an
 * orphaned instalment is inert.
 */
export async function createGreyInstalment(poUniqueId: string, input: GreyInstalmentInput): Promise<void> {
  const supabase = createClient();
  const stamp = Date.now();
  const date = input.received_date || new Date().toISOString().slice(0, 10);

  const lots = input.lots
    .map((l) => ({ lot_no: l.lot_no.trim(), meters: numOrNull(l.meters) }))
    .filter((l) => l.lot_no !== "");
  if (!lots.length) throw new Error("Add at least one lot — an instalment is split into lots.");

  const sent_quantity = round2(lots.reduce((sum, l) => sum + (l.meters ?? 0), 0));

  const { data, error } = await supabase
    .from("grey_instalments")
    .insert({
      instalment_id: `GRI-${stamp}`,
      po_unique_id: poUniqueId,
      received_date: date,
      sent_quantity,
      remaining_qty: input.remaining_qty,
      next_followup_date: input.next_followup_date,
      remark: input.remark,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const instalmentId = (data as { id: string }).id;

  // per-row suffix: one instalment inserts many rows into the UNIQUE shipment_id column.
  // The instalment ships one way, so every lot it produces carries the same delivery_mode
  // (026) — that is what puts the drop-ship fact on the record every later screen reads.
  const rows = lots.map((l, i) => ({
    shipment_id: `SHID-${stamp}${i}${rand6()}`,
    po_unique_id: poUniqueId,
    sent_quantity: l.meters,
    lot_no: l.lot_no,
    shipment_date: date,
    grey_instalment: instalmentId,
    delivery_mode: input.delivery_mode || DELIVERY_WAREHOUSE,
  }));
  const { error: lotErr } = await supabase.from("shipments").insert(rows);
  if (lotErr) {
    await supabase.from("grey_instalments").delete().eq("id", instalmentId);
    throw new Error(`Couldn't save the lots for this instalment: ${lotErr.message}`);
  }
}

/** Re-insert a just-deleted lot (Undo), keeping its link to the instalment that delivered it. */
export async function restoreShipment(s: Shipment): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("shipments").insert({
    shipment_id: `SHID-${Date.now()}${rand6()}`,
    po_unique_id: s.po_unique_id,
    sent_quantity: s.sent_quantity,
    lot_no: s.lot_no,
    shipment_date: s.shipment_date,
    grey_instalment: s.grey_instalment ?? null,
  });
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
