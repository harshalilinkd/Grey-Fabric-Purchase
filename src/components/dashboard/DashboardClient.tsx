"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { CountUp } from "@/components/ui/CountUp";
import { useRegisterCommands } from "@/components/experience/CommandProvider";
import { deriveDashboard, type DashboardSources } from "@/lib/dashboard";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fetchAllShipments } from "@/lib/shipments";
import { fetchProgramCards } from "@/lib/program-cards";
import { fetchQcInspections } from "@/lib/qc-inspection";
import { fetchWarehouseLog } from "@/lib/warehouse";
import { fetchReissueReturns } from "@/lib/reissue-return";
import { fetchFabricReceipts } from "@/lib/fabric-receipts";
import { fetchDyeingFollowups } from "@/lib/dyeing-followups";
import { fetchFinalReceipts } from "@/lib/final-receipts";
import { fmtAmount, fmtNum } from "@/lib/format";
import type {
  DyeingFollowup, FabricReceipt, FinalReceipt, ProgramCard, PurchaseOrder,
  QcInspection, ReissueReturn, Shipment, WarehouseLog,
} from "@/lib/types";

const DASH_NAV = [
  { id: "dash:po", title: "Open purchase orders", icon: "file", href: "/purchase-orders" },
  { id: "dash:grey", title: "Grey received this month", icon: "box", href: "/grey-receipts" },
  { id: "dash:dyeing", title: "Lots in dyeing", icon: "lines", href: "/dyeing-queue" },
  { id: "dash:qc", title: "Pending QC", icon: "checkCircle", href: "/qc-inspection" },
  { id: "dash:wh", title: "Warehouse stock", icon: "warehouse", href: "/warehouse" },
  { id: "dash:reissue", title: "Reissue pending", icon: "refresh", href: "/reissue-return" },
];

