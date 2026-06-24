"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { fetchArchivedPos } from "@/lib/purchase-orders";
import { fmtDate } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PurchaseOrder } from "@/lib/types";

/**
 * Super-admin Archived view: restore any archived PO (brings back the whole linked graph),
 * plus a bulk "archive by period" tool that archives every visible PO ordered within a date
 * range. Both go through the same reversible set_po_archived RPC in the parent.
 */
export function ArchivedPosModal({
  pos,
  restoringId,
  archivingPeriod,
  onRestore,
  onArchivePeriod,
  onClose,
}: {
  pos: PurchaseOrder[];
  restoringId: string | null;
  archivingPeriod: boolean;
  onRestore: (po: PurchaseOrder) => void;
  onArchivePeriod: (uids: string[]) => void;
  onClose: () => void;
}) {
  const archivedQ = useQuery({ queryKey: ["archived-pos"], queryFn: fetchArchivedPos });
  const archived = archivedQ.data ?? [];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [armed, setArmed] = useState(false);
  useEscClose(true, onClose);

  const inRange = useMemo(
    () =>
      pos.filter((p) => {
        if (!p.order_date) return false;
        if (from && p.order_date < from) return false;
        if (to && p.order_date > to) return false;
        return true;
      }),
    [pos, from, to],
  );

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Archived purchase orders">
        <div className="modal-head">
          <div>
            <h3>Archived purchase orders</h3>
            <p>Hidden from every screen — restore to bring a PO and all its data back.</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="modal-body">
          {/* Bulk archive by period */}
          <div className="sum-title" style={{ marginTop: 0 }}>Archive by period</div>
          <div className="field-row-3">
            <div className="field"><label htmlFor="arch-from">From</label><input id="arch-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setArmed(false); }} /></div>
            <div className="field"><label htmlFor="arch-to">To</label><input id="arch-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setArmed(false); }} /></div>
            <div className="field" style={{ alignSelf: "end" }}>
              {!armed ? (
                <button type="button" className="btn btn-ghost" disabled={!inRange.length} onClick={() => setArmed(true)}>
                  <Icon name="box" size={15} />Archive {inRange.length} PO{inRange.length === 1 ? "" : "s"}
                </button>
              ) : (
                <button type="button" className="btn btn-danger" disabled={archivingPeriod} onClick={() => onArchivePeriod(inRange.map((p) => p.unique_id))}>
                  {archivingPeriod ? "Archiving…" : `Confirm — archive ${inRange.length}`}
                </button>
              )}
            </div>
          </div>
          <p className="path-blurb">Archives every PO ordered in the range (and all its linked data). Reversible below.</p>

          {/* Archived list */}
          <div className="sum-title">Archived ({archived.length})</div>
          {archivedQ.isLoading ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : archivedQ.isError ? (
            <p className="muted-note">Couldn&apos;t load archived POs — please retry.</p>
          ) : archived.length > 0 ? (
            <table className="mini-table">
              <thead><tr><th>PO No</th><th>Vendor</th><th>Order date</th><th /></tr></thead>
              <tbody>
                {archived.map((p) => (
                  <tr key={p.id}>
                    <td className="mono strong">{p.po_no ?? p.unique_id}</td>
                    <td>{p.vendor_name ?? "—"}</td>
                    <td>{fmtDate(p.order_date)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="act" disabled={restoringId === p.unique_id} onClick={() => onRestore(p)}>
                        <Icon name="refresh" size={14} />{restoringId === p.unique_id ? "Restoring…" : "Restore"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted-note">No archived purchase orders.</p>
          )}
        </div>

        <div className="modal-foot">
          <span />
          <div className="foot-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
