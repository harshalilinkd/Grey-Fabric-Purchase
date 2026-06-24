"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { usePagePrimaryAction, usePageSearchInput } from "@/components/experience/CommandProvider";
import { FinalReceiptFormModal, type FinalLot } from "./FinalReceiptFormModal";
import { createFinalReceipt, fetchFinalReceipts } from "@/lib/final-receipts";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fetchWarehouseLog } from "@/lib/warehouse";
import { optimisticList } from "@/lib/optimistic";
import { fmtDate, fmtNum } from "@/lib/format";
import type { FinalReceipt, FinalReceiptFormValues, FinalReceiptStatus, PurchaseOrder, WarehouseLog } from "@/lib/types";

const FR_KEY = ["final_receipts"] as const;

type ColKey = "lot_no" | "po_no" | "quality_name" | "final_qty" | "received_date" | "status";

const COLUMNS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "lot_no", label: "Lot No" },
  { key: "po_no", label: "PO No" },
  { key: "quality_name", label: "Quality Name" },
  { key: "final_qty", label: "Final Metres", num: true },
  { key: "received_date", label: "Date" },
  { key: "status", label: "Status" },
];

function statusPill(s: FinalReceiptStatus | string): string {
  switch (s) {
    case "Closed": return "success";
    case "Partial": return "warning";
    case "On Hold": return "info";
    default: return "plain";
  }
}

type FRow = FinalReceipt & { po_no: string | null; quality_name: string | null; vendor: string | null };

function optimisticReceipt(v: FinalReceiptFormValues): FinalReceipt {
  const now = new Date().toISOString();
  const q = Number(v.final_qty);
  return {
    id: `temp-${now}`,
    receipt_id: `FR-${now}`,
    lot_no: v.lot_no.trim() || null,
    po_unique_id: v.po_unique_id || null,
    final_qty: v.final_qty.trim() !== "" && Number.isFinite(q) ? q : null,
    status: v.status,
    remark: v.remark.trim() || null,
    received_date: v.received_date || null,
    created_at: now,
  };
}

export function FinalReceiptsClient({
  initialReceipts,
  initialWarehouse,
  initialPos,
}: {
  initialReceipts: FinalReceipt[];
  initialWarehouse: WarehouseLog[];
  initialPos: PurchaseOrder[];
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: receipts = [], isFetching } = useQuery({ queryKey: FR_KEY, queryFn: fetchFinalReceipts, initialData: initialReceipts });
  const { data: warehouse = [] } = useQuery({ queryKey: ["warehouse_all"], queryFn: fetchWarehouseLog, initialData: initialWarehouse });
  const { data: pos = [] } = useQuery({ queryKey: ["purchase_orders"], queryFn: fetchPurchaseOrders, initialData: initialPos });

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" }>({ key: "received_date", dir: "desc" });
  const [formOpen, setFormOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  const openNew = useCallback(() => setFormOpen(true), []);
  usePagePrimaryAction("Record final receipt", openNew);

  const poByUid = useMemo(() => {
    const m: Record<string, PurchaseOrder> = {};
    for (const p of pos) m[p.unique_id] = p;
    return m;
  }, [pos]);

  // Eligible lots = QC-passed (in warehouse_log) and not yet closed by a final receipt.
  const availableLots = useMemo<FinalLot[]>(() => {
    const closed = new Set(receipts.map((r) => r.lot_no).filter((x): x is string => !!x));
    const byLot = new Map<string, FinalLot>();
    for (const w of warehouse) {
      if (!w.lot_no || closed.has(w.lot_no)) continue;
      let l = byLot.get(w.lot_no);
      if (!l) {
        const po = w.po_unique_id ? poByUid[w.po_unique_id] : undefined;
        l = { lot_no: w.lot_no, po_unique_id: w.po_unique_id, po_no: po?.po_no ?? null, vendor: po?.vendor_name ?? null, quality_name: po?.quality_name ?? null, storedMeters: 0 };
        byLot.set(w.lot_no, l);
      }
      l.storedMeters += w.passed_qty ?? 0;
    }
    return [...byLot.values()];
  }, [warehouse, receipts, poByUid]);

  const enriched = useMemo<FRow[]>(
    () =>
      receipts.map((r) => {
        const po = r.po_unique_id ? poByUid[r.po_unique_id] : undefined;
        return { ...r, po_no: po?.po_no ?? null, quality_name: po?.quality_name ?? null, vendor: po?.vendor_name ?? null };
      }),
    [receipts, poByUid],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = enriched;
    if (q) {
      list = list.filter((r) =>
        [r.lot_no, r.po_no, r.quality_name, r.vendor, r.status, r.remark].some((f) => (f ?? "").toLowerCase().includes(q)),
      );
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sort.key === "final_qty") return ((av as number) - (bv as number)) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [enriched, search, sort]);

  const toggleSort = (k: ColKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));

  const createM = useMutation({
    mutationFn: (v: FinalReceiptFormValues) => createFinalReceipt(v),
    onMutate: async (v: FinalReceiptFormValues) => {
      setFormOpen(false);
      await qc.cancelQueries({ queryKey: FR_KEY });
      const temp = optimisticReceipt(v);
      return { rollback: optimisticList<FinalReceipt>(qc, FR_KEY, (cur) => [temp, ...cur]) };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: () => toast.success("Final receipt recorded"),
    onSettled: () => qc.invalidateQueries({ queryKey: FR_KEY }),
  });

  const renderCell = (r: FRow, k: ColKey) => {
    if (k === "final_qty") return <span className="mono">{fmtNum(r.final_qty)}</span>;
    if (k === "received_date") return <span className="dim">{fmtDate(r.received_date)}</span>;
    if (k === "lot_no") return <span className="mono">{r.lot_no ?? "—"}</span>;
    if (k === "po_no") return <span className="strong mono">{r.po_no ?? "—"}</span>;
    if (k === "status") return <span className={`pill ${statusPill(r.status)}`}>{r.status}</span>;
    return <span>{r[k] ?? "—"}</span>;
  };

  const hasData = receipts.length > 0;

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Final Receipts</h1>
          <p>Final confirmed good quantity per lot — closes the lot</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <Icon name="plus" />Record final receipt
        </button>
      </div>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder="Search lot, PO, quality, status…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
            <div className="ph-icon"><Icon name="check" size={26} /></div>
            <h3>{hasData ? "No matching receipts" : "No final receipts yet"}</h3>
            <p>
              {hasData
                ? "Try a different search."
                : "Record a final receipt to close a QC-passed lot with its confirmed good quantity."}
            </p>
            {!hasData && (
              <button className="btn btn-primary" onClick={openNew}>
                <Icon name="plus" />Record final receipt
              </button>
            )}
          </div>
        )}
      </div>

      <FinalReceiptFormModal
        open={formOpen}
        availableLots={availableLots}
        saving={createM.isPending}
        onClose={() => setFormOpen(false)}
        onSave={(v) => createM.mutate(v)}
      />
    </>
  );
}