export function DashboardClient({
  initialPos, initialShipments, initialPrograms, initialQc, initialWarehouse,
  initialReissues, initialFabric, initialFollowups, initialFinals,
}: {
  initialPos: PurchaseOrder[];
  initialShipments: Shipment[];
  initialPrograms: ProgramCard[];
  initialQc: QcInspection[];
  initialWarehouse: WarehouseLog[];
  initialReissues: ReissueReturn[];
  initialFabric: FabricReceipt[];
  initialFollowups: DyeingFollowup[];
  initialFinals: FinalReceipt[];
}) {
  const router = useRouter();

  const posQ = useQuery({ queryKey: ["purchase_orders"], queryFn: fetchPurchaseOrders, initialData: initialPos });
  const shipQ = useQuery({ queryKey: ["shipments_all"], queryFn: fetchAllShipments, initialData: initialShipments });
  const progQ = useQuery({ queryKey: ["program_cards"], queryFn: fetchProgramCards, initialData: initialPrograms });
  const qcQ = useQuery({ queryKey: ["qc_inspections"], queryFn: fetchQcInspections, initialData: initialQc });
  const whQ = useQuery({ queryKey: ["warehouse_all"], queryFn: fetchWarehouseLog, initialData: initialWarehouse });
  const rrQ = useQuery({ queryKey: ["reissue_return"], queryFn: fetchReissueReturns, initialData: initialReissues });
  const fabQ = useQuery({ queryKey: ["fabric_receipts"], queryFn: fetchFabricReceipts, initialData: initialFabric });
  const dfQ = useQuery({ queryKey: ["dyeing_followups"], queryFn: fetchDyeingFollowups, initialData: initialFollowups });
  const finQ = useQuery({ queryKey: ["final_receipts"], queryFn: fetchFinalReceipts, initialData: initialFinals });

  useRegisterCommands(
    () => DASH_NAV.map((n) => ({ id: n.id, title: n.title, group: "Go to", icon: n.icon, run: () => router.push(n.href) })),
    [router],
  );

  const sources: DashboardSources = useMemo(() => ({
    pos: posQ.data ?? [], shipments: shipQ.data ?? [], programs: progQ.data ?? [], qc: qcQ.data ?? [],
    warehouse: whQ.data ?? [], reissues: rrQ.data ?? [], fabric: fabQ.data ?? [], followups: dfQ.data ?? [], finals: finQ.data ?? [],
  }), [posQ.data, shipQ.data, progQ.data, qcQ.data, whQ.data, rrQ.data, fabQ.data, dfQ.data, finQ.data]);

  const data = useMemo(() => deriveDashboard(sources), [sources]);
  const maxStage = Math.max(...data.funnel.map((f) => f.count), 1);
  const valueTotal = data.valueTotal || 1;
  const passPct = data.quality.passRate == null ? null : Math.round(data.quality.passRate * 100);
  const attnTotal = data.attention.reduce((a, b) => a + b.count, 0);

  // Slide-in only genuinely-new activity items.
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const newSet = new Set(primed.current ? data.activity.filter((a) => !seen.current.has(a.id)).map((a) => a.id) : []);
  useEffect(() => { for (const a of data.activity) seen.current.add(a.id); primed.current = true; });

  const loading = posQ.isPending || shipQ.isPending || progQ.isPending || qcQ.isPending || whQ.isPending || rrQ.isPending || fabQ.isPending || dfQ.isPending || finQ.isPending;

  if (loading) {
    return (
      <>
        <div className="page-head"><h1>Dashboard</h1><p>Live command center for your grey-fabric pipeline</p></div>
        <div className="kpi-grid">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 132, borderRadius: 14 }} />)}</div>
        <div className="skeleton" style={{ height: 120, borderRadius: 14, marginBottom: 16 }} />
        <div className="grid-2"><div className="skeleton" style={{ height: 240, borderRadius: 14 }} /><div className="skeleton" style={{ height: 240, borderRadius: 14 }} /></div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <p>Live command center for your grey-fabric pipeline — every stage, value &amp; alert in one view</p>
      </div>

      <div className="dash">
      {/* KPIs */}
      <div className="kpi-grid">
        {data.kpis.map((k) => (
          <Link key={k.key} href={k.href} className="kpi">
            <div className="kpi-top">
              <div className="kpi-icon"><Icon name={k.icon} /></div>
              {k.trend && <span className={`trend ${k.trend.tone}`}>{k.trend.text}</span>}
            </div>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value mono"><CountUp value={k.value} />{k.suffix && <small>{k.suffix}</small>}</div>
            <div className="kpi-sub">{k.sub}</div>
          </Link>
        ))}
      </div>

      {/* Value in pipeline */}
      <div className="panel first">
        <div className="panel-head"><h3>Value in pipeline</h3><span className="tag">{fmtAmount(data.valueTotal)} tracked</span></div>
        <div className="panel-body">
          <div className="vbar">
            {data.valueFlow.filter((v) => v.amount > 0).map((v) => (
              <div key={v.key} className="vseg" style={{ width: `${(v.amount / valueTotal) * 100}%`, background: `var(--${v.tone})` }} title={`${v.label}: ${fmtAmount(v.amount)}`} />
            ))}
          </div>
          <div className="vlegend">
            {data.valueFlow.map((v) => (
              <Link key={v.key} href={v.href} className="vleg">
                <span className="vdot" style={{ background: `var(--${v.tone})` }} />
                <div>
                  <div className="vleg-label">{v.label}</div>
                  <div className="vleg-m mono">{fmtNum(v.metres)} m</div>
                  <div className="vleg-amt mono">{fmtAmount(v.amount)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Funnel + Operations */}
      <div className="grid-2">
        <div className="panel b">
          <div className="panel-head"><h3>Lot stage funnel</h3><span className="tag">Lots reached</span></div>
          <div className="panel-body">
            {data.funnel.map((f) => (
              <div className="fr" key={f.key}>
                <div className="fl"><span className="fd" style={{ background: `var(--${f.tone})` }} />{f.label}</div>
                <div className="fb"><div className="ff" style={{ width: `${(f.count / maxStage) * 100}%`, background: `var(--${f.tone})` }} /></div>
                <div className="fc mono"><CountUp value={f.count} />{f.metres > 0 && <span className="fc-m">{fmtNum(f.metres)} m</span>}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel c">
          <div className="panel-head"><h3>Grey intake</h3><span className="tag">14 days · {fmtNum(data.intake.total)} m</span></div>
          <div className="panel-body chart-body">
            <div className="spark">
              {data.intake.bars.map((b, i) => (
                <div className="spark-col" key={i} title={`${b.label}: ${fmtNum(b.value)} m`}>
                  <div className="spark-track">
                    <div className={`spark-bar${b.isToday ? " today" : ""}${b.value === 0 ? " empty" : ""}`} style={{ height: `${b.value === 0 ? 0 : Math.max(8, (b.value / data.intake.max) * 100)}%` }} />
                  </div>
                  <span className="spark-lbl">{b.label}</span>
                </div>
              ))}
            </div>
            {data.intake.monthDeltaPct != null && (
              <div className="ops-sub">{data.intake.monthDeltaPct >= 0 ? "▲" : "▼"} {Math.abs(data.intake.monthDeltaPct)}% grey vs last month</div>
            )}
          </div>
        </div>
      </div>

      {/* Needs attention + Operations health */}
      <div className="grid-2">
        <div className="panel b">
          <div className="panel-head"><h3>Needs attention</h3>{attnTotal > 0 && <span className="tag">{attnTotal} item{attnTotal === 1 ? "" : "s"}</span>}</div>
          <div className="panel-body" style={{ paddingTop: 9 }}>
            {data.attention.length > 0 ? data.attention.map((a) => (
              <Link key={a.id} href={a.href} className="li">
                <div className="li-ic" style={{ background: `var(--${a.tone}-bg)`, color: `var(--${a.tone})` }}><Icon name={a.icon} /></div>
                <div className="li-b"><p><b>{a.label}</b></p><div className="li-t">Review in {a.to} →</div></div>
                <span className={`li-count ${a.tone}`}>{a.count}</span>
              </Link>
            )) : (
              <div className="all-clear">
                <div className="all-clear-ic"><Icon name="check" size={22} /></div>
                <p>All clear</p>
                <span>Nothing needs your attention right now.</span>
              </div>
            )}
          </div>
        </div>

        <div className="panel c">
          <div className="panel-head"><h3>Operations health</h3></div>
          <div className="panel-body">
            <div className="ops-block">
              <div className="ops-top"><span>QC pass rate</span><b className="mono">{passPct == null ? "—" : `${passPct}%`}</b></div>
              <div className="qcbar"><div className="qcbar-pass" style={{ width: `${data.quality.passRate == null ? 0 : data.quality.passRate * 100}%` }} /></div>
              <div className="ops-sub">{fmtNum(data.quality.passedMetres)} m passed · {fmtNum(data.quality.failedMetres)} m failed · {data.quality.inspected} inspected</div>
            </div>
            <div className="ops-grid">
              <div className="ops-stat">
                <div className="ops-stat-v mono">{data.throughput.avgCycleDays == null ? "—" : data.throughput.avgCycleDays}<small> days</small></div>
                <div className="ops-stat-l">Avg cycle · received → stored{data.throughput.cycleSample > 0 ? ` (${data.throughput.cycleSample} lots)` : ""}</div>
              </div>
              <div className="ops-stat">
                <div className={`ops-stat-v mono${data.throughput.longestDays > 7 ? " warn" : ""}`}>{data.throughput.longestDays || 0}<small> days</small></div>
                <div className="ops-stat-l">Longest in dyeing{data.throughput.longestLot ? ` · Lot ${data.throughput.longestLot}` : ""}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Follow-ups + Activity */}
      <div className="grid-2">
        <div className="panel b">
          <div className="panel-head"><h3>Follow-ups due</h3><span className="shuttle" /></div>
          <div className="panel-body" style={{ paddingTop: 9 }}>
            {data.followupsDue.length > 0 ? data.followupsDue.map((f) => (
              <Link className="li" key={f.id} href={f.href}>
                <div className="li-ic" style={{ background: `var(--${f.tone}-bg)`, color: `var(--${f.tone})` }}><Icon name={f.icon} /></div>
                <div className="li-b"><p><b>{f.lead}</b> {f.rest}</p><div className={`li-t${f.overdue ? " overdue" : ""}`}>{f.time}</div></div>
              </Link>
            )) : <p className="muted-note" style={{ padding: "8px 0" }}>All caught up — no follow-ups due.</p>}
          </div>
        </div>

        <div className="panel c">
          <div className="panel-head"><h3>Live activity</h3><span className="shuttle" /></div>
          <div className="panel-body" style={{ paddingTop: 9 }}>
            {data.activity.length > 0 ? data.activity.map((a) => (
              <Link className={`li${newSet.has(a.id) ? " new" : ""}`} key={a.id} href={a.href}>
                <div className="li-ic" style={{ background: `var(--${a.tone}-bg)`, color: `var(--${a.tone})` }}><Icon name={a.icon} /></div>
                <div className="li-b"><p><b>{a.lead}</b> {a.rest}</p><div className="li-t">{a.time}</div></div>
              </Link>
            )) : <p className="muted-note" style={{ padding: "8px 0" }}>No activity yet — receipts, programs, QC and stores appear here live.</p>}
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
