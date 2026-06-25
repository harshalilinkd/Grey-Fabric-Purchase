/**
 * Shared Purchase-Order metadata: the 5 sourcing paths + their pre-PO blurbs, the
 * internal quality-name defaults, and small label maps. Used by the smart PO form,
 * the PO table, and the track modal so they stay in sync.
 */
export type SourcingPath = "grey" | "client_fabric" | "checks_weaves" | "direct_purchase" | "imported";

export const SOURCING_PATHS: { value: SourcingPath; label: string; blurb: string }[] = [
  { value: "grey", label: "Grey", blurb: "Grey fabric from a vendor — printed/dyed in-house after the print is approved." },
  { value: "client_fabric", label: "Client fabric", blurb: "The client supplies the fabric; we process it once a finish sample is approved." },
  { value: "checks_weaves", label: "Checks & weaves", blurb: "Woven checks/designs — tracked against CAD + handloom refs, weave approved up front." },
  { value: "direct_purchase", label: "Direct purchase", blurb: "Finished cloth bought directly — new cloth or old (Milano). No sampling." },
  { value: "imported", label: "Imported", blurb: "Crispo imported goods — a direct PO with no sample step." },
];

export const SOURCING_LABEL: Record<string, string> = Object.fromEntries(
  SOURCING_PATHS.map((p) => [p.value, p.label]),
);

/**
 * The flow a source follows, starting at PO generation (the sampling/approval R&D step is
 * out of scope — the system starts at the PO). Transcribed from LD Silk Mills' flow charts.
 *   • Direct purchase splits by cloth: new cloth vs old/Milano (`direct_subtype`).
 *   • Grey / client-fabric / checks-weaves run the dye pipeline after the PO; direct / imported
 *     are finished goods → received & QC'd straight to the Warehouse (no dyeing).
 * QC is a stage in EVERY flow.
 */
export function sourcingFlow(
  path: string,
  opts?: { direct_subtype?: string | null },
): string[] {
  switch (path) {
    case "grey":
      return ["Grey fabric", "PO", "Dyeing", "QC", "Warehouse"];
    case "client_fabric":
      return ["Client fabric", "PO", "Dyeing", "QC", "Warehouse"];
    case "checks_weaves":
      return ["Checks & weaves", "PO", "Dyeing", "QC", "Warehouse"];
    case "direct_purchase":
      if (opts?.direct_subtype === "new_cloth")
        return ["New cloth (ready goods)", "PO", "Receive", "QC", "Warehouse"];
      if (opts?.direct_subtype === "old_milano")
        return ["Old (Milano) cloth", "PO", "Receive", "QC", "Warehouse"];
      return ["Finished cloth", "PO", "Receive", "QC", "Warehouse"]; // subtype not picked yet
    case "imported":
      return ["Imported (China)", "PO", "Receive", "QC", "Warehouse"];
    default:
      return [];
  }
}

/**
 * Finished-goods paths — cloth bought ready (direct purchase) or imported (Crispo).
 * These skip the grey-house + dyeing pipeline, but QC is still mandatory: they are
 * QC'd on receipt (Receive & QC), and only QC-passed metres reach the Ready-Goods
 * ledger (Warehouse) — failures go to Reissue & Return. The grey/client/checks paths
 * buy unfinished fabric and run the full receive → dye → QC → warehouse flow.
 */
export const FINISHED_GOODS_PATHS: SourcingPath[] = ["direct_purchase", "imported"];

export const isFinishedGoodsPo = (po: { sourcing_path?: string | null }): boolean =>
  !!po.sourcing_path && (FINISHED_GOODS_PATHS as string[]).includes(po.sourcing_path);

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
