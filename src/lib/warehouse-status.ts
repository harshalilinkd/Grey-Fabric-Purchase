/**
 * Stage-5 warehouse statuses, spelled exactly as the business writes them.
 *
 * Both are LOT-level states, not per-row facts: every warehouse row for a lot carries the
 * same one and they flip together when the lot's last metres are accounted for.
 * "Final Qty Received" is the terminal state for a lot.
 */
export const WH_WAITING = "Waiting For More Qty";
export const WH_FINAL = "Final Qty Received";

export type WarehouseStatus = typeof WH_WAITING | typeof WH_FINAL;

export const isFinalQty = (s: string | null | undefined): boolean => s === WH_FINAL;

/** A lot's status from its rows — final only when every row says so. */
export const lotStatus = (rows: { status?: string | null }[]): WarehouseStatus =>
  rows.length > 0 && rows.every((r) => isFinalQty(r.status)) ? WH_FINAL : WH_WAITING;
