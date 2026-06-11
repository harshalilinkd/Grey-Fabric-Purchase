"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { usePageSearchInput } from "@/components/experience/CommandProvider";
import { ManageShipmentsModal } from "./ManageShipmentsModal";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fetchAllShipments } from "@/lib/shipments";
import { addCalendarDays, fmtDate, fmtNum } from "@/lib/format";
import type { PurchaseOrder, Shipment } from "@/lib/types";

export function GreyHouseClient({
  initialPos,
  initialShipments,
  isAdmin,
}: {
  initialPos: PurchaseOrder[];
  initialShipments: Shipment[];
  isAdmin: boolean;
}) {
  const { data: pos = [], isFetching: posFetching } = useQuery({
    queryKey: ["purchase_orders"],
    queryFn: fetchPurchaseOrders,
    initialData: initialPos,
  });
  const { data: shipments = [], isFetching: shipFetching } = useQuery({
    queryKey: ["shipments_all"],
    queryFn: fetchAllShipments,
    initialData: initialShipments,
  });
  const isFetching = posFetching || shipFetching;

  const [search, setSearch] = useState("");
  const [managePo, setManagePo] = useState<PurchaseOrder | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);

  const sentMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of shipments) m[s.po_unique_id] = (m[s.po_unique_id] ?? 0) + (s.sent_quantity ?? 0);
    return m;
  }, [shipments]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pos;
    return pos.filter((p) => [p.po_no, p.vendor_name, p.process].some((f) => (f ?? "").toLowerCase().includes(q)));
  }, [pos, search]);

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Grey House Follow Up</h1>
          <p>Sent vs pending grey fabric per PO — log shipments to create lots</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder="Search PO no, vendor, process…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                  <th>Process</th>
                  <th>Order date</th>
                  <th className="num">Total Qty</th>
                  <th className="num">Sent Qty</th>
                  <th className="num">Pending Qty</th>
                  <th>Planned Date</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const ordered = p.quantity ?? 0;
                  const sent = sentMap[p.unique_id] ?? 0;
                  const pending = ordered - sent;
                  return (
                    <tr key={p.id}>
                      <td><span className="strong mono">{p.po_no ?? "—"}</span></td>
                      <td>{p.vendor_name ?? "—"}</td>
                      <td>{p.process ?? "—"}</td>
                      <td><span className="dim">{fmtDate(p.order_date)}</span></td>
                      <td className="num mono">{fmtNum(ordered)}</td>
                      <td className="num mono">{fmtNum(sent)}</td>
                      <td className="num mono">
                        <span className={pending < 0 ? "qty-neg" : pending > 0 ? "qty-warn" : "qty-ok"}>{fmtNum(pending)}</span>
                      </td>
                      <td><span className="dim">{addCalendarDays(p.order_date, p.delivery_days)}</span></td>
                      <td className="col-actions">
                        <button className="act" onClick={() => setManagePo(p)}>
                          <Icon name="truck" size={15} />Manage shipments
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
            <div className="ph-icon"><Icon name="box" size={26} /></div>
            <h3>{pos.length ? "No matching purchase orders" : "No purchase orders yet"}</h3>
            <p>{pos.length ? "Try a different search." : "Create POs first, then log their shipments here."}</p>
          </div>
        )}
      </div>

      {managePo && <ManageShipmentsModal po={managePo} isAdmin={isAdmin} onClose={() => setManagePo(null)} />}
    </>
  );
}
