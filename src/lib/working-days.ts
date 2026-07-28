/**
 * Working-day date maths for planned dates and SLA clocks.
 *
 * ⚠️ The mill works SIX days. **Sunday is the only weekly non-working day — Saturday
 * counts as a working day.** Treating Saturday as a weekend shortens every planned date
 * by roughly a day a week and marks work overdue before it actually is.
 *
 * Dates in the `holidays` master list (migration 001) are also skipped.
 *
 * All arithmetic is in UTC and returns `YYYY-MM-DD`, matching the ISO-date convention the
 * rest of the app uses (`toISOString().slice(0, 10)`), so results are hydration-stable.
 */

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Sunday (and holiday-master dates) are not working days. Saturday IS. */
export function isWorkingDay(dateISO: string, holidays: Set<string>): boolean {
  const d = new Date(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  if (d.getUTCDay() === 0) return false; // Sunday only
  return !holidays.has(dateISO);
}

/**
 * `start` + `days` WORKING days. Counts forward one calendar day at a time and only
 * decrements on a working day, so Sundays and holidays extend the date rather than
 * consuming lead time. Returns null when either input is missing/invalid.
 */
export function addWorkingDays(
  startISO: string | null | undefined,
  days: number | null | undefined,
  holidays: Set<string> = new Set(),
): string | null {
  if (!startISO || days == null || !Number.isFinite(days)) return null;
  const d = new Date(`${startISO}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;

  let remaining = Math.max(0, Math.trunc(days));
  // Guard against a pathological holiday set making this unbounded.
  let guard = remaining * 5 + 400;
  while (remaining > 0 && guard-- > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkingDay(iso(d), holidays)) remaining -= 1;
  }
  return iso(d);
}

/** Same, formatted for display (en-GB, matching `fmtDate`), or "—". */
export function workingDaysLabel(
  startISO: string | null | undefined,
  days: number | null | undefined,
  holidays: Set<string> = new Set(),
): string {
  const out = addWorkingDays(startISO, days, holidays);
  if (!out) return "—";
  return new Date(`${out}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC" });
}

/** Working days between two ISO dates (exclusive of `from`, inclusive of `to`). Negative if `to` precedes `from`. */
export function workingDaysBetween(fromISO: string, toISO: string, holidays: Set<string> = new Set()): number {
  if (fromISO === toISO) return 0;
  const back = toISO < fromISO;
  const [a, b] = back ? [toISO, fromISO] : [fromISO, toISO];
  const d = new Date(`${a}T00:00:00Z`);
  const end = new Date(`${b}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return 0;
  let n = 0;
  let guard = 5000;
  while (d < end && guard-- > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkingDay(iso(d), holidays)) n += 1;
  }
  return back ? -n : n;
}
