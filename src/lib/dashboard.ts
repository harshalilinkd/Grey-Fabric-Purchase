import { fmtAmount, fmtDate, fmtNum } from "@/lib/format";
import { QC_REISSUE, QC_SHORT, isOkayStatus } from "@/lib/qc-status";
import { CYCLE_REISSUE } from "@/lib/cycle";
import { isFinishedGoodsPo } from "@/lib/po-meta";
import { SLA, plannedFor, timeDelay, type SlaStage } from "@/lib/sla";
import type {
  DyeingFollowup,
  FabricReceipt,
  FinalReceipt,
  ProgramCard,
  PurchaseOrder,
  QcInspection,
  ReissueReturn,
  Shipment,
  WarehouseLog,
} from "@/lib/types";

/**
 * Dashboard derivations — PURE functions over the raw rows already fetched by the
 * per-domain libs. This is the app's source-of-truth view: counts, money, throughput,
 * quality and alerts. Each metric mirrors how its source screen computes it so the
 * numbers reconcile exactly.
 */

export type DashKpi = {
  key: string;
  href: string;
  icon: string;
  label: string;
  value: number;
  suffix?: string;
  sub: string;
  trend?: { tone: "up" | "down" | "warn"; text: string };
};

export type FunnelStage = { key: string; label: string; count: number; metres: number; tone: string };

export type ValueSegment = { key: string; label: string; amount: number; metres: number; tone: string; href: string };

export type AttentionItem = { id: string; icon: string; tone: string; label: string; count: number; href: string; to: string };

export type SparkBar = { label: string; value: number; isToday: boolean };

export type FollowupItem = {
  id: string; icon: string; tone: string; lead: string; rest: string; time: string; overdue: boolean; href: string; sortDate: string;
};

export type ActivityItem = {
  id: string; icon: string; tone: string; lead: string; rest: string; time: string; href: string; createdAt: string;
};

/**
 * One stage's SLA standing (`lib/sla.ts`).
 *
 * This is an OVERLAY and changes nothing else on the dashboard: the planned dates and
 * overdue flags shown elsewhere still come from each record's own `delivery_days`, which is
 * what was negotiated for that order. The SLA target is the internal standard for the
 * stage — a second, independent yardstick. The two are deliberately not merged.
 */
export type SlaStageRow = {
  stage: SlaStage;
  label: string;
  /** Target in working days, for the tooltip. */
  days: number;
  href: string;
  /** Still open and already past target — the actionable number. */
  openLate: number;
  /** Completed, but later than target — history, not a to-do. */
  doneLate: number;
  /** Worst working-days late among the open ones. */
  worstDays: number;
  /** True for the reissue leg (stages 6–9), so the UI can group them. */
  reissue: boolean;
};

export type DashboardSources = {
  pos: PurchaseOrder[];
  shipments: Shipment[];
  programs: ProgramCard[];
  qc: QcInspection[];
  warehouse: WarehouseLog[];
  reissues: ReissueReturn[];
  fabric: FabricReceipt[];
  followups: DyeingFollowup[];
  finals: FinalReceipt[];
  /** Non-working days from the holidays master; Sunday is skipped regardless. */
  holidays: string[];
};

export type DashboardData = {
  kpis: DashKpi[];
  valueFlow: ValueSegment[];
  valueTotal: number;
  funnel: FunnelStage[];
  quality: { passRate: number | null; passedMetres: number; failedMetres: number; passedCount: number; failedCount: number; inspected: number };
  throughput: { avgCycleDays: number | null; cycleSample: number; longestLot: string | null; longestDays: number; agingCount: number };
  attention: AttentionItem[];
  intake: { bars: SparkBar[]; max: number; total: number; monthDeltaPct: number | null };
  followupsDue: FollowupItem[];
  activity: ActivityItem[];
  sla: SlaStageRow[];
};

/** Earliest non-null date per key — every SLA clock starts or stops at a stage's FIRST event. */
function earliestBy<T>(
  rows: T[],
  key: (r: T) => string | null | undefined,
  date: (r: T) => string | null | undefined,
): Record<string, string> {
  const m: Record<string, string> = {};
  for (const r of rows) {
    const k = key(r);
    const d = date(r)?.slice(0, 10);
    if (!k || !d) continue;
    if (!m[k] || d < m[k]) m[k] = d;
  }
  return m;
}

