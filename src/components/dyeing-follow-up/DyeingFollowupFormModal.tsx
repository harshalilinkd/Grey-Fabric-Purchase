"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { DyeingFollowupFormValues } from "@/lib/types";

/** A lot currently at the dyeing house (has a program, not yet QC'd). */
export type DyeingLot = {
  lot_no: string;
  po_unique_id: string | null;
  po_no: string | null;
  vendor: string | null;
  dying_house_name: string | null;
  total_meters: number | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

export function DyeingFollowupFormModal({
  open,
  availableLots,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  availableLots: DyeingLot[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: DyeingFollowupFormValues) => void;
}) {
  const [lotNo, setLotNo] = useState("");
  const [dyeing, setDyeing] = useState("");
  const [remaining, setRemaining] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [remark, setRemark] = useState("");
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    if (open) {
      setLotNo("");
      setDyeing("");
      setRemaining("");
      setNextDate("");
      setRemark("");
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
    if (found) {
      setDyeing(found.dying_house_name ?? "");
      setRemaining(found.total_meters ? String(found.total_meters) : "");
    }
  };

  const submit = () => {
    if (!selectedLot) return;
    onSave({
      lot_no: selectedLot.lot_no,
      po_unique_id: selectedLot.po_unique_id ?? "",
      dying_house_name: dyeing,
      remaining_meters: remaining,
      next_followup_date: nextDate,
      remark,
    });
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Log dyeing follow-up">
        <div className="modal-head">
          <div>
            <h3>Log dyeing follow-up</h3>
            <p>Track a lot still at the dyeing house</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="modal-body">
            <div className="field">
              <label htmlFor="df-lot">Lot</label>
              <select id="df-lot" ref={firstFieldRef} value={lotNo} onChange={(e) => pickLot(e.target.value)}>
                <option value="">{availableLots.length ? "Select a lot…" : "No lots at the dyeing house"}</option>
                {availableLots.map((l) => (
                  <option key={l.lot_no} value={l.lot_no}>
                    {l.lot_no}
                    {l.po_no ? ` · PO ${l.po_no}` : ""}
                    {l.dying_house_name ? ` · ${l.dying_house_name}` : ""}
                    {l.total_meters ? ` · ${fmtNum(l.total_meters)} m` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-row-3">
              <div className="field">
                <label htmlFor="df-house">Dyeing house</label>
                <input id="df-house" value={dyeing} onChange={(e) => setDyeing(e.target.value)} placeholder="e.g. Sunrise Dyeing" />
              </div>
              <div className="field">
                <label htmlFor="df-rem">Remaining metres</label>
                <input id="df-rem" type="number" step="any" value={remaining} onChange={(e) => setRemaining(e.target.value)} placeholder="1200" />
              </div>
              <div className="field">
                <label htmlFor="df-next">Next follow-up date</label>
                <input id="df-next" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} min={todayISO()} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="df-remark">Remark</label>
              <input id="df-remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. promised by Friday" />
            </div>

            <div className="subtle-note">
              <Icon name="info" size={16} />
              <span>Lots with a dyeing program that haven&apos;t passed QC yet appear above. A next date today or earlier is flagged overdue.</span>
            </div>
          </div>

          <div className="modal-foot">
            <span className="amt-preview">
              {selectedLot ? <>PO <b className="mono">{selectedLot.po_no ?? selectedLot.po_unique_id ?? "—"}</b></> : "Select a lot to continue"}
            </span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !selectedLot}>
                {saving ? "Saving…" : "Log follow-up"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
