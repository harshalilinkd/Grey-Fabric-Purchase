import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { CountUp } from "@/components/ui/CountUp";

/**
 * Dashboard. Figures are demo data for now (matching the prototype) and will be
 * replaced with live Supabase queries once auth + data fetching are wired up.
 */

type Kpi = {
  href: string;
  icon: string;
  label: string;
  value: number;
  suffix?: string;
  sub: string;
  trend?: { tone: "up" | "warn"; text: string };
};

const KPIS: Kpi[] = [
  { href: "/purchase-orders", icon: "file", label: "Open POs", value: 17, sub: "₹ 1.06 Cr ordered value", trend: { tone: "up", text: "↑ 12%" } },
  { href: "/grey-receipts", icon: "box", label: "Grey received (Jun)", value: 48200, suffix: " m", sub: "across 16 lots" },
  { href: "/dyeing-queue", icon: "lines", label: "Lots in dyeing", value: 9, sub: "3 pending program" },
  { href: "/qc-inspection", icon: "checkCircle", label: "Pending QC", value: 5, sub: "awaiting inspection", trend: { tone: "warn", text: "3 due" } },
  { href: "/warehouse", icon: "warehouse", label: "Warehouse stock", value: 31440, suffix: " m", sub: "QC-passed fabric" },
];

/* One restrained accent for the funnel; status colors mark the done/waiting ends. */
const FUNNEL = [
  { label: "Received", color: "var(--accent)", width: 100, count: 16 },
  { label: "Programmed", color: "var(--accent)", width: 81, count: 13 },
  { label: "In dyeing", color: "var(--accent)", width: 56, count: 9 },
  { label: "Received back", color: "var(--accent)", width: 44, count: 7 },
  { label: "Warehoused", color: "var(--ok)", width: 31, count: 5 },
];

const FOLLOWUPS = [
  { tone: "bad", lead: "Lot 31", rest: "· Das dyeing house", time: "Overdue by 2 days" },
  { tone: "warn", lead: "PO 0051", rest: "· RT Fabric grey receipt", time: "Due today" },
  { tone: "info", lead: "Lot 24", rest: "· QC follow-up", time: "In 1 day" },
] as const;

export default function DashboardPage() {
  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <p>Live overview of your grey fabric pipeline</p>
      </div>

      <div className="kpi-grid">
        {KPIS.map((k) => (
          <Link key={k.href} href={k.href} className="kpi">
            <div className="kpi-top">
              <div className="kpi-icon">
                <Icon name={k.icon} />
              </div>
              {k.trend && <span className={`trend ${k.trend.tone}`}>{k.trend.text}</span>}
            </div>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value mono">
              <CountUp value={k.value} />
              {k.suffix && <small>{k.suffix}</small>}
            </div>
            <div className="kpi-sub">{k.sub}</div>
          </Link>
        ))}
      </div>

      <div className="grid-2">
        <div className="panel b">
          <div className="panel-head">
            <h3>Lot stage funnel</h3>
            <span className="tag">This month</span>
          </div>
          <div className="panel-body">
            {FUNNEL.map((f) => (
              <div className="fr" key={f.label}>
                <div className="fl">
                  <span className="fd" style={{ background: f.color }} />
                  {f.label}
                </div>
                <div className="fb">
                  <div className="ff" style={{ width: `${f.width}%`, background: f.color }} />
                </div>
                <div className="fc mono">{f.count}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel c">
          <div className="panel-head">
            <h3>Follow-ups due</h3>
            <span className="shuttle" />
          </div>
          <div className="panel-body" style={{ paddingTop: 9 }}>
            {FOLLOWUPS.map((f) => (
              <div className="li" key={f.lead}>
                <div
                  className="li-ic"
                  style={{ background: `var(--${f.tone}-bg)`, color: `var(--${f.tone})` }}
                >
                  <Icon name="clock" />
                </div>
                <div className="li-b">
                  <p>
                    <b>{f.lead}</b> {f.rest}
                  </p>
                  <div className="li-t">{f.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
