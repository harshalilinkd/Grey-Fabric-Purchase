"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { usePageSearchInput } from "@/components/experience/CommandProvider";
import { ReissueDetailModal, statusPillClass } from "./ReissueDetailModal";
import { assignNewLot, fetchReissueReturns, markReturned, updateReissueState } from "@/lib/reissue-return";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { optimisticPatch } from "@/lib/optimistic";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PurchaseOrder, ReissueReturn } from "@/lib/types";

const RR_KEY = ["reissue_return"] as const;

type ColKey = "po_no" | "vendor" | "quality_name" | "original_lot_no" | "original_design_no" | "reissue_qty" | "status";

const COLUMNS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "po_no", label: "PO No" },
  { key: "vendor", label: "Vendor" },
  { key: "quality_name", label: "Quality Name" },
  { key: "original_lot_no", label: "Original Lot No" },
  { key: "original_design_no", label: "Original Design No" },
  { key: "reissue_qty", label: "Failed Qty", num: true },
  { key: "status", label: "Status" },
];

type RRow = ReissueReturn & { po_no: string | null; vendor: string | null; quality_name: string | null };

export function ReissueReturnClient({
  initialRows,
  initialPos,
}: {
  initialRows: ReissueReturn[];
  initialPos: PurchaseOrder[];
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: rrRows = [], isFetching } = useQuery({ queryKey: RR_KEY, queryFn: fetchReissueReturns, initialData: initialRows });
  const { data: pos = [] } = useQuery({ queryKey: ["purchase_orders"], queryFn: fetchPurchaseOrders, initialData: initialPos });

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "pending" | "returned">("all");
  const [sort, setSort] = useState<{ key: ColKey | null; dir: "asc" | "desc" }>({ key: null, dir: "asc" });
  const [detailId, setDetailId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);

  useEscClose(!!detailId, () => setDetailId(null));

  const poByUid = useMemo(() => {
    const m: Record<string, PurchaseOrder> = {};
    for (const p of pos) m[p.unique_id] = p;
    return m;
  }, [pos]);

  const pendingCount = useMemo(() => rrRows.filter((r) => r.status !== "Returned").length, [rrRows]);
  const returnedCount = rrRows.length - pendingCount;

  const rows = useMemo<RRow[]>(() => {
    const q = search.trim().toLowerCase();
    let list: RRow[] = rrRows.map((r) => {
      const po = poByUid[r.original_po_unique_id ?? ""];
      return { ...r, po_no: po?.po_no ?? null, vendor: po?.vendor_name ?? null, quality_name: po?.quality_name ?? po?.quality ?? null };
    });
    if (view === "pending") list = list.filter((r) => r.status !== "Returned");
    else if (view === "returned") list = list.filter((r) => r.status === "Returned");
    if (q) list = list.filter((r) => [r.original_lot_no, r.original_design_no, r.new_lot_no, r.po_no, r.vendor, r.quality_name].some((f) => (f ?? "").toLowerCase().includes(q)));
    if (sort.key) {
      const key = sort.key;
      const dir = sort.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (key === "reissue_qty") return ((av as number) - (bv as number)) * dir;
        return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
      });
    }
    return list;
  }, [rrRows, view, search, poByUid, sort]);

  const toggleSort = (k: ColKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));

  const invalidate = () => qc.invalidateQueries({ queryKey: RR_KEY });

  const restoreM = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { status: ReissueReturn["status"]; new_lot_no: string | null } }) => updateReissueState(id, patch),
    onSuccess: () => { toast.success("Reverted"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const undoAction = (id: string, prior: ReissueReturn | undefined) =>
    prior ? { action: { label: "Undo", onClick: () => restoreM.mutate({ id, patch: { status: prior.status, new_lot_no: prior.new_lot_no } }) } } : undefined;

  const assignM = useMutation({
    mutationFn: ({ id, newLot }: { id: string; newLot: string }) => assignNewLot(id, newLot),
    onMutate: async ({ id, newLot }) => {
      await qc.cancelQueries({ queryKey: RR_KEY });
      const prior = rrRows.find((r) => r.id === id);
      const rollback = optimisticPatch<ReissueReturn>(qc, RR_KEY, (r) => r.id === id, { status: "Reissue Pending", new_lot_no: newLot });
      return { rollback, prior };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: (_d, { id }, ctx) => toast.success("New lot assigned", undoAction(id, ctx?.prior)),
    onSettled: () => invalidate(),
  });

  const returnM = useMutation({
    mutationFn: (id: string) => markReturned(id),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: RR_KEY });
      const prior = rrRows.find((r) => r.id === id);
      const rollback = optimisticPatch<ReissueReturn>(qc, RR_KEY, (r) => r.id === id, { status: "Returned", new_lot_no: null });
      return { rollback, prior };
    },
    onError: (e: Error, _id, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: (_d, id, ctx) => toast.success("Marked as returned", undoAction(id, ctx?.prior)),
    onSettled: () => invalidate(),
  });

  const detailRow = useMemo(() => rrRows.find((r) => r.id === detailId) ?? null, [rrRows, detailId]);
  const saving = assignM.isPending || returnM.isPending;
  const hasData = rrRows.length > 0;

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Reissue &amp; Return</h1>
          <p>Failed QC quantities sent back for re-dyeing or returned</p>
        </div>
      </div>

      <div className="toolbar split">
        <div className="seg" role="group" aria-label="Filter by status">
          <button className={view === "all" ? "on" : ""} aria-pressed={view === "all"} onClick={() => setView("all")}>
            All <span className="cnt mono">{rrRows.length}</span>
          </button>
          <button className={view === "pending" ? "on" : ""} aria-pressed={view === "pending"} onClick={() => setView("pending")}>
            Pending <span className="cnt mono">{pendingCount}</span>
          </button>
          <button className={view === "returned" ? "on" : ""} aria-pressed={view === "returned"} onClick={() => setView("returned")}>
            Returned <span className="cnt mono">{returnedCount}</span>
          </button>
        </div>
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder="Search PO, vendor, quality, lot, design…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                  <tr key={r.id} className="clickable" onClick={() => setDetailId(r.id)}>
                    <td><span className="mono">{r.po_no ?? "—"}</span></td>
                    <td>{r.vendor ?? "—"}</td>
                    <td>{r.quality_name ?? "—"}</td>
                    <td><span className="mono">{r.original_lot_no ?? "—"}</span></td>
                    <td><span className="mono">{r.original_design_no ?? "—"}</span></td>
                    <td className="num mono">{fmtNum(r.reissue_qty)}</td>
                    <td>
                      <button
                        className="cell-btn"
                        onClick={(e) => { e.stopPropagation(); setDetailId(r.id); }}
                        aria-label={`Open reissue for lot ${r.original_lot_no ?? "unknown"}`}
                      >
                        <span className={`pill ${statusPillClass(r.status)}`}>{r.status}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="ph-icon"><Icon name="refresh" size={26} /></div>
            <h3>{hasData ? "No matching rows" : "No reissues or returns yet"}</h3>
            <p>
              {hasData
                ? "Try a different search or filter."
                : "Failing a QC inspection with a failed quantity adds the lot here for reissue or return."}
            </p>
          </div>
        )}
      </div>

      {detailRow && (
        <ReissueDetailModal
          row={detailRow}
          po={poByUid[detailRow.original_po_unique_id ?? ""]}
          saving={saving}
          onAssign={(newLot) => assignM.mutate({ id: detailRow.id, newLot })}
          onReturned={() => returnM.mutate(detailRow.id)}
          onClose={() => setDetailId(null)}
        />
      )}
    </>
  );
}
