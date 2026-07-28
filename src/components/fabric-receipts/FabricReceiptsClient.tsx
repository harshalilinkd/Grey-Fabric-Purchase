"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { usePagePrimaryAction, usePageSearchInput } from "@/components/experience/CommandProvider";
import { FabricReceiptFormModal, type FabricLot } from "./FabricReceiptFormModal";
import { createFabricReceipt, fetchFabricReceipts } from "@/lib/fabric-receipts";
import { fetchProgramCards } from "@/lib/program-cards";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fetchClosedQcLotNos } from "@/lib/dyeing-queue";
import { optimisticList } from "@/lib/optimistic";
import { fmtDate, fmtNum } from "@/lib/format";
import type { FabricReceipt, FabricReceiptFormValues, ProgramCard, PurchaseOrder } from "@/lib/types";

const FAB_KEY = ["fabric_receipts"] as const;

type ColKey =
  | "lot_no" | "po_no" | "design_no" | "color" | "programmed" | "received"
  | "received_date" | "status" | "next_followup_date";

const COLUMNS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "lot_no", label: "Lot No" },
  { key: "po_no", label: "PO No" },
  { key: "design_no", label: "Design" },
  { key: "color", label: "Colour" },
  { key: "programmed", label: "Should Receive", num: true },
  { key: "received", label: "Received", num: true },
  { key: "received_date", label: "Date" },
  { key: "status", label: "Status" },
  { key: "next_followup_date", label: "Next Follow-up" },
];

/** Lot stage status, spelled exactly as the business reads it. */
const STATUS_PENDING = "Pending";
const STATUS_RECEIVED = "Ordered Qty Received After Dyeing";

const todayISO = () => new Date().toISOString().slice(0, 10);

type FRow = FabricReceipt & {
  po_no: string | null;
  vendor: string | null;
  programmed: number | null;
  received: number | null;
  short: boolean;
  /** Derived from the row's LOT, not the row itself. */
  lotComplete: boolean;
  followupDue: boolean;
};

function optimisticReceipts(v: FabricReceiptFormValues): FabricReceipt[] {
  const now = new Date().toISOString();
  return v.designs
    .filter((d) => d.received.trim() !== "")
    .map((d, i) => {
      const r = Number(d.received);
      return {
        id: `temp-${now}-${i}`,
        receipt_id: `FAB-${now}-${i}`,
        lot_no: v.lot_no.trim() || null,
        po_unique_id: v.po_unique_id || null,
        design_no: d.design_no.trim() || null,
        color: d.color.trim() || null,
        programmed_meters: d.programmed,
        received_meters: Number.isFinite(r) ? r : null,
        received_date: v.received_date || null,
        remark: v.remark.trim() || null,
        next_followup_date: v.next_followup_date,
        remaining_qty: v.remaining_qty,
        created_at: now,
      };
    });
}