/** Roll a stage's (clock-start, actual) pairs into one standing. */
function stageStanding(
  stage: SlaStage,
  href: string,
  units: { clock: string | null | undefined; actual: string | null | undefined }[],
  today: string,
  holidays: Set<string>,
): SlaStageRow {
  let openLate = 0;
  let doneLate = 0;
  let worstDays = 0;
  for (const u of units) {
    // No clock start = the stage hasn't begun; there is nothing to be late against.
    const planned = plannedFor(stage, u.clock ?? null, holidays);
    const delay = timeDelay(planned, u.actual ?? null, today, holidays);
    if (!delay) continue;
    if (delay.open) {
      openLate += 1;
      worstDays = Math.max(worstDays, delay.days);
    } else {
      doneLate += 1;
    }
  }
  return { stage, label: SLA[stage].label, days: SLA[stage].days, href, openLate, doneLate, worstDays, reissue: stage >= 6 };
}

const lotSet = (rows: { lot_no: string | null }[]) => new Set(rows.map((r) => r.lot_no).filter((x): x is string => !!x));

/** UTC today (YYYY-MM-DD) — matches the screens + hydration-stable. */
export const todayISO = () => new Date().toISOString().slice(0, 10);

function expectedGreyISO(order_date: string | null, delivery_days: number | null): string | null {
  if (!order_date || delivery_days == null) return null;
  const d = new Date(order_date);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + delivery_days);
  return d.toISOString().slice(0, 10);
}

