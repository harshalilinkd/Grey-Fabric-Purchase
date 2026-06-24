import { fmtAmount, fmtDate, fmtNum } from "@/lib/format";
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
};

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
  const passedCount = s.qc.filter((q) => q.overall_status === "Passed").length;
  const failedCount = s.qc.filter((q) => q.overall_status === "Failed").length;
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
    { id: "a-dye", icon: "clock", tone: "bad", label: "Dyeing follow-ups overdue", count: overdueDyeing, href: "/dyeing-follow-up", to: "Dyeing Follow Up" },
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
  for (const q of s.qc) activity.push({ id: `qc-${q.id}`, icon: "checkCircle", tone: q.overall_status === "Passed" ? "ok" : "bad", lead: `QC ${q.overall_status ?? "—"}`, rest: `· Lot ${q.lot_no ?? "—"} · ${q.design_no ?? "—"}`, createdAt: q.created_at ?? "", time: "", href: "/qc-inspection" });
  for (const w of s.warehouse) activity.push({ id: `wh-${w.id}`, icon: "warehouse", tone: "ok", lead: `Stored Lot ${w.lot_no ?? "—"}`, rest: `· ${w.design_no ?? "—"} · ${fmtNum(w.passed_qty)} m`, createdAt: w.created_at ?? "", time: "", href: "/warehouse" });
  for (const f of s.finals) activity.push({ id: `fin-${f.id}`, icon: "clipboardCheck", tone: "ok", lead: `Closed Lot ${f.lot_no ?? "—"}`, rest: `· ${fmtNum(f.final_qty)} m final`, createdAt: f.created_at ?? "", time: "", href: "/final-receipts" });
  activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activityTop = activity.slice(0, 12).map((a) => ({ ...a, time: a.createdAt.slice(0, 10) === today ? "Today" : fmtDate(a.createdAt) }));

  return {
    kpis, valueFlow, valueTotal, funnel, quality, throughput, attention,
    intake: { bars, max: intakeMax, total: Math.round(intakeTotal), monthDeltaPct },
    followupsDue: followupsDue.slice(0, 6), activity: activityTop,
  };
}
