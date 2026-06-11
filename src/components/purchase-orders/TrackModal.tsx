"use client";

import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { fetchPoProgramCards, fetchPoShipments } from "@/lib/purchase-orders";
import { fmtDate, fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PurchaseOrder } from "@/lib/types";

export function TrackModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const shipmentsQ = useQuery({
    queryKey: ["po-shipments", po.unique_id],
    queryFn: () => fetchPoShipments(po.unique_id),
  });
  const programsQ = useQuery({
    queryKey: ["po-programs", po.unique_id],
    queryFn: () => fetchPoProgramCards(po.unique_id),
  });

  const shipments = shipmentsQ.data ?? [];
  const programs = programsQ.data ?? [];
  const ordered = po.quantity ?? 0;
  const received = shipments.reduce((sum, s) => sum + (s.sent_quantity ?? 0), 0);
  const pct = ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
  const fullyReceived = ordered > 0 && received >= ordered;
  const loading = shipmentsQ.isLoading || programsQ.isLoading;
  const errored = shipmentsQ.isError || programsQ.isError;

  useEscClose(true, onClose);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Purchase order lifecycle">
        <div className="modal-head">
          <div>
            <h3>PO <span className="mono">{po.po_no ?? po.unique_id}</span> — lifecycle</h3>
            <p>{po.vendor_name ?? "—"}{po.quality ? ` · ${po.quality}` : ""}</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="track-loading">
              <div className="skeleton" style={{ height: 60 }} />
              <div className="skeleton" style={{ height: 60 }} />
              <div className="skeleton" style={{ height: 60 }} />
            </div>
          ) : errored ? (
            <div className="empty"><p>Couldn&apos;t load the lifecycle. Please try again.</p></div>
          ) : (
            <div className="track">
              <div className="tnode done">
                <div className="tdot"><Icon name="check" size={14} /></div>
                <div className="tbody">
                  <div className="ttitle">PO created</div>
                  <div className="tmeta">
                    <span className="mono">{fmtNum(ordered)}</span> m ordered{po.order_date ? ` · ${fmtDate(po.order_date)}` : ""}
                  </div>
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

              <div className={`tnode ${fullyReceived && programs.length > 0 ? "active" : ""}`}>
                <div className="tdot"><span className="tnum">4</span></div>
                <div className="tbody">
                  <div className="ttitle">Final</div>
                  <div className="tmeta">
                    {fullyReceived ? "All ordered fabric received." : "Awaiting full receipt."}
                    {programs.length > 0 ? <>{" "}<span className="mono">{programs.length}</span> program{programs.length === 1 ? "" : "s"} running.</> : ""}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
