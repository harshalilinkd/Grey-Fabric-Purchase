import { addWorkingDays, workingDaysBetween } from "@/lib/working-days";

/**
 * SLA clocks, in WORKING days (Sunday is the only weekly non-working day; the holidays
 * master is skipped). Calendar-day arithmetic marks work overdue before it actually is,
 * which is why every target here runs through `working-days.ts`.
 *
 * Stages 7/8/9 mirror 3/4/5 for the reissue cycle — same fields, same statuses, and the
 * SLA restarts from the reissue leg's own dates.
 */
export type SlaStage = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const SLA: Record<SlaStage, { days: number; label: string; clockStarts: string }> = {
  2: { days: 1, label: "Grey sent",         clockStarts: "PO order date" },
  3: { days: 4, label: "Dyeing receipt",    clockStarts: "Program card date" },
  4: { days: 5, label: "QC",                clockStarts: "Dyeing actual-received date" },
  5: { days: 1, label: "Warehouse",         clockStarts: "QC actual date" },
  6: { days: 7, label: "Reissue sent",      clockStarts: "QC reissue date" },
  7: { days: 7, label: "Reissue receipt",   clockStarts: "Reissue dispatch date" },
  8: { days: 5, label: "Reissue QC",        clockStarts: "Reissue actual-received date" },
  9: { days: 1, label: "Reissue warehouse", clockStarts: "Reissue QC date" },
};

/** Planned date for a stage = its clock-start date + the stage's working-day target. */
export const plannedFor = (
  stage: SlaStage,
  startISO: string | null | undefined,
  holidays: Set<string> = new Set(),
): string | null => addWorkingDays(startISO, SLA[stage].days, holidays);

export type TimeDelay = {
  /** Working days late. Positive = overdue/late; 0 = on time. */
  days: number;
  /** Still open and already past the planned date. */
  open: boolean;
};

/**
 * timeDelay = actual − planned once the stage is complete, or now − planned while it is
 * still open. Null when the stage isn't late (or there's nothing to measure) — the field
 * stays BLANK rather than showing 0, so a populated cell always means a real delay.
 */
export function timeDelay(
  plannedISO: string | null,
  actualISO: string | null,
  todayISO: string,
  holidays: Set<string> = new Set(),
): TimeDelay | null {
  if (!plannedISO) return null;
  const end = actualISO ?? todayISO;
  if (end <= plannedISO) return null;
  return { days: workingDaysBetween(plannedISO, end, holidays), open: actualISO == null };
}