function monthName(prefix: string): string {
  const d = new Date(prefix + "-01T00:00:00Z");
  return Number.isNaN(d.getTime()) ? prefix : d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Whole days between two ISO datetimes (b - a). */
function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Earliest created_at per lot. */
function earliestByLot(rows: { lot_no: string | null; created_at?: string | null }[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const r of rows) {
    if (!r.lot_no || !r.created_at) continue;
    if (!m[r.lot_no] || r.created_at < m[r.lot_no]) m[r.lot_no] = r.created_at;
  }
  return m;
}

export function deriveDashboard(s: DashboardSources): DashboardData {
  const today = todayISO();
  const monthPrefix = today.slice(0, 7);
  // previous-month prefix (UTC)
  const pm = new Date(monthPrefix + "-01T00:00:00Z");
  pm.setUTCMonth(pm.getUTCMonth() - 1);
  const prevPrefix = pm.toISOString().slice(0, 7);

  const shipLots = lotSet(s.shipments);
  const progLots = lotSet(s.programs);
  const qcLots = lotSet(s.qc);
  const fabricLots = lotSet(s.fabric);
  const whLots = lotSet(s.warehouse);

  const rateByPo: Record<string, number> = {};
  const sentByPo: Record<string, number> = {};
  for (const p of s.pos) if (p.rate != null) rateByPo[p.unique_id] = p.rate;
  for (const sh of s.shipments) {
    if (!sh.po_unique_id) continue;
    sentByPo[sh.po_unique_id] = (sentByPo[sh.po_unique_id] ?? 0) + (sh.sent_quantity ?? 0);
  }

  // ---- KPIs ----
  const openPos = s.pos.filter((p) => (p.quantity ?? 0) - (sentByPo[p.unique_id] ?? 0) > 0);
  const openValue = openPos.reduce((sum, p) => sum + (p.amount ?? 0), 0);

  const monthShipments = s.shipments.filter((sh) => (sh.shipment_date ?? "").slice(0, 7) === monthPrefix);
  const monthMetres = monthShipments.reduce((sum, sh) => sum + (sh.sent_quantity ?? 0), 0);
  const monthLots = lotSet(monthShipments).size;
  const lastMonthMetres = s.shipments.filter((sh) => (sh.shipment_date ?? "").slice(0, 7) === prevPrefix).reduce((sum, sh) => sum + (sh.sent_quantity ?? 0), 0);
  const monthDeltaPct = lastMonthMetres > 0 ? Math.round(((monthMetres - lastMonthMetres) / lastMonthMetres) * 100) : monthMetres > 0 ? 100 : null;

  const inDyeing = [...shipLots].filter((l) => !qcLots.has(l));
  const pendingProgram = inDyeing.filter((l) => !progLots.has(l)).length;
  const pendingQc = [...progLots].filter((l) => !qcLots.has(l)).length;

  const whMetres = s.warehouse.reduce((sum, w) => sum + (w.passed_qty ?? 0), 0);
  const whValue = s.warehouse.reduce((sum, w) => sum + (w.passed_qty ?? 0) * (rateByPo[w.po_unique_id ?? ""] ?? 0), 0);
  const reissuePending = s.reissues.filter((r) => r.status !== "Returned").length;

  const greyTrend = monthDeltaPct == null ? undefined
    : { tone: (monthDeltaPct >= 0 ? "up" : "down") as "up" | "down", text: `${monthDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(monthDeltaPct)}% vs ${monthName(prevPrefix).split(" ")[0]}` };

  const kpis: DashKpi[] = [
    { key: "po", href: "/purchase-orders", icon: "file", label: "Open POs", value: openPos.length, sub: `${fmtAmount(openValue)} on order` },
    { key: "grey", href: "/grey-receipts", icon: "box", label: `Grey received (${monthName(monthPrefix)})`, value: Math.round(monthMetres), suffix: " m", sub: `across ${monthLots} lot${monthLots === 1 ? "" : "s"}`, trend: greyTrend },
    { key: "dyeing", href: "/dyeing-queue", icon: "lines", label: "Lots in dyeing", value: inDyeing.length, sub: `${pendingProgram} pending program` },
    { key: "qc", href: "/qc-inspection", icon: "checkCircle", label: "Pending QC", value: pendingQc, sub: "lots awaiting inspection", trend: pendingQc > 0 ? { tone: "warn", text: "action" } : undefined },
    { key: "wh", href: "/warehouse", icon: "warehouse", label: "Warehouse stock", value: Math.round(whMetres), suffix: " m", sub: `${fmtAmount(whValue)} ready goods` },
    { key: "reissue", href: "/reissue-return", icon: "refresh", label: "Reissue pending", value: reissuePending, sub: "awaiting reissue / return", trend: reissuePending > 0 ? { tone: "warn", text: "action" } : undefined },
  ];

  // ---- Value in pipeline (money source of truth) ----
  const greyValue = s.shipments.reduce((sum, sh) => sum + (sh.sent_quantity ?? 0) * (rateByPo[sh.po_unique_id ?? ""] ?? 0), 0);
  const closedMetres = s.finals.reduce((sum, f) => sum + (f.final_qty ?? 0), 0);
  const closedValue = s.finals.reduce((sum, f) => sum + (f.final_qty ?? 0) * (rateByPo[f.po_unique_id ?? ""] ?? 0), 0);
  const inProdValue = Math.max(0, greyValue - whValue);
  const readyNotClosed = Math.max(0, whValue - closedValue);
  const valueFlow: ValueSegment[] = [
    { key: "order", label: "On order", amount: openValue, metres: Math.round(openPos.reduce((m, p) => m + Math.max(0, (p.quantity ?? 0) - (sentByPo[p.unique_id] ?? 0)), 0)), tone: "c-order", href: "/purchase-orders" },
    { key: "prod", label: "In production", amount: inProdValue, metres: Math.round(Math.max(0, s.shipments.reduce((m, sh) => m + (sh.sent_quantity ?? 0), 0) - whMetres)), tone: "c-prod", href: "/dyeing-queue" },
    { key: "ready", label: "Ready goods", amount: readyNotClosed, metres: Math.round(Math.max(0, whMetres - closedMetres)), tone: "c-ready", href: "/warehouse" },
    { key: "closed", label: "Closed", amount: closedValue, metres: Math.round(closedMetres), tone: "c-closed", href: "/final-receipts" },
  ];
  const valueTotal = valueFlow.reduce((sum, v) => sum + v.amount, 0);

  // ---- Funnel (count + metres per stage) ----
  const shipMetres = s.shipments.reduce((a, b) => a + (b.sent_quantity ?? 0), 0);
  const progMetres = s.programs.reduce((a, b) => a + (b.total_meters ?? 0), 0);
  const fabMetres = s.fabric.reduce((a, b) => a + (b.received_meters ?? 0), 0);
  const inDyeingNow = [...progLots].filter((l) => !fabricLots.has(l) && !whLots.has(l)).length;
  const funnel: FunnelStage[] = [
    { key: "received", label: "Received", count: shipLots.size, metres: Math.round(shipMetres), tone: "accent" },
    { key: "programmed", label: "Programmed", count: progLots.size, metres: Math.round(progMetres), tone: "accent" },
    { key: "in-dyeing", label: "In dyeing", count: inDyeingNow, metres: 0, tone: "accent" },
    { key: "received-back", label: "Received back", count: fabricLots.size, metres: Math.round(fabMetres), tone: "accent" },
    { key: "warehoused", label: "Warehoused", count: whLots.size, metres: Math.round(whMetres), tone: "ok" },
  ];

  // ---- QC quality ----
  const passedMetres = s.qc.reduce((sum, q) => sum + (q.passed_qty ?? 0), 0);
  const failedMetres = s.qc.reduce((sum, q) => sum + (q.failed_qty ?? 0), 0);
  const passedCount = s.qc.filter((q) => isOkayStatus(q.overall_status)).length;
  const failedCount = s.qc.filter((q) => q.overall_status === QC_REISSUE).length;
  const qcTotal = passedMetres + failedMetres;
  const quality = {
    passRate: qcTotal > 0 ? passedMetres / qcTotal : null,
    passedMetres: Math.round(passedMetres), failedMetres: Math.round(failedMetres),
    passedCount, failedCount, inspected: s.qc.length,
  };

  // ---- Throughput / aging ----
  const earliestShip = earliestByLot(s.shipments);
  const earliestWh = earliestByLot(s.warehouse);
  let cycleSum = 0, cycleSample = 0;
  for (const lot of whLots) {
    if (earliestShip[lot] && earliestWh[lot]) { cycleSum += daysBetween(earliestShip[lot], earliestWh[lot]); cycleSample++; }
  }
  let longestLot: string | null = null, longestDays = 0, agingCount = 0;
  const nowISO = new Date().toISOString();
  for (const lot of inDyeing) {
    const start = earliestShip[lot];
    if (!start) continue;
    const age = daysBetween(start, nowISO);
    if (age > 7) agingCount++;
    if (age > longestDays) { longestDays = age; longestLot = lot; }
  }
  const throughput = { avgCycleDays: cycleSample > 0 ? Math.round(cycleSum / cycleSample) : null, cycleSample, longestLot, longestDays, agingCount };

  // ---- Needs attention (action hub) ----
  let overdueGrey = 0;
  for (const p of s.pos) {
    if ((p.quantity ?? 0) - (sentByPo[p.unique_id] ?? 0) <= 0) continue;
    const exp = expectedGreyISO(p.order_date, p.delivery_days);
    if (exp && exp < today) overdueGrey++;
  }
  const overdueDyeing = s.followups.filter((f) => f.next_followup_date && f.next_followup_date < today).length;
  const overShip = s.pos.filter((p) => (p.quantity ?? 0) > 0 && (sentByPo[p.unique_id] ?? 0) > (p.quantity ?? 0)).length;
  const attentionAll: AttentionItem[] = [
    { id: "a-grey", icon: "box", tone: "bad", label: "Grey overdue · past planned date", count: overdueGrey, href: "/grey-receipts", to: "Grey House" },
    { id: "a-dye", icon: "clock", tone: "bad", label: "Dispatch follow-ups overdue", count: overdueDyeing, href: "/dyeing-follow-up", to: "Dyeing House Follow Up (Sent)" },
    { id: "a-age", icon: "lines", tone: "warn", label: "Lots in dyeing over 7 days", count: agingCount, href: "/dyeing-queue", to: "Dyeing Queue" },
    { id: "a-qc", icon: "checkCircle", tone: "warn", label: "Lots awaiting QC", count: pendingQc, href: "/qc-inspection", to: "QC Inspection" },
    { id: "a-reissue", icon: "refresh", tone: "warn", label: "Reissues pending", count: reissuePending, href: "/reissue-return", to: "Reissue & Return" },
    { id: "a-over", icon: "alert", tone: "warn", label: "POs over-shipped", count: overShip, href: "/grey-receipts", to: "Grey House" },
  ];
  const sevRank: Record<string, number> = { bad: 0, warn: 1 };
  const attention = attentionAll.filter((a) => a.count > 0).sort((a, b) => (sevRank[a.tone] - sevRank[b.tone]) || b.count - a.count);

  // ---- Grey intake sparkline (last 14 days) ----
  const intakeByDay: Record<string, number> = {};
  for (const sh of s.shipments) {
    const d = (sh.shipment_date ?? "").slice(0, 10);
    if (d) intakeByDay[d] = (intakeByDay[d] ?? 0) + (sh.sent_quantity ?? 0);
  }
  const base = new Date(today + "T00:00:00Z");
  const bars: SparkBar[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    bars.push({ label: String(d.getUTCDate()), value: Math.round(intakeByDay[iso] ?? 0), isToday: i === 0 });
  }
  const intakeMax = Math.max(...bars.map((b) => b.value), 1);
  const intakeTotal = bars.reduce((a, b) => a + b.value, 0);

  // ---- Follow-ups due (today or overdue) ----
  const followupsDue: FollowupItem[] = [];
  for (const f of s.followups) {
    const d = f.next_followup_date;
    if (!d || d > today) continue;
    const overdue = d < today;
    followupsDue.push({ id: `df-${f.id}`, icon: "clock", tone: overdue ? "bad" : "warn", lead: `Lot ${f.lot_no ?? "—"}`, rest: `· ${f.dying_house_name ?? "dyeing house"}`, time: overdue ? `Overdue · ${fmtDate(d)}` : "Due today", overdue, href: "/dyeing-follow-up", sortDate: d });
  }
  for (const p of s.pos) {
    if ((p.quantity ?? 0) - (sentByPo[p.unique_id] ?? 0) <= 0) continue;
    const exp = expectedGreyISO(p.order_date, p.delivery_days);
    if (!exp || exp > today) continue;
    const overdue = exp < today;
    followupsDue.push({ id: `grey-${p.id}`, icon: "box", tone: overdue ? "bad" : "warn", lead: `PO ${p.po_no ?? p.unique_id}`, rest: `· ${p.vendor_name ?? "vendor"} grey`, time: overdue ? `Overdue · ${fmtDate(exp)}` : "Due today", overdue, href: "/grey-receipts", sortDate: exp });
  }
  followupsDue.sort((a, b) => (a.overdue !== b.overdue ? (a.overdue ? -1 : 1) : a.sortDate.localeCompare(b.sortDate)));

  // ---- Live activity ----
  const activity: ActivityItem[] = [];
  for (const sh of s.shipments) activity.push({ id: `ship-${sh.id}`, icon: "box", tone: "info", lead: `Lot ${sh.lot_no ?? "—"}`, rest: `· ${fmtNum(sh.sent_quantity)} m grey received`, createdAt: sh.created_at ?? "", time: "", href: "/grey-receipts" });
  for (const p of s.programs) activity.push({ id: `prog-${p.id}`, icon: "card", tone: "accent", lead: p.program_uid, rest: `· Lot ${p.lot_no ?? "—"} · ${p.dying_house_name ?? "dyeing"}`, createdAt: p.created_at ?? "", time: "", href: "/dyeing-queue" });
  for (const q of s.qc) activity.push({ id: `qc-${q.id}`, icon: "checkCircle", tone: isOkayStatus(q.overall_status) ? "ok" : "bad", lead: `QC ${QC_SHORT[q.overall_status ?? ""] ?? q.overall_status ?? "—"}`, rest: `· Lot ${q.lot_no ?? "—"} · ${q.design_no ?? "—"}`, createdAt: q.created_at ?? "", time: "", href: "/qc-inspection" });
  for (const w of s.warehouse) activity.push({ id: `wh-${w.id}`, icon: "warehouse", tone: "ok", lead: `Stored Lot ${w.lot_no ?? "—"}`, rest: `· ${w.design_no ?? "—"} · ${fmtNum(w.passed_qty)} m`, createdAt: w.created_at ?? "", time: "", href: "/warehouse" });
  for (const f of s.finals) activity.push({ id: `fin-${f.id}`, icon: "clipboardCheck", tone: "ok", lead: `Closed Lot ${f.lot_no ?? "—"}`, rest: `· ${fmtNum(f.final_qty)} m final`, createdAt: f.created_at ?? "", time: "", href: "/final-receipts" });
  activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activityTop = activity.slice(0, 12).map((a) => ({ ...a, time: a.createdAt.slice(0, 10) === today ? "Today" : fmtDate(a.createdAt) }));

  /* ---- SLA standing per stage (overlay — see SlaStageRow) ----
     Every clock runs on the FIRST event of its stage, so each map below is an earliest-date
     lookup. Stages 7/8/9 are the same three steps as 3/4/5 filtered to the reissue cycle;
     mixing the cycles here would make a lot look on-time because its *other* track moved. */
  const holidaySet = new Set(s.holidays);
  const isReissueRow = (r: { cycle?: string | null }) => r.cycle === CYCLE_REISSUE;
  const isOriginalRow = (r: { cycle?: string | null }) => !isReissueRow(r);

  const firstShipByPo = earliestBy(s.shipments, (r) => r.po_unique_id, (r) => r.shipment_date);
  const progByLot = earliestBy(s.programs, (r) => r.lot_no, (r) => r.program_date);

  const fabOrig = s.fabric.filter(isOriginalRow);
  const fabReis = s.fabric.filter(isReissueRow);
  const qcOrig = s.qc.filter(isOriginalRow);
  const qcReis = s.qc.filter(isReissueRow);
  const whOrig = s.warehouse.filter(isOriginalRow);
  const whReis = s.warehouse.filter(isReissueRow);

  const fabOrigByLot = earliestBy(fabOrig, (r) => r.lot_no, (r) => r.received_date);
  const qcOrigByLot = earliestBy(qcOrig, (r) => r.lot_no, (r) => r.checked_date);
  const whOrigByLot = earliestBy(whOrig, (r) => r.lot_no, (r) => r.stored_date);
  const fabReisByLot = earliestBy(fabReis, (r) => r.lot_no, (r) => r.received_date);
  const qcReisByLot = earliestBy(qcReis, (r) => r.lot_no, (r) => r.checked_date);
  const whReisByLot = earliestBy(whReis, (r) => r.lot_no, (r) => r.stored_date);

  // Stage 6 is PO-grain (one parcel bundles several lots), so its clock and actual are too.
  const reissueRaisedByPo = earliestBy(s.reissues, (r) => r.original_po_unique_id, (r) => r.reissue_date);
  const dispatchByPo = earliestBy(s.followups.filter(isReissueRow), (r) => r.po_unique_id, (r) => r.created_at);
  // Stages 7–9 are lot-grain, but their clock starts at the PO-grain dispatch above.
  const reissueLots = new Set(s.reissues.map((r) => r.original_lot_no).filter((x): x is string => !!x));
  const poOfReissueLot: Record<string, string> = {};
  for (const r of s.reissues) if (r.original_lot_no && r.original_po_unique_id) poOfReissueLot[r.original_lot_no] ??= r.original_po_unique_id;

  const programLots = [...new Set(s.programs.map((p) => p.lot_no).filter((x): x is string => !!x))];

  const sla: SlaStageRow[] = [
    // Grey: only POs that actually expect grey — finished goods never see this stage.
    stageStanding(2, "/grey-receipts",
      s.pos.filter((p) => !isFinishedGoodsPo(p)).map((p) => ({ clock: p.order_date, actual: firstShipByPo[p.unique_id] })),
      today, holidaySet),
    stageStanding(3, "/fabric-receipts",
      programLots.map((l) => ({ clock: progByLot[l], actual: fabOrigByLot[l] })), today, holidaySet),
    stageStanding(4, "/qc-inspection",
      programLots.map((l) => ({ clock: fabOrigByLot[l], actual: qcOrigByLot[l] })), today, holidaySet),
    stageStanding(5, "/warehouse",
      programLots.map((l) => ({ clock: qcOrigByLot[l], actual: whOrigByLot[l] })), today, holidaySet),
    stageStanding(6, "/dyeing-follow-up",
      Object.keys(reissueRaisedByPo).map((uid) => ({ clock: reissueRaisedByPo[uid], actual: dispatchByPo[uid] })),
      today, holidaySet),
    stageStanding(7, "/fabric-receipts",
      [...reissueLots].map((l) => ({ clock: dispatchByPo[poOfReissueLot[l]], actual: fabReisByLot[l] })), today, holidaySet),
    stageStanding(8, "/qc-inspection",
      [...reissueLots].map((l) => ({ clock: fabReisByLot[l], actual: qcReisByLot[l] })), today, holidaySet),
    stageStanding(9, "/warehouse",
      [...reissueLots].map((l) => ({ clock: qcReisByLot[l], actual: whReisByLot[l] })), today, holidaySet),
  ];

  return {
    kpis, valueFlow, valueTotal, funnel, quality, throughput, attention,
    intake: { bars, max: intakeMax, total: Math.round(intakeTotal), monthDeltaPct },
    followupsDue: followupsDue.slice(0, 6), activity: activityTop,
    sla,
  };
}
