/**
 * How the grey physically reached the dyeing house (migration 026).
 *
 * Two logistical routes, chosen when the receipt is logged:
 *   warehouse       — the vendor delivers to our dock; we later dispatch the rolls AND
 *                     the physical Program Card onward to the dyeing house.
 *   direct_to_dyer  — the vendor drop-ships the raw rolls straight to the dyeing house.
 *                     The fabric never reaches us, so the receipt is logged virtually off
 *                     the vendor's invoice — but the LOT is just as real, and is active in
 *                     the dyeing queue immediately. Only the card is couriered; the dyer
 *                     matches it to the rolls by the vendor design number.
 *
 * The distinction is operational, not cosmetic: on a drop-shipped lot there is nothing to
 * pick and pack, so anyone reading the queue or the program card needs to know not to go
 * looking for rolls that were never here.
 */
export const DELIVERY_WAREHOUSE = "warehouse";
export const DELIVERY_DIRECT = "direct_to_dyer";

export type DeliveryMode = typeof DELIVERY_WAREHOUSE | typeof DELIVERY_DIRECT;

export const DELIVERY_MODES: { value: DeliveryMode; label: string; blurb: string }[] = [
  {
    value: DELIVERY_WAREHOUSE,
    label: "To our warehouse",
    blurb: "The vendor delivers the rolls to our dock. Rolls and the program card are dispatched onward together.",
  },
  {
    value: DELIVERY_DIRECT,
    label: "Direct to dyeing house",
    blurb: "The vendor drop-ships straight to the dyer. Logged virtually off their invoice — courier the program card only.",
  },
];

export const DELIVERY_LABEL: Record<string, string> = Object.fromEntries(
  DELIVERY_MODES.map((m) => [m.value, m.label]),
);

export const isDirectToDyer = (mode: string | null | undefined): boolean => mode === DELIVERY_DIRECT;

/** Short badge text for a lot row. Null on the standard route — no badge, no noise. */
export const deliveryBadge = (mode: string | null | undefined): string | null =>
  isDirectToDyer(mode) ? "Direct to dyer" : null;
