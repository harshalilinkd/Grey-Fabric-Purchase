"use client";

import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { fetchPoProgramCards, fetchPoShipments, fetchPoStock } from "@/lib/purchase-orders";
import { CHECKS_METHOD_LABEL, DIRECT_SUBTYPE_LABEL, isFinishedGoodsPo, sourcingLabel } from "@/lib/po-meta";
import { addCalendarDays, fmtAmount, fmtDate, fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PurchaseOrder } from "@/lib/types";

export function TrackModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const finished = isFinishedGoodsPo(po);
  const shipmentsQ = useQuery({ queryKey: ["po-shipments", po.unique_id], queryFn: () => fetchPoShipments(po.unique_id), enabled: !finished });
  const programsQ = useQuery({ queryKey: ["po-programs", po.unique_id], queryFn: () => fetchPoProgramCards(po.unique_id), enabled: !finished });
  const stockQ = useQuery({ queryKey: ["po-stock", po.unique_id], queryFn: () => fetchPoStock(po.unique_id), enabled: finished });

  const shipments = shipmentsQ.data ?? [];
  const programs = programsQ.data ?? [];
  const stock = stockQ.data ?? [];
  const ordered = po.quantity ?? 0;
  const received = shipments.reduce((sum, s) => sum + (s.sent_quantity ?? 0), 0);
  const pct = ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
  const fullyReceived = ordered > 0 && received >= ordered;
  const stocked = stock.reduce((sum, w) => sum + (w.passed_qty ?? 0), 0);
  const stockPct = ordered > 0 ? Math.min(100, Math.round((stocked / ordered) * 100)) : stocked > 0 ? 100 : 0;
  const fullyStocked = ordered > 0 && stocked >= ordered;
  // A PO stays open until everything received against it equals its quantity.
  const isClosed = finished ? fullyStocked : fullyReceived;
  const loading = finished ? stockQ.isLoading : shipmentsQ.isLoading || programsQ.isLoading;
  const errored = finished ? stockQ.isError : shipmentsQ.isError || programsQ.isError;

  useEscClose(true, onClose);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Purchase order details">
        <div className="modal-head">
          <div>
            <h3>PO <span className="mono">{po.po_no ?? po.unique_id}</span></h3>
            <p>{po.vendor_name ?? "—"}{po.quality ? ` · ${po.quality}` : ""}</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="modal-body">
          {/* metadata */}
          <div className="sum-title" style={{ marginTop: 0 }}>Order details</div>
          <div className="sum">
            <div className="sum-row"><span>Source</span><b>{sourcingLabel(po.sourcing_path)}</b></div>
            <div className="sum-row"><span>Quality</span><b>{po.quality ?? "—"}</b></div>
            <div className="sum-row"><span>Process</span><b>{po.process ?? "—"}</b></div>
            {po.sourcing_path === "checks_weaves" && (
              <>
                <div className="sum-row"><span>Checks route</span><b>{po.checks_method ? CHECKS_METHOD_LABEL[po.checks_method] ?? po.checks_method : "—"}</b></div>
                {po.cad_ref && <div className="sum-row"><span>CAD ref</span><b className="mono">{po.cad_ref}</b></div>}
                {po.handloom_ref && <div className="sum-row"><span>Handloom ref</span><b className="mono">{po.handloom_ref}</b></div>}
                {po.weaving_design && <div className="sum-row"><span>Weaving &amp; design</span><b>{po.weaving_design}</b></div>}
              </>
            )}
            {po.sourcing_path === "direct_purchase" && po.direct_subtype && (
              <div className="sum-row"><span>Cloth type</span><b>{DIRECT_SUBTYPE_LABEL[po.direct_subtype] ?? po.direct_subtype}</b></div>
            )}
            {!finished && <div className="sum-row"><span>Dyeing house</span><b>{po.dying_house_name ?? "—"}</b></div>}
            <div className="sum-row"><span>Order no</span><b className="mono">{po.order_no ?? "—"}</b></div>
            <div className="sum-row"><span>Delivery days</span><b className="mono">{po.delivery_days ?? "—"}</b></div>
            <div className="sum-row">
              <span>{finished ? "Planned arrival" : "Planned grey arrival"}</span>
              <b className="mono">{addCalendarDays(po.order_date, po.delivery_days)}</b>
            </div>
            <div className="sum-row"><span>Ordered</span><b className="mono">{fmtNum(ordered)} m · {fmtAmount(po.amount)}</b></div>
            <div className="sum-row">
              <span>Status</span>
              <b><span className={`pill ${isClosed ? "success" : "info"}`}>{isClosed ? "Closed" : "Open"}</span></b>
            </div>
          </div>

          {/* lifecycle */}
          <div className="sum-title">Lifecycle</div>
          {loading ? (
            <div className="track-loading">
              <div className="skeleton" style={{ height: 60 }} />
              <div className="skeleton" style={{ height: 60 }} />
            </div>
          ) : errored ? (
            <p className="muted-note">Couldn&apos;t load the lifecycle. Please try again.</p>
          ) : finished ? (
            <div className="track">
              <div className="tnode done">
                <div className="tdot"><Icon name="check" size={14} /></div>
                <div className="tbody">
                  <div className="ttitle">PO created</div>
                  <div className="tmeta"><span className="mono">{fmtNum(ordered)}</span> m ordered{po.order_date ? ` · ${fmtDate(po.order_date)}` : ""}</div>
                </div>
              </div>

              <div className={`tnode ${stocked > 0 ? (fullyStocked ? "done" : "active") : ""}`}>
                <div className="tdot">{fullyStocked ? <Icon name="check" size={14} /> : <span className="tnum">2</span>}</div>
                <div className="tbody">
                  <div className="ttitle">Received &amp; QC&apos;d into stock</div>
                  <div className="tbar"><div className="tbar-fill" style={{ width: `${stockPct}%` }} /></div>
                  <div className="tmeta">
                    <span className="mono">{fmtNum(stocked)}</span> / <span className="mono">{fmtNum(ordered)}</span> m QC-passed &amp; stored as Ready Goods
                  </div>
                  {stock.length > 0 ? (
                    <div className="tlist">
                      {stock.map((w) => (
                        <div className="tli" key={w.id}>
                          <span className="pill success mono">{fmtNum(w.passed_qty)} m</span>
                          <span className="tdim">{fmtDate(w.stored_date)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="tmeta">Not received yet — use the “Receive &amp; QC” action on the PO row.</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="track">
              <div className="tnode done">
                <div className="tdot"><Icon name="check" size={14} /></div>
                <div className="tbody">
                  <div className="ttitle">PO created</div>
                  <div className="tmeta"><span className="mono">{fmtNum(ordered)}</span> m ordered{po.order_date ? ` · ${fmtDate(po.order_date)}` : ""}</div>
                </div>
              </div>

              <div className={`tnode ${received > 0 ? (fullyReceived ? "done" : "active") : ""}`}>
                <div className="tdot">{fullyReceived ? <Icon name="check" size={14} /> : <span className="tnum">2</span>}</div>
                <div className="tbody">
                  <div className="ttitle">Fabric received from vendor</div>
                  <div className="tbar"><div className="tbar-fill" style={{ width: `${pct}%` }} /></div>
                  <div className="tmeta">
                    <span className="mono">{fmtNum(received)}</span> / <span className="mono">{fmtNum(ordered)}</span> m · <span className="mono">{shipments.length}</span> lot{shipments.length === 1 ? "" : "s"}
                  </div>
                  {shipments.length > 0 && (
                    <div className="tlist">
                      {shipments.map((s) => (
                        <div className="tli" key={s.id}>
                          <span className="pill info mono">{s.lot_no ?? "Lot —"}</span>
                          <span className="mono">{fmtNum(s.sent_quantity)} m</span>
                          <span className="tdim">{fmtDate(s.shipment_date)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={`tnode ${programs.length > 0 ? "active" : ""}`}>
                <div className="tdot"><span className="tnum">3</span></div>
                <div className="tbody">
                  <div className="ttitle">Dyeing program status</div>
                  {programs.length > 0 ? (
                    <div className="tlist">
                      {programs.map((p) => (
                        <div className="tli" key={p.id}>
                          <span className="pill brand mono">{p.program_uid}</span>
                          <span className="tdim">{p.lot_no ?? "—"}</span>
                          <span className="tdim">{p.dying_house_name ?? "House —"}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="tmeta">No dyeing programs yet.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
