"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { fetchProgramCardDesigns } from "@/lib/program-cards";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { FabricReceiptDesignInput, FabricReceiptFormValues } from "@/lib/types";

/** A lot whose dyed fabric can be received back (has a program, not yet QC'd). */
export type FabricLot = {
  lot_no: string;
  po_unique_id: string | null;
  po_no: string | null;
  vendor: string | null;
  program_id: string | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

function diffLabel(received: string, programmed: number | null): { cls: string; text: string } | null {
  if (received.trim() === "" || programmed == null) return null;
  const r = Number(received);
  if (!Number.isFinite(r)) return null;
  const d = Math.round((r - programmed) * 100) / 100;
  if (d === 0) return { cls: "ok", text: "matched" };
  if (d < 0) return { cls: "warn", text: `short ${fmtNum(Math.abs(d))}` };
  return { cls: "ok", text: `over ${fmtNum(d)}` };
}

export function FabricReceiptFormModal({
  open,
  availableLots,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  availableLots: FabricLot[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: FabricReceiptFormValues) => void;
}) {
  const [lotNo, setLotNo] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayISO());
  const [remark, setRemark] = useState("");
  const [designs, setDesigns] = useState<FabricReceiptDesignInput[]>([]);
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);
  const seededProgramId = useRef<string | null>(null);

  const selectedLot = useMemo(() => availableLots.find((l) => l.lot_no === lotNo) ?? null, [availableLots, lotNo]);

  const designsQ = useQuery({
    queryKey: ["program-card-designs", selectedLot?.program_id],
    queryFn: () => fetchProgramCardDesigns(selectedLot!.program_id!),
    enabled: open && !!selectedLot?.program_id,
  });

  useEffect(() => {
    if (open) {
      setLotNo("");
      setReceivedDate(todayISO());
      setRemark("");
      setDesigns([]);
      seededProgramId.current = null;
      const id = requestAnimationFrame(() => firstFieldRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  // Seed the design rows once per program (default received = programmed metre).
  useEffect(() => {
    const pid = selectedLot?.program_id ?? null;
    if (open && pid && designsQ.data && seededProgramId.current !== pid) {
      setDesigns(designsQ.data.map((d) => ({ design_no: d.design_no ?? "", color: d.color ?? "", programmed: d.meter, received: d.meter != null ? String(d.meter) : "" })));
      seededProgramId.current = pid;
    }
  }, [open, selectedLot, designsQ.data]);

  useEscClose(open, onClose);

  if (!open) return null;

  const setReceived = (i: number) => (e: ChangeEvent<HTMLInputElement>) =>
    setDesigns((rows) => rows.map((r, idx) => (idx === i ? { ...r, received: e.target.value } : r)));

  const designsLoading = !!selectedLot?.program_id && designsQ.isLoading;
  const anyReceived = designs.some((d) => d.received.trim() !== "");

  const submit = () => {
    if (!selectedLot || !anyReceived) return;
    onSave({ lot_no: selectedLot.lot_no, po_unique_id: selectedLot.po_unique_id ?? "", received_date: receivedDate, remark, designs });
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Record fabric receipt">
        <div className="modal-head">
          <div>
            <h3>Record fabric receipt</h3>
            <p>Dyed fabric received back from the dyeing house</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="modal-body">
            <div className="field-row-3">
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label htmlFor="fab-lot">Lot</label>
                <select id="fab-lot" ref={firstFieldRef} value={lotNo} onChange={(e) => setLotNo(e.target.value)}>
                  <option value="">{availableLots.length ? "Select a lot…" : "No lots awaiting receipt"}</option>
                  {availableLots.map((l) => (
                    <option key={l.lot_no} value={l.lot_no}>
                      {l.lot_no}{l.po_no ? ` · PO ${l.po_no}` : ""}{l.vendor ? ` · ${l.vendor}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fab-date">Received date</label>
                <input id="fab-date" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
              </div>
            </div>

            <div className="sum-title">Designs — received vs programmed</div>
            {!selectedLot ? (
              <p className="muted-note">Pick a lot to load its programmed designs.</p>
            ) : designsLoading ? (
              <div className="skeleton" style={{ height: 110 }} />
            ) : designsQ.isError ? (
              <p className="field-err">Couldn&apos;t load the program designs. Please try again.</p>
            ) : designs.length === 0 ? (
              <p className="muted-note">This program has no designs to receive.</p>
            ) : (
              <div className="fab-rows">
                <div className="fab-row fab-row-head" aria-hidden="true">
                  <span>Design</span><span>Programmed</span><span>Received (m)</span><span>Variance</span>
                </div>
                {designs.map((d, i) => {
                  const diff = diffLabel(d.received, d.programmed);
                  return (
                    <div className="fab-row" key={i}>
                      <span className="fab-design"><b className="mono">{d.design_no || "—"}</b>{d.color ? <small> · {d.color}</small> : null}</span>
                      <span className="fab-prog">{fmtNum(d.programmed)} m</span>
                      <input className="di" type="number" step="any" value={d.received} onChange={setReceived(i)} placeholder="0" aria-label={`Received metres for design ${d.design_no || i + 1}`} />
                      <span className={`fab-diff ${diff?.cls ?? ""}`}>{diff?.text ?? "—"}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="fab-remark">Remark</label>
              <input id="fab-remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional note" />
            </div>
          </div>

          <div className="modal-foot">
            <span className="amt-preview">
              {selectedLot ? <>PO <b className="mono">{selectedLot.po_no ?? selectedLot.po_unique_id ?? "—"}</b></> : "Select a lot to continue"}
            </span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !selectedLot || designsLoading || !anyReceived}>
                {saving ? "Saving…" : "Record receipt"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
