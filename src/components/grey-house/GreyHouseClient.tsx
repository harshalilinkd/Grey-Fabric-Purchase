"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { usePagePrimaryAction, usePageSearchInput } from "@/components/experience/CommandProvider";
import { ManageShipmentsModal } from "./ManageShipmentsModal";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { isFinishedGoodsPo } from "@/lib/po-meta";
import { fetchAllShipments } from "@/lib/shipments";
import { addCalendarDays, fmtDate, fmtNum } from "@/lib/format";
import type { PurchaseOrder, Shipment } from "@/lib/types";

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Expected grey-arrival ISO date = order_date + delivery_days (for the overdue flag). */
function expectedGreyISO(order_date: string | null, delivery_days: number | null): string | null {
  if (!order_date || delivery_days == null) return null;
  const d = new Date(order_date);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + delivery_days);
  return d.toISOString().slice(0, 10);
}

export function GreyHouseClient({
  initialPos,
  initialShipments,
  isAdmin,
}: {
  initialPos: PurchaseOrder[];
  initialShipments: Shipment[];
  isAdmin: boolean;
}) {
  const { data: pos = [], isFetching: posFetching } = useQuery({ queryKey: ["purchase_orders"], queryFn: fetchPurchaseOrders, initialData: initialPos });
  const { data: shipments = [], isFetching: shipFetching } = useQuery({ queryKey: ["shipments_all"], queryFn: fetchAllShipments, initialData: initialShipments });
  const isFetching = posFetching || shipFetching;

  const [search, setSearch] = useState("");
  const [managePo, setManagePo] = useState<PurchaseOrder | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  usePagePrimaryAction("Log grey receipt", openPicker);

  const today = todayISO();

  const sentMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of shipments) m[s.po_unique_id] = (m[s.po_unique_id] ?? 0) + (s.sent_quantity ?? 0);
    return m;
  }, [shipments]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Finished-goods paths (direct purchase / imported) skip grey-house + dyeing —
    // they're bought ready, so they don't get a grey receipt here.
    let list = pos
      .filter((p) => !isFinishedGoodsPo(p))
      .map((p) => {
      const ordered = p.quantity ?? 0;
      const sent = sentMap[p.unique_id] ?? 0;
      const pending = ordered - sent;
      const plannedISO = expectedGreyISO(p.order_date, p.delivery_days);
      const overdue = pending > 0 && !!plannedISO && plannedISO <= today;
      const pct = ordered > 0 ? Math.max(0, Math.min(100, (sent / ordered) * 100)) : sent > 0 ? 100 : 0;
      return { po: p, ordered, sent, pending, overdue, pct };
    });
    if (q) list = list.filter((r) => [r.po.po_no, r.po.vendor_name, r.po.process].some((f) => (f ?? "").toLowerCase().includes(q)));
    // overdue first, then soonest planned date (overdue rows surface to the top)
    return list.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      const ad = expectedGreyISO(a.po.order_date, a.po.delivery_days) ?? "9999-99-99";
      const bd = expectedGreyISO(b.po.order_date, b.po.delivery_days) ?? "9999-99-99";
      return ad.localeCompare(bd);
    });
  }, [pos, search, sentMap, today]);

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Grey House Follow Up</h1>
          <p>Sent vs pending grey fabric per PO — log shipments to create lots</p>
        </div>
        <button className="btn btn-primary" onClick={openPicker}>
          <Icon name="truck" size={15} />Log grey receipt
        </button>
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
                  <th className="num">Total Qty</th>
                  <th className="num">Sent Qty</th>
                  <th className="num">Pending Qty</th>
                  <th>Progress</th>
                  <th>Planned Date</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.po.id}>
                    <td><span className="strong mono">{r.po.po_no ?? "—"}</span></td>
                    <td>{r.po.vendor_name ?? "—"}</td>
                    <td>{r.po.process ?? "—"}</td>
                    <td className="num mono">{fmtNum(r.ordered)}</td>
                    <td className="num mono">{fmtNum(r.sent)}</td>
                    <td className="num mono">
                      <span className={r.pending < 0 ? "qty-neg" : r.pending > 0 ? "qty-warn" : "qty-ok"}>{fmtNum(r.pending)}</span>
                    </td>
                    <td style={{ minWidth: 96 }}>
                      <div className="tbar"><div className="tbar-fill" style={{ width: `${r.pct}%` }} /></div>
                    </td>
                    <td>
                      {r.overdue
                        ? <span className="pill danger">Overdue · {addCalendarDays(r.po.order_date, r.po.delivery_days)}</span>
                        : <span className="dim">{addCalendarDays(r.po.order_date, r.po.delivery_days)}</span>}
                    </td>
                    <td className="col-actions">
                      <button className="act" onClick={() => setManagePo(r.po)}>
                        <Icon name="truck" size={15} />Manage shipments
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="ph-icon"><Icon name="box" size={26} /></div>
            <h3>{pos.length ? "No matching purchase orders" : "No purchase orders yet"}</h3>
            <p>{pos.length ? "Try a different search." : "Create POs first, then log their shipments here."}</p>
            {!pos.length && (
              <Link className="btn btn-primary" href="/purchase-orders"><Icon name="plus" />Create a PO</Link>
            )}
          </div>
        )}
      </div>

      {managePo && <ManageShipmentsModal po={managePo} isAdmin={isAdmin} onClose={() => setManagePo(null)} />}

      {pickerOpen && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setPickerOpen(false)}>
          <div className="modal sm" role="dialog" aria-modal="true" aria-label="Log grey receipt">
            <div className="modal-head">
              <div>
                <h3>Log grey receipt</h3>
                <p>Pick a PO to log a shipment</p>
              </div>
              <button className="close-x" onClick={() => setPickerOpen(false)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label htmlFor="gr-po">Purchase order</label>
                <select
                  id="gr-po"
                  defaultValue=""
                  onChange={(e) => {
                    const po = pos.find((p) => p.id === e.target.value);
                    if (po) { setManagePo(po); setPickerOpen(false); }
                  }}
                >
                  <option value="">{pos.length ? "Select a PO…" : "No purchase orders yet"}</option>
                  {pos.filter((p) => !isFinishedGoodsPo(p)).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.po_no ?? p.unique_id}{p.vendor_name ? ` · ${p.vendor_name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
