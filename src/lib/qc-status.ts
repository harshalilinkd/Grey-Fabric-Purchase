/**
 * QC disposition statuses, spelled exactly as the business writes them.
 *
 * The status name carries the meaning: "OKAY & WAITING FOR REMAINING QTY" says the metres
 * are good AND that the lot is not finished. QC is incremental — one lot routinely has
 * several inspection rows spread over weeks, each disposing of part of it — so a lot is
 * closed only when nothing remains for QC, never on the first inspection.
 *
 * Every row branches exactly one way and carries either a good qty or a reissue qty:
 *   OKAY & WAITING FOR REMAINING QTY → those metres go to the warehouse (Stage 5)
 *   RETURN & REISSUE                 → those metres enter the reissue track (Stage 6)
 */
export const QC_OKAY = "OKAY & WAITING FOR REMAINING QTY";
export const QC_REISSUE = "RETURN & REISSUE";

export type QcStatus = typeof QC_OKAY | typeof QC_REISSUE;

export const QC_STATUSES: QcStatus[] = [QC_OKAY, QC_REISSUE];

export const isOkayStatus = (s: string | null | undefined): boolean => s === QC_OKAY;

/** Short label for tight columns/chips, where the full status doesn't fit. */
export const QC_SHORT: Record<string, string> = {
  [QC_OKAY]: "Okay",
  [QC_REISSUE]: "Return & reissue",
};

/**
 * remainingForQC = lot qty − (goodQty + reissueQty).
 * Lot qty is what was programmed to the dyeing house. The lot is fully accounted for —
 * and only then closed — when this reaches zero.
 */
export const remainingForQc = (lotQty: number, goodQty: number, reissueQty: number): number =>
  Math.round((lotQty - (goodQty + reissueQty)) * 100) / 100;
