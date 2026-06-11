"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { fmtAmount, fmtDate, fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PurchaseOrder, ReissueReturn, ReissueStatus } from "@/lib/types";

/** Pill tone per reissue status. */
export function statusPillClass(status: ReissueStatus | string): string {
  switch (status) {
    case "Reissue Pending":
      return "warning";
    case "Pending Assignment":
      return "info";
    case "Returned":
      return "plain";
    default:
      return "plain";
  }
}

export function ReissueDetailModal({
  row,
  po,
  saving,
  onAssign,
  onReturned,
  onClose,
}: {
  row: ReissueReturn;
  po: PurchaseOrder | undefined;
  saving: boolean;
  onAssign: (newLot: string) => void;
  onReturned: () => void;
  onClose: () => void;
}) {
  const [newLot, setNewLot] = useState(row.new_lot_no ?? "");

  useEscClose(true, onClose);

  const isReturned = row.status === "Returned";

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Reissue ${row.reissue_id}`}>
        <div className="modal-head">
          <div>
            <h3>Reissue / Return</h3>
            <p>
              Lot <span className="mono">{row.original_lot_no ?? "—"}</span> · Design{" "}
              <span className="mono">{row.original_design_no ?? "—"}</span>
            </p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="modal-body">
          <div className="sum-title">Original PO information</div>
          <div className="sum">
            <div className="sum-row"><span>PO No</span><b className="mono">{po?.po_no ?? "—"}</b></div>
            <div className="sum-row"><span>Vendor</span><b>{po?.vendor_name ?? "—"}</b></div>
            <div className="sum-row"><span>Quality</span><b>{po?.quality ?? "—"}</b></div>
            <div className="sum-row"><span>Rate</span><b className="mono">{po?.rate == null ? "—" : fmtAmount(po.rate)}</b></div>
          </div>

          <div className="sum-title">Failure &amp; reissue details</div>
          <div className="hl-metric">
            <span>Failed quantity</span>
            <b className="mono">{row.reissue_qty == null ? "—" : `${fmtNum(row.reissue_qty)} m`}</b>
          </div>
          <div className="sum">
            <div className="sum-row"><span>Original Lot No</span><b className="mono">{row.original_lot_no ?? "—"}</b></div>
            <div className="sum-row"><span>Original Design No</span><b className="mono">{row.original_design_no ?? "—"}</b></div>
            <div className="sum-row"><span>Reason</span><b>{row.reason ?? "—"}</b></div>
            <div className="sum-row"><span>Reissue date</span><b>{fmtDate(row.reissue_date)}</b></div>
            <div className="sum-row">
              <span>Current status</span>
              <b><span className={`pill ${statusPillClass(row.status)}`}>{row.status}</span></b>
            </div>
            <div className="sum-row">
              <span>New Lot No</span>
              {row.new_lot_no ? (
                <b className="mono">{row.new_lot_no}</b>
              ) : (
                <b className="muted-note" style={{ padding: 0 }}>Yet to be generated</b>
              )}
            </div>
          </div>

          <div className="reissue-actions">
            {isReturned ? (
              <p className="muted-note" style={{ padding: 0 }}>
                This item has been returned — no further action.
              </p>
            ) : (
              <>
                <div className="sum-title">Assign new lot</div>
                <div className="field" style={{ marginBottom: 10 }}>
                  <label htmlFor="rr-lot">New lot no</label>
                  <input
                    id="rr-lot"
                    value={newLot}
                    onChange={(e) => setNewLot(e.target.value)}
                    placeholder="e.g. Lot 24-R"
                  />
                </div>
                <div className="foot-actions">
                  <button className="btn btn-ghost" disabled={saving} onClick={onReturned}>
                    Mark as Returned
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={saving || !newLot.trim()}
                    onClick={() => onAssign(newLot.trim())}
                  >
                    {saving ? "Saving…" : "Assign lot & reissue"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <span />
          <div className="foot-actions">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
