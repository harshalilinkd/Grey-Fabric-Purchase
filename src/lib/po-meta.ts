/**
 * Shared Purchase-Order metadata: the 4 sources a PO can be raised from, the internal
 * quality-name defaults, and small label maps. Used by the smart PO form, the PO table,
 * and the track modal so they stay in sync.
 *
 * TWO LEVELS, straight off the "Diff PO to generate" chart:
 *
 *   1. ORDER PO         → Grey fabric  (sample → dyeing → digital print → approved → PO)
 *                       → Client fabric finishing  (client supplies the cloth; give sample
 *                         → print & process). A *production* branch of the same source.
 *   2. CHECKS           → CAD → direct order, or handloom sample → weaving & design → order/not
 *   3. DIRECT PURCHASE  → old cloth, or new cloth (ready goods) → create PO. No sampling.
 *   4. CHINA IMPORTED   → Crispo container, no local sampling → create PO.
 *
 * `SourcingPath` is what the DB stores (`purchase_orders.sourcing_path`) — it stays at the
 * BRANCH level so grey and client-fabric orders remain distinguishable downstream. The
 * operator never picks it flat: they pick one of the 4 SOURCES, and Order PO then asks
 * which branch. `SOURCE_OF_PATH` maps a stored path back up to its source.
 */
export type SourcingPath = "grey" | "client_fabric" | "checks_weaves" | "direct_purchase" | "imported";

/** The 4 sources the operator actually chooses between. */
export type SourceKind = "order_po" | "checks_weaves" | "direct_purchase" | "imported";

export const SOURCES: { value: SourceKind; label: string; blurb: string }[] = [
  { value: "order_po", label: "Order PO", blurb: "Sampled before ordering — our own grey fabric, or fabric the client supplies for finishing." },
  { value: "checks_weaves", label: "Checks", blurb: "Woven checks/designs — a CAD pattern on screen, then a handloom sample decides order or not." },
  { value: "direct_purchase", label: "Direct purchase", blurb: "Ready goods bought on the spot — no sampling phase at all. New cloth, or old/used (Milano)." },
  { value: "imported", label: "China imported", blurb: "Container imports (Crispo) — no local sampling; funds are wired and the PO raised directly." },
];

export const SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  SOURCES.map((s) => [s.value, s.label]),
);

/** The Order-PO branch — which of the two raw-fabric routes this order came through. */
export const ORDER_PO_BRANCHES: { value: Extract<SourcingPath, "grey" | "client_fabric">; label: string; blurb: string }[] = [
  { value: "grey", label: "Grey fabric", blurb: "A raw grey sample is dyed, then digitally printed — the bulk PO follows print approval." },
  { value: "client_fabric", label: "Client fabric finishing", blurb: "The client supplies their own fabric; we give a sample, then print & process it for them." },
];

/** Which of the 4 sources a stored `sourcing_path` belongs to. */
export const SOURCE_OF_PATH: Record<SourcingPath, SourceKind> = {
  grey: "order_po",
  client_fabric: "order_po",
  checks_weaves: "checks_weaves",
  direct_purchase: "direct_purchase",
  imported: "imported",
};

export const sourceOf = (path: string | null | undefined): SourceKind | "" =>
  (path && SOURCE_OF_PATH[path as SourcingPath]) || "";

/** Short branch label — "Grey fabric", "Checks", … (no source prefix). */
export const SOURCING_LABEL: Record<string, string> = {
  ...SOURCE_LABEL,
  ...Object.fromEntries(ORDER_PO_BRANCHES.map((b) => [b.value, b.label])),
};

/** Display label for a stored path: the source, plus the branch when the source has one. */
export function sourcingLabel(path: string | null | undefined): string {
  if (!path) return "—";
  const source = sourceOf(path);
  if (source === "order_po") return `Order PO · ${SOURCING_LABEL[path] ?? path}`;
  return SOURCE_LABEL[source] ?? path;
}

/**
 * The unified post-PO pipeline this order will run, from PO generation to the ledger.
 * Every source converges here; the only fork is dyeing vs. not:
 *   • Order PO (both branches) + Checks → PO → Lot → Dyeing → Return → QC → Warehouse
 *   • Direct purchase / China imported are finished goods → PO → Receive → QC → Warehouse
 * QC is a stage in EVERY flow, and only QC-passed metres reach the Warehouse.
 */
export function sourcingFlow(
  path: string,
  opts?: { direct_subtype?: string | null },
): string[] {
  if (!path) return [];
  if (isFinishedGoodsPath(path)) {
    const head =
      path === "imported"
        ? "Imported (China)"
        : opts?.direct_subtype === "new_cloth"
          ? "New cloth (ready goods)"
          : opts?.direct_subtype === "old_milano"
            ? "Old (Milano) cloth"
            : "Finished cloth"; // subtype not picked yet
    return [head, "PO", "Receive", "QC", "Warehouse"];
  }
  const head =
    path === "grey" ? "Grey fabric" : path === "client_fabric" ? "Client fabric" : "Checks";
  return [head, "PO", "Lot", "Dyeing", "Return", "QC", "Warehouse"];
}

/**
 * Finished-goods paths — cloth bought ready (direct purchase) or imported (Crispo).
 * These skip the grey-house + dyeing pipeline, but QC is still mandatory: they are
 * QC'd on receipt (Receive & QC), and only QC-passed metres reach the Ready-Goods
 * ledger (Warehouse) — failures go to Reissue & Return. The grey/client/checks paths
 * buy unfinished fabric and run the full receive → dye → QC → warehouse flow.
 */
export const FINISHED_GOODS_PATHS: SourcingPath[] = ["direct_purchase", "imported"];

export const isFinishedGoodsPath = (path: string | null | undefined): boolean =>
  !!path && (FINISHED_GOODS_PATHS as string[]).includes(path);

export const isFinishedGoodsPo = (po: { sourcing_path?: string | null }): boolean =>
  isFinishedGoodsPath(po.sourcing_path);

/** Paths that run the dye pipeline — the ones where a dyeing house is required at PO time. */
export const goesToDyeing = (path: string | null | undefined): boolean =>
  !!path && !isFinishedGoodsPath(path);

export const DIRECT_SUBTYPE_LABEL: Record<string, string> = {
  new_cloth: "New cloth",
  old_milano: "Old (Milano)",
};

/** Direct-purchase cloth type (the "Direct Purchase" branch): new cloth → ready goods, or old (Milano). */
export const DIRECT_SUBTYPES: { value: "new_cloth" | "old_milano"; label: string }[] = [
  { value: "new_cloth", label: "New cloth" },
  { value: "old_milano", label: "Old (Milano)" },
];

/** Checks & weaves R&D route (the "Checks" branch of the PO R&D flow):
 *  CAD → direct order, or Handloom sample → weaving & design → order. */
export type ChecksMethod = "cad" | "handloom";
export const CHECKS_METHODS: { value: ChecksMethod; label: string }[] = [
  { value: "cad", label: "CAD" },
  { value: "handloom", label: "Handloom sample" },
];
export const CHECKS_METHOD_LABEL: Record<string, string> = { cad: "CAD", handloom: "Handloom sample" };

/** Internal quality names offered in the form (merged with masters + prior POs). */
export const QUALITY_DEFAULTS = ["Innova", "London", "Fiber", "Urban Linen"];

/** Colour-variant code from a row index: 0→A, 1→B, … */
export const variantCode = (i: number): string => String.fromCharCode(65 + (i % 26));
