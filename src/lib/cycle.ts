/**
 * The reissue-cycle discriminator (migration 025).
 *
 * Stages 7/8/9 are field-identical to 3/4/5, so they share the same tables and are told
 * apart by this value — never by duplicated tables.
 *
 * ⚠️ `cycle` is a PARALLEL DIMENSION, not a phase. Both tracks run at once on the same
 * lot: a lot can be partially received, partially QC'd, partially warehoused AND have
 * metres out on reissue simultaneously. Every lot-level rollup must therefore be keyed on
 * (lot, cycle) — a rollup keyed on lot alone mixes the two tracks and closes lots early.
 */
export const CYCLE_ORIGINAL = "original";
export const CYCLE_REISSUE = "reissue";

export type Cycle = typeof CYCLE_ORIGINAL | typeof CYCLE_REISSUE;

export const CYCLES: Cycle[] = [CYCLE_ORIGINAL, CYCLE_REISSUE];

/** Labels for chips/filters — the stage numbers are how staff refer to the two legs. */
export const CYCLE_LABEL: Record<string, string> = {
  [CYCLE_ORIGINAL]: "Original",
  [CYCLE_REISSUE]: "Reissue",
};

export const isReissue = (c: string | null | undefined): boolean => c === CYCLE_REISSUE;

/** Rows of one cycle only. Rows written before 025 have no value and are 'original'. */
export const ofCycle = <T extends { cycle?: string | null }>(rows: T[], cycle: Cycle): T[] =>
  rows.filter((r) => (r.cycle ?? CYCLE_ORIGINAL) === cycle);

/** Sum a numeric field across one cycle's rows. */
export const sumForCycle = <T extends { cycle?: string | null }>(
  rows: T[],
  cycle: Cycle,
  pick: (row: T) => number | null | undefined,
): number => Math.round(ofCycle(rows, cycle).reduce((s, r) => s + (pick(r) ?? 0), 0) * 100) / 100;
