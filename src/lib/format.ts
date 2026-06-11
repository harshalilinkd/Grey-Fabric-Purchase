// Indian-format display helpers (e.g. 1,06,000).

const numFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const amtFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtNum = (n: number | null | undefined): string => (n == null ? "—" : numFmt.format(n));

export const fmtAmount = (n: number | null | undefined): string => (n == null ? "—" : `₹ ${amtFmt.format(n)}`);

/** ISO/date string → dd/mm/yyyy. */
export const fmtDate = (s: string | null | undefined): string => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB");
};

/** Round to 2 decimals (matches the stored generated amount). */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Planned date = order date + delivery days (simple calendar days) → dd/mm/yyyy. */
export const addCalendarDays = (
  dateStr: string | null | undefined,
  days: number | null | undefined,
): string => {
  if (!dateStr || days == null) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-GB");
};
