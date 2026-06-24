"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { previewPoArchive } from "@/lib/purchase-orders";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PoLinkCounts, PurchaseOrder } from "@/lib/types";

const LABELS: [keyof PoLinkCounts, string][] = [
  ["shipments", "Shipments / lots"],
  ["programs", "Program cards"],
  ["qc", "QC inspections"],
  ["warehouse", "Warehouse (ready goods)"],
  ["reissue", "Reissue / return"],
  ["final_receipts", "Final receipts"],
  ["dyeing_followups", "Dyeing follow-ups"],
  ["fabric_receipts", "Fabric receipts"],
];

/**
 * Super-admin confirm for archiving a PO + everything linked to it. Previews the exact
 * linked-row counts, and requires typing the PO number — archive is reversible (Restore from
 * the Archived view), but it still removes a lot from view, so we gate it deliberately.
 */
export function ArchiveConfirmModal({
  po,
  saving,
  onClose,
  onConfirm,
}: {
  po: PurchaseOrder;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const code = String(po.po_no ?? po.unique_id);
  const [typed, setTyped] = useState("");
  const countsQ = useQuery({ queryKey: ["po-archive-preview", po.unique_id], queryFn: () => previewPoArchive(po.unique_id) });
  useEscClose(true, onClose);

  const counts = countsQ.data;
  const total = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : 0;
  const confirmed = typed.trim() === code.trim();

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sm" role="dialog" aria-modal="true" aria-label="Archive purchase order">
        <div className="modal-head">
          <div>
            <h3>Archive PO + all linked data?</h3>
            <p>PO <span className="mono">{code}</span> · {po.vendor_name ?? "—"}</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="modal-body">
          <div className="subtle-note">
            <Icon name="info" size={16} />
            <span>Hides the PO and everything linked to it from every screen. <b>Reversible</b> — restore any time from the Archived view.</span>
          </div>

          <div className="sum" style={{ marginTop: 14 }}>
            {countsQ.isLoading ? (
              <div className="skeleton" style={{ height: 130 }} />
            ) : countsQ.isError ? (
              <p className="muted-note">Couldn&apos;t load the linked records — please retry.</p>
            ) : (
              LABELS.map(([k, label]) => (
                <div className="sum-row" key={k}><span>{label}</span><b className="mono">{fmtNum(counts?.[k] ?? 0)}</b></div>
              ))
            )}
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="arch-confirm">Type <span className="mono">{code}</span> to confirm</label>
            <input id="arch-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={code} autoComplete="off" />
          </div>
        </div>

        <div className="modal-foot">
          <span className="amt-preview">{total} linked record{total === 1 ? "" : "s"}</span>
          <div className="foot-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-danger" disabled={saving || !confirmed} onClick={onConfirm}>
              {saving ? "Archiving…" : "Archive"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