export function FabricReceiptsClient({
  initialReceipts,
  initialPrograms,
  initialPos,
  initialQcLots,
}: {
  initialReceipts: FabricReceipt[];
  initialPrograms: ProgramCard[];
  initialPos: PurchaseOrder[];
  initialQcLots: string[];
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: receipts = [], isFetching } = useQuery({ queryKey: FAB_KEY, queryFn: fetchFabricReceipts, initialData: initialReceipts });
  const { data: programs = [] } = useQuery({ queryKey: ["program_cards"], queryFn: fetchProgramCards, initialData: initialPrograms });
  const { data: pos = [] } = useQuery({ queryKey: ["purchase_orders"], queryFn: fetchPurchaseOrders, initialData: initialPos });
  const { data: qcLots = [] } = useQuery({ queryKey: ["qc_lots"], queryFn: fetchClosedQcLotNos, initialData: initialQcLots });

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "pending" | "received">("all");
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" }>({ key: "received_date", dir: "desc" });
  const [formOpen, setFormOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  const openNew = useCallback(() => setFormOpen(true), []);
  usePagePrimaryAction("Record fabric receipt", openNew);

  const poByUid = useMemo(() => {
    const m: Record<string, PurchaseOrder> = {};
    for (const p of pos) m[p.unique_id] = p;
    return m;
  }, [pos]);

  // Lots whose dyed fabric can be received = have a program card, not yet QC'd.
  const availableLots = useMemo<FabricLot[]>(() => {
    const qcSet = new Set(qcLots);
    const seen = new Set<string>();
    const out: FabricLot[] = [];
    for (const p of programs) {
      if (!p.lot_no || qcSet.has(p.lot_no) || seen.has(p.lot_no)) continue;
      seen.add(p.lot_no);
      const po = poByUid[p.po_unique_id];
      out.push({ lot_no: p.lot_no, po_unique_id: p.po_unique_id, po_no: po?.po_no ?? null, vendor: po?.vendor_name ?? null, program_id: p.id });
    }
    return out;
  }, [programs, qcLots, poByUid]);

  /* ---- Stage-3 derivations, all at LOT level ----
     receivedToDate(lot) = Σ received · remaining = lot qty − receivedToDate
     lot qty = what was programmed to the dyeing house (program card total metres). */
  const programmedByLot = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of programs) if (p.lot_no) m[p.lot_no] = (m[p.lot_no] ?? 0) + (p.total_meters ?? 0);
    return m;
  }, [programs]);

  const receivedByLot = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of receipts) if (r.lot_no) m[r.lot_no] = (m[r.lot_no] ?? 0) + (r.received_meters ?? 0);
    return m;
  }, [receipts]);

  /** Already received per `lot||design` — seeds each form row's outstanding default. */
  const receivedByLotDesign = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of receipts) {
      if (!r.lot_no) continue;
      const k = `${r.lot_no}||${r.design_no ?? ""}`;
      m[k] = (m[k] ?? 0) + (r.received_meters ?? 0);
    }
    return m;
  }, [receipts]);

  /** A lot is complete once receivedToDate ≥ lot qty — the Stage-3 exit condition. */
  const isLotComplete = useCallback(
    (lot: string | null) => {
      if (!lot) return false;
      const target = programmedByLot[lot] ?? 0;
      return target > 0 && (receivedByLot[lot] ?? 0) >= target;
    },
    [programmedByLot, receivedByLot],
  );

  const today = todayISO();

  const enriched = useMemo<FRow[]>(
    () =>
      receipts.map((r) => {
        const po = r.po_unique_id ? poByUid[r.po_unique_id] : undefined;
        const short = r.received_meters != null && r.programmed_meters != null && r.received_meters < r.programmed_meters;
        const complete = isLotComplete(r.lot_no);
        return {
          ...r,
          po_no: po?.po_no ?? null,
          vendor: po?.vendor_name ?? null,
          programmed: r.programmed_meters,
          received: r.received_meters,
          short,
          lotComplete: complete,
          followupDue: !complete && !!r.next_followup_date && r.next_followup_date <= today,
        };
      }),
    [receipts, poByUid, isLotComplete, today],
  );

  const counts = useMemo(() => {
    const done = enriched.filter((r) => r.lotComplete).length;
    return { all: enriched.length, pending: enriched.length - done, received: done };
  }, [enriched]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = enriched;
    if (view !== "all") list = list.filter((r) => (view === "received" ? r.lotComplete : !r.lotComplete));
    if (q) {
      list = list.filter((r) =>
        [r.lot_no, r.po_no, r.vendor, r.design_no, r.color, r.remark].some((f) => (f ?? "").toLowerCase().includes(q)),
      );
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort.key === "status") return ((a.lotComplete ? 1 : 0) - (b.lotComplete ? 1 : 0)) * dir;
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sort.key === "programmed" || sort.key === "received") return ((av as number) - (bv as number)) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [enriched, search, sort, view]);

  const toggleSort = (k: ColKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));

  const createM = useMutation({
    mutationFn: (v: FabricReceiptFormValues) => createFabricReceipt(v),
    onMutate: async (v: FabricReceiptFormValues) => {
      setFormOpen(false);
      await qc.cancelQueries({ queryKey: FAB_KEY });
      const temps = optimisticReceipts(v);
      return { rollback: optimisticList<FabricReceipt>(qc, FAB_KEY, (cur) => [...temps, ...cur]) };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: () => toast.success("Fabric receipt recorded"),
    onSettled: () => qc.invalidateQueries({ queryKey: FAB_KEY }),
  });

  const renderCell = (r: FRow, k: ColKey) => {
    if (k === "programmed") return <span className="mono">{fmtNum(r.programmed)}</span>;
    if (k === "received") return <span className={`mono${r.short ? " fab-short" : ""}`}>{fmtNum(r.received)}</span>;
    if (k === "received_date") return <span className="dim">{fmtDate(r.received_date)}</span>;
    if (k === "lot_no") return <span className="mono">{r.lot_no ?? "—"}</span>;
    if (k === "po_no") return <span className="strong mono">{r.po_no ?? "—"}</span>;
    if (k === "design_no") return <span className="mono">{r.design_no ?? "—"}</span>;
    if (k === "status")
      return (
        <span className={`pill ${r.lotComplete ? "success" : "warning"}`}>
          {r.lotComplete ? STATUS_RECEIVED : STATUS_PENDING}
        </span>
      );
    if (k === "next_followup_date") {
      if (r.lotComplete || !r.next_followup_date) return <span className="dim">—</span>;
      return r.followupDue
        ? <span className="pill danger">Due · {fmtDate(r.next_followup_date)}</span>
        : <span className="dim">{fmtDate(r.next_followup_date)}</span>;
    }
    return <span>{r[k] ?? "—"}</span>;
  };

  const hasData = receipts.length > 0;

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Fabric Receipts</h1>
          <p>Dyed fabric received back from the dyeing house, per design</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <Icon name="plus" />Record fabric receipt
        </button>
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter by lot status">
          {([
            { key: "all", label: "All", n: counts.all },
            { key: "pending", label: STATUS_PENDING, n: counts.pending },
            { key: "received", label: STATUS_RECEIVED, n: counts.received },
          ] as const).map((s) => (
            <button key={s.key} type="button" className={view === s.key ? "on" : ""} aria-pressed={view === s.key} onClick={() => setView(s.key)}>
              {s.label}<span className="cnt">{s.n}</span>
            </button>
          ))}
        </div>
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder="Search lot, PO, vendor, design, colour…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className={c.num ? "num" : ""}>{renderCell(r, c.key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="ph-icon"><Icon name="box" size={26} /></div>
            <h3>{hasData ? "No matching receipts" : "No fabric receipts yet"}</h3>
            <p>
              {hasData
                ? "Try a different search."
                : "Record a fabric receipt when dyed fabric comes back from the dyeing house."}
            </p>
            {!hasData && (
              <button className="btn btn-primary" onClick={openNew}>
                <Icon name="plus" />Record fabric receipt
              </button>
            )}
          </div>
        )}
      </div>

      <FabricReceiptFormModal
        open={formOpen}
        availableLots={availableLots}
        saving={createM.isPending}
        receivedByLot={receivedByLot}
        receivedByLotDesign={receivedByLotDesign}
        onClose={() => setFormOpen(false)}
        onSave={(v) => createM.mutate(v)}
      />
    </>
  );
}
