"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { usePageSearchInput } from "@/components/experience/CommandProvider";
import { ReissueDetailModal, statusPillClass } from "./ReissueDetailModal";
import { assignNewLot, fetchReissueReturns, markReturned } from "@/lib/reissue-return";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PurchaseOrder, ReissueReturn } from "@/lib/types";

export function ReissueReturnClient({
  initialRows,
  initialPos,
}: {
  initialRows: ReissueReturn[];
  initialPos: PurchaseOrder[];
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: rrRows = [], isFetching } = useQuery({
    queryKey: ["reissue_return"],
    queryFn: fetchReissueReturns,
    initialData: initialRows,
  });
  const { data: pos = [] } = useQuery({
    queryKey: ["purchase_orders"],
    queryFn: fetchPurchaseOrders,
    initialData: initialPos,
  });

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "pending" | "returned">("all");
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

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rrRows;
    if (view === "pending") list = list.filter((r) => r.status !== "Returned");
    else if (view === "returned") list = list.filter((r) => r.status === "Returned");
    if (!q) return list;
    return list.filter((r) => {
      const po = poByUid[r.original_po_unique_id ?? ""];
      return [r.original_lot_no, r.original_design_no, r.new_lot_no, po?.po_no, po?.vendor_name].some((f) =>
        (f ?? "").toLowerCase().includes(q),
      );
    });
  }, [rrRows, view, search, poByUid]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["reissue_return"] });

  const assignM = useMutation({
    mutationFn: ({ id, newLot }: { id: string; newLot: string }) => assignNewLot(id, newLot),
    onSuccess: () => { toast.success("New lot assigned"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const returnM = useMutation({
    mutationFn: (id: string) => markReturned(id),
    onSuccess: () => { toast.success("Marked as returned"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
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
          <input ref={searchRef} placeholder="Search PO, vendor, lot, design…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isFetching && <span className="fetching">Updating…</span>}
      </div>

      <div className="table-wrap">
        {rows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>PO No</th>
                  <th>Vendor</th>
                  <th>Original Lot No</th>
                  <th>Original Design No</th>
                  <th className="num">Failed Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const po = poByUid[r.original_po_unique_id ?? ""];
                  return (
                    <tr key={r.id} className="clickable" onClick={() => setDetailId(r.id)}>
                      <td><span className="mono">{po?.po_no ?? "—"}</span></td>
                      <td>{po?.vendor_name ?? "—"}</td>
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
                  );
                })}
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
