"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { ProgramCardDesignInput, ProgramCardFormValues } from "@/lib/types";

/** A lot that has a shipment but no program card yet — offered in the lot dropdown. */
export type AvailableLot = {
  lot_no: string;
  po_unique_id: string;
  po_no: string | null;
  vendor: string | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const emptyDesign = (): ProgramCardDesignInput => ({ design_no: "", color: "", meter: "" });

export function ProgramCardFormModal({
  open,
  availableLots,
  nextProgramId,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  availableLots: AvailableLot[];
  nextProgramId: string;
  saving: boolean;
  onClose: () => void;
  onSave: (values: ProgramCardFormValues, file: File | null) => void;
}) {
  const [lotNo, setLotNo] = useState("");
  const [dyeing, setDyeing] = useState("");
  const [programDate, setProgramDate] = useState(todayISO());
  const [totalMeters, setTotalMeters] = useState("");
  const [designs, setDesigns] = useState<ProgramCardDesignInput[]>([emptyDesign()]);
  const [file, setFile] = useState<File | null>(null);

  // Fresh form every time it opens.
  useEffect(() => {
    if (open) {
      setLotNo("");
      setDyeing("");
      setProgramDate(todayISO());
      setTotalMeters("");
      setDesigns([emptyDesign()]);
      setFile(null);
    }
  }, [open]);

  useEscClose(open, onClose);

  const selectedLot = useMemo(
    () => availableLots.find((l) => l.lot_no === lotNo) ?? null,
    [availableLots, lotNo],
  );

  const cuttingTotal = useMemo(
    () => designs.reduce((s, d) => s + (Number(d.meter) || 0), 0),
    [designs],
  );

  if (!open) return null;

  const setDesign = (i: number, key: keyof ProgramCardDesignInput) => (e: ChangeEvent<HTMLInputElement>) =>
    setDesigns((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: e.target.value } : r)));

  const addDesign = () => setDesigns((rows) => [...rows, emptyDesign()]);
  const removeDesign = (i: number) =>
    setDesigns((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null);

  const canSave = !!selectedLot && !saving;

  const submit = () => {
    if (!selectedLot) return;
    onSave(
      {
        lot_no: selectedLot.lot_no,
        po_unique_id: selectedLot.po_unique_id,
        dying_house_name: dyeing,
        program_date: programDate,
        total_meters: totalMeters,
        designs,
      },
      file,
    );
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="New program card">
        <div className="modal-head">
          <div>
            <h3>New program card</h3>
            <p>Program ID assigned on save — next is <span className="mono">{nextProgramId}</span></p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="modal-body">
            <div className="field-row-3">
              <div className="field">
                <label htmlFor="pc-lot">Lot</label>
                <select id="pc-lot" value={lotNo} onChange={(e) => setLotNo(e.target.value)}>
                  <option value="">
                    {availableLots.length ? "Select a lot…" : "No lots awaiting a program"}
                  </option>
                  {availableLots.map((l) => (
                    <option key={l.lot_no} value={l.lot_no}>
                      {l.lot_no}
                      {l.po_no ? ` · PO ${l.po_no}` : ""}
                      {l.vendor ? ` · ${l.vendor}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pc-dye">Dyeing house</label>
                <input id="pc-dye" value={dyeing} onChange={(e) => setDyeing(e.target.value)} placeholder="e.g. Sunrise Dyeing" />
              </div>
              <div className="field">
                <label htmlFor="pc-date">Program date</label>
                <input id="pc-date" type="date" value={programDate} onChange={(e) => setProgramDate(e.target.value)} />
              </div>
            </div>

            <div className="field-row-3">
              <div className="field">
                <label htmlFor="pc-meters">Total meters</label>
                <input id="pc-meters" type="number" step="any" value={totalMeters} onChange={(e) => setTotalMeters(e.target.value)} placeholder="2400" />
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label htmlFor="pc-pdf">Colour cutting (PDF)</label>
                <input id="pc-pdf" type="file" accept="application/pdf" onChange={onPickFile} />
              </div>
            </div>

            <div className="designs-head">
              <span className="sum-title" style={{ margin: 0 }}>Design cuttings</span>
              <span className="cut-total">Cuttings total: <b className="mono">{fmtNum(cuttingTotal)}</b> m</span>
            </div>

            <div className="designs">
              <div className="design-row design-row-head" aria-hidden="true">
                <span>Design no</span><span>Colour</span><span>Meters</span><span />
              </div>
              {designs.map((d, i) => (
                <div className="design-row" key={i}>
                  <input className="di" value={d.design_no} onChange={setDesign(i, "design_no")} placeholder="D-101" aria-label={`Design no ${i + 1}`} />
                  <input className="di" value={d.color} onChange={setDesign(i, "color")} placeholder="Navy" aria-label={`Colour ${i + 1}`} />
                  <input className="di" type="number" step="any" value={d.meter} onChange={setDesign(i, "meter")} placeholder="800" aria-label={`Meters ${i + 1}`} />
                  <button
                    type="button"
                    className="mini-act danger"
                    onClick={() => removeDesign(i)}
                    disabled={designs.length === 1}
                    aria-label={`Remove cutting ${i + 1}`}
                    title={designs.length === 1 ? "Keep at least one row" : "Remove cutting"}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>

            <button type="button" className="act add-design" onClick={addDesign}>
              <Icon name="plus" size={15} />Add another cutting
            </button>

            <div className="subtle-note">
              <Icon name="info" size={16} />
              <span>The Program ID is assigned automatically. Choosing a lot links this program to its PO; the lot then leaves the &ldquo;pending&rdquo; queue.</span>
            </div>
          </div>

          <div className="modal-foot">
            <span className="amt-preview">
              {selectedLot ? <>PO <b className="mono">{selectedLot.po_no ?? selectedLot.po_unique_id}</b></> : "Select a lot to continue"}
            </span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!canSave}>
                {saving ? "Saving…" : "Create program"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
