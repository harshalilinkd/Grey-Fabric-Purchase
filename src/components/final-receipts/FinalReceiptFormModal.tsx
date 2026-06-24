"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { FinalReceiptFormValues, FinalReceiptStatus } from "@/lib/types";

/** A QC-passed lot eligible for a final receipt (in the warehouse, not yet closed). */
export type FinalLot = {
  lot_no: string;
  po_unique_id: string | null;
  po_no: string | null;
  vendor: string | null;
  quality_name: string | null;
  storedMeters: number;
};

const STATUSES: FinalReceiptStatus[] = ["Closed", "Partial", "On Hold"];
const todayISO = () => new Date().toISOString().slice(0, 10);

export function FinalReceiptFormModal({
  open,
  availableLots,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  availableLots: FinalLot[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: FinalReceiptFormValues) => void;
}) {
  const [lotNo, setLotNo] = useState("");
  const [finalQty, setFinalQty] = useState("");
  const [status, setStatus] = useState<FinalReceiptStatus>("Closed");
  const [remark, setRemark] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayISO());
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    if (open) {
      setLotNo("");
      setFinalQty("");
      setStatus("Closed");
      setRemark("");
      setReceivedDate(todayISO());
      const id = requestAnimationFrame(() => firstFieldRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  useEscClose(open, onClose);

  if (!open) return null;

  const selectedLot = availableLots.find((l) => l.lot_no === lotNo) ?? null;

  const pickLot = (lot: string) => {
    setLotNo(lot);
    const found = availableLots.find((l) => l.lot_no === lot);
    // default the final good metres to the lot's stored (QC-passed) metres
    if (found) setFinalQty(found.storedMeters ? String(found.storedMeters) : "");
  };

  const submit = () => {
    if (!selectedLot) return;
    onSave({
      lot_no: selectedLot.lot_no,
      po_unique_id: selectedLot.po_unique_id ?? "",
      final_qty: finalQty,
      status,
      remark,
      received_date: receivedDate,
    });
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Record final receipt">
        <div className="modal-head">
          <div>
            <h3>Record final receipt</h3>
            <p>Close a lot with its final confirmed good quantity</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="modal-body">
            <div className="field">
              <label htmlFor="fr-lot">Lot</label>
              <select id="fr-lot" ref={firstFieldRef} value={lotNo} onChange={(e) => pickLot(e.target.value)}>
                <option value="">{availableLots.length ? "Select a lot…" : "No lots awaiting a final receipt"}</option>
                {availableLots.map((l) => (
                  <option key={l.lot_no} value={l.lot_no}>
                    {l.lot_no}
                    {l.po_no ? ` · PO ${l.po_no}` : ""}
                    {l.quality_name ? ` · ${l.quality_name}` : ""}
                    {l.storedMeters ? ` · ${fmtNum(l.storedMeters)} m stored` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-row-3">
              <div className="field">
                <label htmlFor="fr-qty">Final good metres</label>
                <input id="fr-qty" type="number" step="any" value={finalQty} onChange={(e) => setFinalQty(e.target.value)} placeholder="2400" />
              </div>
              <div className="field">
                <label htmlFor="fr-status">Status</label>
                <select id="fr-status" value={status} onChange={(e) => setStatus(e.target.value as FinalReceiptStatus)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fr-date">Received date</label>
                <input id="fr-date" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="fr-remark">Remark</label>
              <input id="fr-remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional note" />
            </div>

            <div className="subtle-note">
              <Icon name="info" size={16} />
              <span>Lots that have passed QC (Ready Goods) and aren&apos;t yet closed appear above. Recording a receipt closes the lot.</span>
            </div>
          </div>

          <div className="modal-foot">
            <span className="amt-preview">
              {selectedLot ? <>PO <b className="mono">{selectedLot.po_no ?? selectedLot.po_unique_id ?? "—"}</b></> : "Select a lot to continue"}
            </span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !selectedLot}>
                {saving ? "Saving…" : "Record receipt"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
