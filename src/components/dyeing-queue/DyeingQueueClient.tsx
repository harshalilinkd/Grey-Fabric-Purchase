"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { usePageSearchInput } from "@/components/experience/CommandProvider";
import { fetchAllShipments } from "@/lib/shipments";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fetchProgramCardLotNos, fetchQcCheckedLotNos } from "@/lib/dyeing-queue";
import { fmtAmount, fmtDate, fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PurchaseOrder, Shipment } from "@/lib/types";

export function DyeingQueueClient({
  initialShipments,
  initialPos,
  initialProgramLots,
  initialQcLots,
}: {
  initialShipments: Shipment[];
  initialPos: PurchaseOrder[];
  initialProgramLots: string[];
  initialQcLots: string[];
}) {
  const { data: shipments = [], isFetching } = useQuery({ queryKey: ["shipments_all"], queryFn: fetchAllShipments, initialData: initialShipments });
  const { data: pos = [] } = useQuery({ queryKey: ["purchase_orders"], queryFn: fetchPurchaseOrders, initialData: initialPos });
  const { data: programLots = [] } = useQuery({ queryKey: ["program_card_lots"], queryFn: fetchProgramCardLotNos, initialData: initialProgramLots });
  const { data: qcLots = [] } = useQuery({ queryKey: ["qc_lots"], queryFn: fetchQcCheckedLotNos, initialData: initialQcLots });

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "pending" | "created">("all");
  const [infoPo, setInfoPo] = useState<PurchaseOrder | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);

  useEscClose(!!infoPo, () => setInfoPo(null));

  const poByUid = useMemo(() => {
    const m: Record<string, PurchaseOrder> = {};
    for (const p of pos) m[p.unique_id] = p;
    return m;
  }, [pos]);
  const programSet = useMemo(() => new Set(programLots), [programLots]);
  const qcSet = useMemo(() => new Set(qcLots), [qcLots]);

  // Every shipment is a lot entry; hide any lot already QC'd; derive status.
  const baseQueue = useMemo(() => {
    return shipments
      .filter((s) => !(s.lot_no && qcSet.has(s.lot_no)))
      .map((s) => {
        const created = !!(s.lot_no && programSet.has(s.lot_no));
        return { shipment: s, po: poByUid[s.po_unique_id] as PurchaseOrder | undefined, created };
      });
  }, [shipments, qcSet, programSet, poByUid]);

  const pendingCount = baseQueue.filter((r) => !r.created).length;
  const createdCount = baseQueue.filter((r) => r.created).length;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = baseQueue;
    if (view !== "all") list = list.filter((r) => (view === "created" ? r.created : !r.created));
    if (!q) return list;
    return list.filter((r) =>
      [r.shipment.lot_no, r.po?.po_no, r.po?.vendor_name].some((f) => (f ?? "").toLowerCase().includes(q)),
    );
  }, [baseQueue, search, view]);

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Dyeing Queue</h1>
          <p>Lots awaiting or in-progress dyeing</p>
        </div>
      </div>

      <div className="toolbar split">
        <div className="seg" role="group" aria-label="Filter by program status">
          <button className={view === "all" ? "on" : ""} aria-pressed={view === "all"} onClick={() => setView("all")}>
            All lots <span className="cnt mono">{baseQueue.length}</span>
          </button>
          <button className={view === "pending" ? "on" : ""} aria-pressed={view === "pending"} onClick={() => setView("pending")}>
            Pending program <span className="cnt mono">{pendingCount}</span>
          </button>
          <button className={view === "created" ? "on" : ""} aria-pressed={view === "created"} onClick={() => setView("created")}>
            Program created <span className="cnt mono">{createdCount}</span>
          </button>
        </div>
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder="Search lot no, PO no, vendor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isFetching && <span className="fetching">Updating…</span>}
      </div>

      <div className="table-wrap">
        {rows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Shipment date</th>
                  <th>Lot No</th>
                  <th className="num">Sent Qty</th>
                  <th>PO No</th>
                  <th>Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.shipment.id}>
                    <td><span className="dim">{fmtDate(r.shipment.shipment_date)}</span></td>
                    <td><span className="strong mono">{r.shipment.lot_no ?? "—"}</span></td>
                    <td className="num mono">{fmtNum(r.shipment.sent_quantity)}</td>
                    <td><span className="mono">{r.po?.po_no ?? "—"}</span></td>
                    <td><span className={`pill ${r.created ? "success" : "warning"}`}>{r.created ? "Program Created" : "Pending Program"}</span></td>
                    <td className="col-actions">
                      <button className="act" onClick={() => r.po && setInfoPo(r.po)} disabled={!r.po}>
                        <Icon name="info" size={15} />Info
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="ph-icon"><Icon name="lines" size={26} /></div>
            <h3>
              {baseQueue.length
                ? search.trim()
                  ? "No matching lots"
                  : view === "pending"
                    ? "Nothing pending"
                    : "No programs created yet"
                : "Queue is clear"}
            </h3>
            <p>
              {baseQueue.length
                ? search.trim()
                  ? "Try a different search."
                  : view === "pending"
                    ? "Every lot in the queue has a dyeing program."
                    : "Create program cards and they'll show up here."
                : shipments.length
                  ? "Every lot has been quality-checked — nothing left in the dyeing queue."
                  : "Log shipments on Grey House Follow Up and lots will appear here, ready for dyeing."}
            </p>
            {!shipments.length && (
              <Link className="btn btn-primary" href="/grey-receipts">
                <Icon name="box" />Log a grey receipt
              </Link>
            )}
          </div>
        )}
      </div>

      {infoPo && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setInfoPo(null)}>
          <div className="modal sm" role="dialog" aria-modal="true" aria-label="Parent purchase order">
            <div className="modal-head">
              <div>
                <h3>PO <span className="mono">{infoPo.po_no ?? infoPo.unique_id}</span></h3>
                <p>Parent purchase order</p>
              </div>
              <button className="close-x" onClick={() => setInfoPo(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <div className="sum">
                <div className="sum-row"><span>PO No</span><b className="mono">{infoPo.po_no ?? "—"}</b></div>
                <div className="sum-row"><span>Vendor</span><b>{infoPo.vendor_name ?? "—"}</b></div>
                <div className="sum-row"><span>Process</span><b>{infoPo.process ?? "—"}</b></div>
                <div className="sum-row"><span>Order date</span><b>{fmtDate(infoPo.order_date)}</b></div>
                <div className="sum-row"><span>Total qty</span><b className="mono">{fmtNum(infoPo.quantity)} m</b></div>
                <div className="sum-row"><span>Rate</span><b className="mono">{infoPo.rate == null ? "—" : fmtAmount(infoPo.rate)}</b></div>
                <div className="sum-row"><span>Amount</span><b className="mono">{fmtAmount(infoPo.amount)}</b></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
