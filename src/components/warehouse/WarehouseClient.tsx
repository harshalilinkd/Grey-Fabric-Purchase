"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { CountUp } from "@/components/ui/CountUp";
import { usePageSearchInput, useRegisterCommands } from "@/components/experience/CommandProvider";
import { WarehouseDetailModal } from "./WarehouseDetailModal";
import { fetchWarehouseLog } from "@/lib/warehouse";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fetchProgramCards } from "@/lib/program-cards";
import { fetchReissueReturns } from "@/lib/reissue-return";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { ProgramCard, PurchaseOrder, ReissueReturn, WarehouseLog } from "@/lib/types";

type ColKey = "po_no" | "quality_name" | "vendor" | "dying_house" | "lot_no" | "metres";

const COLUMNS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "po_no", label: "PO No" },
  { key: "quality_name", label: "Quality Name" },
  { key: "vendor", label: "Vendor" },
  { key: "dying_house", label: "Dyeing House" },
  { key: "lot_no", label: "Lot No" },
  { key: "metres", label: "Stored Metres", num: true },
];

type Row = {
  key: string;
  lot_no: string | null;
  po_unique_id: string | null;
  entries: WarehouseLog[];
  metres: number;
  po_no: string | null;
  quality_name: string | null;
  vendor: string | null;
  dying_house: string | null;
  program_uid: string | null;
};

