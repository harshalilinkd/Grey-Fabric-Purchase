"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { fetchProgramCardDesigns } from "@/lib/program-cards";
import { CYCLES, CYCLE_ORIGINAL, isReissue, type Cycle } from "@/lib/cycle";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import { GRID_NAV_HINT, useGridNav } from "@/lib/use-grid-nav";
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
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Variance of this entry against what is still OUTSTANDING for the design. */
function diffLabel(received: string, outstanding: number | null): { cls: string; text: string } | null {
  if (received.trim() === "" || outstanding == null) return null;
  const r = Number(received);
  if (!Number.isFinite(r)) return null;
  const d = round2(r - outstanding);
  if (d === 0) return { cls: "ok", text: "completes" };
  if (d < 0) return { cls: "warn", text: `short ${fmtNum(Math.abs(d))}` };
  return { cls: "ok", text: `over ${fmtNum(d)}` };
}

export function FabricReceiptFormModal({
  open,
  availableLots,
  saving,
  onClose,
  onSave,
  receivedByLot = {},
  receivedByLotDesign = {},
}: {
  open: boolean;
  availableLots: FabricLot[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: FabricReceiptFormValues) => void;
  /** Metres already received per lot — drives the remaining-qty snapshot. */
  receivedByLot?: Record<string, number>;
  /** Metres already received per `lot||design` — drives each row's outstanding default. */
  receivedByLotDesign?: Record<string, number>;
}) {
  const [lotNo, setLotNo] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayISO());
  const [remark, setRemark] = useState("");
  const [nextFollowup, setNextFollowup] = useState("");
  /* Stage 3 vs Stage 7 — field-identical legs of the same form. The reissue leg receives
     back only the rejected metres that were dispatched at Stage 6. */
  const [cycle, setCycle] = useState<Cycle>(CYCLE_ORIGINAL);
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
      setNextFollowup("");
      setCycle(CYCLE_ORIGINAL);
      setDesigns([]);
      seededProgramId.current = null;
      const id = requestAnimationFrame(() => firstFieldRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  // Seed the design rows once per program. Fabric comes back piecemeal, so the default is
  // what is still OUTSTANDING for that design (programmed − already received), not the full
  // programmed metre — on a first receipt those are the same number.
  useEffect(() => {
    const pid = selectedLot?.program_id ?? null;
    if (open && pid && designsQ.data && seededProgramId.current !== pid) {
      const lot = selectedLot?.lot_no ?? "";
      setDesigns(
        designsQ.data.map((d) => {
          const design = d.design_no ?? "";
          const before = receivedByLotDesign[`${lot}||${design}`] ?? 0;
          const outstanding = d.meter != null ? Math.max(0, round2(d.meter - before)) : null;
          return {
            design_no: design,
            color: d.color ?? "",
            programmed: d.meter,
            receivedBefore: before,
            received: outstanding != null ? String(outstanding) : "",
          };
        }),
      );
      seededProgramId.current = pid;
    }
  }, [open, selectedLot, designsQ.data, receivedByLotDesign]);

  useEscClose(open, onClose);

  /* Spreadsheet keyboard nav — see `use-grid-nav.ts`. Fixed-size grid: the rows come from
     the program card, so there is no row to append and Enter on the last one stays put.
     Declared above the early return — hooks must not run conditionally. */
  const cellId = (field: "recv", row: number) => `fab-${field}-${row}`;
  const { onCellKeyDown } = useGridNav<"recv">({ cellId, rowCount: designs.length });

  if (!open) return null;

  const setReceived = (i: number) => (e: ChangeEvent<HTMLInputElement>) =>
    setDesigns((rows) => rows.map((r, idx) => (idx === i ? { ...r, received: e.target.value } : r)));

  const designsLoading = !!selectedLot?.program_id && designsQ.isLoading;
  const anyReceived = designs.some((d) => d.received.trim() !== "");

  // Lot qty = what was programmed to the dyeing house (sum of its design lines).
  const lotProgrammed = designs.reduce((s, d) => s + (d.programmed ?? 0), 0);
  const receivedBefore = selectedLot ? receivedByLot[selectedLot.lot_no] ?? 0 : 0;
  /** Outstanding immediately BEFORE this entry — persisted verbatim as the snapshot. */
  const remainingBefore = designs.length ? round2(lotProgrammed - receivedBefore) : null;
  const thisEntry = round2(designs.reduce((s, d) => s + (Number(d.received) || 0), 0));
  const remainingAfter = remainingBefore == null ? null : round2(remainingBefore - thisEntry);

  const submit = () => {
    if (!selectedLot || !anyReceived) return;
    onSave({
      lot_no: selectedLot.lot_no,
      po_unique_id: selectedLot.po_unique_id ?? "",
      received_date: receivedDate,
      remark,
      next_followup_date: nextFollowup || null,
      remaining_qty: remainingBefore,
      cycle,
      designs,
    });
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Record fabric receipt">
        <div className="modal-head">
          <div>
            <h3>Record fabric receipt</h3>
            <p>{isReissue(cycle) ? "Stage 7 — reissued metres coming back" : "Stage 3 — dyed fabric received back from the dyeing house"}</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="modal-body">
            <div className="seg" role="group" aria-label="Which track this receipt belongs to" style={{ marginBottom: 14 }}>
              {CYCLES.map((c) => (
                <button key={c} type="button" className={cycle === c ? "on" : ""} aria-pressed={cycle === c} onClick={() => setCycle(c)}>
                  {c === CYCLE_ORIGINAL ? "Original (Stage 3)" : "Reissue (Stage 7)"}
                </button>
              ))}
            </div>

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
                  <span>Design</span><span>Outstanding</span><span>Received (m)</span><span>Variance</span>
                </div>
                {designs.map((d, i) => {
                  const before = d.receivedBefore ?? 0;
                  const outstanding = d.programmed == null ? null : Math.max(0, round2(d.programmed - before));
                  const diff = diffLabel(d.received, outstanding);
                  return (
                    <div className="fab-row" key={i}>
                      <span className="fab-design"><b className="mono">{d.design_no || "—"}</b>{d.color ? <small> · {d.color}</small> : null}</span>
                      <span className="fab-prog">
                        {fmtNum(outstanding)} m
                        {before > 0 && <small> of {fmtNum(d.programmed)}</small>}
                      </span>
                      <input id={cellId("recv", i)} className="di" type="number" step="any" value={d.received} onChange={setReceived(i)} onKeyDown={onCellKeyDown("recv", i)} placeholder="0" aria-label={`Received metres for design ${d.design_no || i + 1}`} />
                      <span className={`fab-diff ${diff?.cls ?? ""}`}>{diff?.text ?? "—"}</span>
                    </div>
                  );
                })}
                <span className="field-hint">{GRID_NAV_HINT}</span>
              </div>
            )}

            {selectedLot && designs.length > 0 && (
              <div className="sum" style={{ marginTop: 12 }}>
                <div className="sum-row"><span>Lot programmed</span><b className="mono">{fmtNum(lotProgrammed)} m</b></div>
                <div className="sum-row"><span>Received to date</span><b className="mono">{fmtNum(receivedBefore)} m</b></div>
                <div className="sum-row"><span>Remaining before entry</span><b className="mono">{fmtNum(remainingBefore)} m</b></div>
                <div className="sum-row">
                  <span>Remaining after this entry</span>
                  <b className={`mono ${remainingAfter != null && remainingAfter <= 0 ? "" : "warn"}`}>{fmtNum(remainingAfter)} m</b>
                </div>
              </div>
            )}

            <div className="field-row-2" style={{ marginTop: 14 }}>
              <div className="field">
                <label htmlFor="fab-next">Next follow-up date</label>
                <input id="fab-next" type="date" value={nextFollowup} onChange={(e) => setNextFollowup(e.target.value)} />
                <span className="field-hint">When to chase the dyeing house for the balance</span>
              </div>
              <div className="field">
                <label htmlFor="fab-remark">Remark</label>
                <input id="fab-remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional note" />
              </div>
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