export function WarehouseClient({
  initialWarehouse,
  initialPos,
  initialPrograms,
  initialReissues,
}: {
  initialWarehouse: WarehouseLog[];
  initialPos: PurchaseOrder[];
  initialPrograms: ProgramCard[];
  initialReissues: ReissueReturn[];
}) {
  const { data: warehouse = [], isFetching } = useQuery({ queryKey: ["warehouse_all"], queryFn: fetchWarehouseLog, initialData: initialWarehouse });
  const { data: pos = [] } = useQuery({ queryKey: ["purchase_orders"], queryFn: fetchPurchaseOrders, initialData: initialPos });
  const { data: programs = [] } = useQuery({ queryKey: ["program_cards"], queryFn: fetchProgramCards, initialData: initialPrograms });
  const { data: reissues = [] } = useQuery({ queryKey: ["reissue_return"], queryFn: fetchReissueReturns, initialData: initialReissues });

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" }>({ key: "po_no", dir: "asc" });
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  useRegisterCommands(
    () => [{ id: "wh:search", title: "Search warehouse", group: "This page", icon: "search", run: () => searchRef.current?.focus() }],
    [],
  );

  const poByUid = useMemo(() => {
    const m: Record<string, PurchaseOrder> = {};
    for (const p of pos) m[p.unique_id] = p;
    return m;
  }, [pos]);
  const programByLot = useMemo(() => {
    const m: Record<string, ProgramCard> = {};
    for (const p of programs) if (p.lot_no && !m[p.lot_no]) m[p.lot_no] = p;
    return m;
  }, [programs]);

  // Metrics
  const totalMetres = useMemo(() => warehouse.reduce((s, w) => s + (w.passed_qty ?? 0), 0), [warehouse]);
  const designCount = warehouse.length;
  const reissuePending = useMemo(() => reissues.filter((r) => r.status !== "Returned").length, [reissues]);

  // One ledger row per lot (group warehouse_log), enriched with PO + program card.
  const allRows = useMemo<Row[]>(() => {
    const groups = new Map<string, Row>();
    for (const w of warehouse) {
      const key = `${w.po_unique_id ?? ""}__${w.lot_no ?? ""}`;
      let g = groups.get(key);
      if (!g) {
        const po = w.po_unique_id ? poByUid[w.po_unique_id] : undefined;
        const program = w.lot_no ? programByLot[w.lot_no] : undefined;
        g = {
          key, lot_no: w.lot_no, po_unique_id: w.po_unique_id, entries: [], metres: 0,
          po_no: po?.po_no ?? null, quality_name: po?.quality ?? po?.quality_name ?? null, vendor: po?.vendor_name ?? null,
          dying_house: program?.dying_house_name ?? null, program_uid: program?.program_uid ?? null,
        };
        groups.set(key, g);
      }
      g.entries.push(w);
      g.metres += w.passed_qty ?? 0;
    }
    return [...groups.values()];
  }, [warehouse, poByUid, programByLot]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = allRows;
    if (q) {
      list = list.filter((r) =>
        [r.po_no, r.quality_name, r.vendor, r.dying_house, r.lot_no].some((f) => (f ?? "").toLowerCase().includes(q)),
      );
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sort.key === "metres") return ((av as number) - (bv as number)) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [allRows, search, sort]);

  const toggleSort = (k: ColKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));

  const detailRow = useMemo(() => allRows.find((r) => r.key === detailKey) ?? null, [allRows, detailKey]);
  useEscClose(!!detailKey, () => setDetailKey(null));

  const renderCell = (r: Row, k: ColKey) => {
    if (k === "metres") return <span className="mono">{fmtNum(r.metres)}</span>;
    if (k === "po_no") return <span className="strong mono">{r.po_no ?? "—"}</span>;
    if (k === "lot_no") return <span className="mono">{r.lot_no ?? "—"}</span>;
    return <span>{r[k] ?? "—"}</span>;
  };

  const hasData = allRows.length > 0;

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Warehouse</h1>
          <p>Ready Goods stored after passing QC — the final source of truth</p>
        </div>
      </div>

      <div className="wh-metrics">
        <div className="wh-metric">
          <div className="wh-mtop"><span className="wh-micon"><Icon name="warehouse" size={18} /></span><span className="wh-mlabel">Total stored</span></div>
          <div className="wh-mvalue"><CountUp value={Math.round(totalMetres)} /> <small>m</small></div>
        </div>
        <div className="wh-metric">
          <div className="wh-mtop"><span className="wh-micon"><Icon name="box" size={18} /></span><span className="wh-mlabel">Stored designs</span></div>
          <div className="wh-mvalue"><CountUp value={designCount} /></div>
        </div>
        <div className="wh-metric">
          <div className="wh-mtop"><span className="wh-micon"><Icon name="refresh" size={18} /></span><span className="wh-mlabel">Reissue pending</span></div>
          <div className="wh-mvalue"><CountUp value={reissuePending} /></div>
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder="Search PO, quality, vendor, dyeing house, lot…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isFetching && <span className="fetching">Updating…</span>}
      </div>

      <div className="table-wrap">
        {rows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={`sortable ${c.num ? "num" : ""}`} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                      <button type="button" className="th-in" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        {sort.key === c.key && <Icon name={sort.dir === "asc" ? "arrowUp" : "arrowDown"} size={13} />}
                      </button>
                    </th>
                  ))}
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="clickable" onClick={() => setDetailKey(r.key)}>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className={c.num ? "num" : ""}>{renderCell(r, c.key)}</td>
                    ))}
                    <td className="col-actions">
                      <button className="act" onClick={(e) => { e.stopPropagation(); setDetailKey(r.key); }} aria-label={`Details for lot ${r.lot_no ?? "unknown"}`}>
                        <Icon name="info" size={15} />Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="ph-icon"><Icon name="warehouse" size={26} /></div>
            <h3>{hasData ? "No matching ready goods" : "No ready goods yet"}</h3>
            <p>
              {hasData
                ? "Try a different search."
                : "Passing a QC inspection stores the design here. Once lots clear QC, they appear as Ready Goods."}
            </p>
          </div>
        )}
      </div>

      {detailRow && (
        <WarehouseDetailModal
          entries={detailRow.entries}
          lotNo={detailRow.lot_no}
          po={detailRow.po_unique_id ? poByUid[detailRow.po_unique_id] : undefined}
          program={detailRow.lot_no ? programByLot[detailRow.lot_no] : undefined}
          reissues={reissues.filter((r) => r.original_lot_no && r.original_lot_no === detailRow.lot_no)}
          onClose={() => setDetailKey(null)}
        />
      )}
    </>
  );
}
