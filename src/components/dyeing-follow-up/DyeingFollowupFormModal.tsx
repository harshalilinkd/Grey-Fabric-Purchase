"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import { CYCLE_ORIGINAL, CYCLE_REISSUE, type Cycle } from "@/lib/cycle";
import type { DyeingFollowupFormValues } from "@/lib/types";

/** One QC-rejected line making up a PO's outstanding parcel — read-only context. */
export type RejectedLot = {
  lot_no: string | null;
  design_no: string | null;
  qty: number | null;
  status: string;
};

/**
 * A LOT ready for its FIRST trip out (cycle 'original'), once its program card exists.
 *
 * Grain differs from the reissue leg ON PURPOSE. The first dispatch is per LOT because
 * the lot and its physical program card travel together — one card, one lot. Rejected
 * metres, by contrast, are consolidated into one parcel per PO (see DispatchPo).
 */
export type DispatchLot = {
  lot_no: string;
  po_unique_id: string;
  po_no: string | null;
  program_uid: string;
  dying_house_name: string | null;
  /** Metres the program card authorises for this lot. */
  programmed: number;
  /** Already sent on the original leg. */
  dispatched: number;
  /** programmed − dispatched, clamped at zero. */
  outstanding: number;
  /** True when the vendor drop-shipped the rolls straight to the dyer (migration 026). */
  directToDyer: boolean;
};

/**
 * A PO with metres still to send back out. Dispatch is at PO grain: rejected metres
 * from several lots travel to the dyeing house as one parcel, so the operator picks
 * the PO and sees which lots they are bundling.
 */
export type DispatchPo = {
  po_unique_id: string;
  po_no: string | null;
  order_no: string | null;
  vendor: string | null;
  dying_house_name: string | null;
  /** QC-rejected metres that CAN go back to a dyeing house (excludes vendor returns). */
  rejected: number;
  /** Rejected but returned to the vendor — shown for context, never in the arithmetic. */
  returned: number;
  dispatched: number;
  /** rejected − dispatched, clamped at zero. */
  outstanding: number;
  lots: RejectedLot[];
};

const todayISO = () => new Date().toISOString().slice(0, 10);

export function DyeingFollowupFormModal({
  open,
  dispatchLots,
  dispatchPos,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  dispatchLots: DispatchLot[];
  dispatchPos: DispatchPo[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: DyeingFollowupFormValues) => void;
}) {
  /** Which leg is being recorded. Both live in `dyeing_followups`, split by `cycle`. */
  const [cycle, setCycle] = useState<Cycle>(CYCLE_ORIGINAL);
  const [poUid, setPoUid] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [dyeing, setDyeing] = useState("");
  const [sent, setSent] = useState("");
  const [remaining, setRemaining] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [remark, setRemark] = useState("");
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);

  const isFirstLeg = cycle === CYCLE_ORIGINAL;

  const clearSelection = () => {
    setPoUid("");
    setLotNo("");
    setDyeing("");
    setSent("");
    setRemaining("");
  };

  useEffect(() => {
    if (open) {
      // Open on whichever leg actually has work waiting, so the common case is one click.
      setCycle(dispatchLots.length || !dispatchPos.length ? CYCLE_ORIGINAL : CYCLE_REISSUE);
      setPoUid("");
      setLotNo("");
      setDyeing("");
      setSent("");
      setRemaining("");
      setNextDate("");
      setRemark("");
      const id = requestAnimationFrame(() => firstFieldRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    // dispatch lists are only read to choose the opening tab; re-running on their identity
    // would wipe a half-typed form every time a background refetch lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEscClose(open, onClose);

  if (!open) return null;

  const selectedPo = dispatchPos.find((p) => p.po_unique_id === poUid) ?? null;
  const selectedLot = dispatchLots.find((l) => l.lot_no === lotNo) ?? null;

  const switchCycle = (next: Cycle) => {
    if (next === cycle) return;
    setCycle(next);
    clearSelection();
  };

  const pickPo = (uid: string) => {
    setPoUid(uid);
    const found = dispatchPos.find((p) => p.po_unique_id === uid);
    if (found) {
      // Default to the PO's house — a reissue often goes elsewhere, so it stays editable.
      setDyeing(found.dying_house_name ?? "");
      // Remaining Qty = what was outstanding to dispatch immediately before this entry.
      setRemaining(String(found.outstanding));
    }
  };

  const pickLot = (lot: string) => {
    setLotNo(lot);
    const found = dispatchLots.find((l) => l.lot_no === lot);
    if (found) {
      // The program card names the house for the first leg.
      setDyeing(found.dying_house_name ?? "");
      setRemaining(String(found.outstanding));
      // The card authorises the metres; the whole balance normally goes in one trip.
      setSent(String(found.outstanding));
    }
  };

  // Sent qty is what the return is reconciled against — a dispatch without it can't be
  // closed out, so it's required here even though the column is nullable.
  const sentValid = sent.trim() !== "" && Number.isFinite(Number(sent)) && Number(sent) > 0;
  const hasTarget = isFirstLeg ? !!selectedLot : !!selectedPo;
  const canSave = hasTarget && sentValid;

  const submit = () => {
    if (!canSave) return;
    onSave({
      /* Grain differs by leg: the first trip is one lot travelling with its card, so the
         lot is recorded. A reissue parcel bundles several lots, so it stays blank. */
      lot_no: isFirstLeg ? selectedLot!.lot_no : "",
      po_unique_id: isFirstLeg ? selectedLot!.po_unique_id : selectedPo!.po_unique_id,
      dying_house_name: dyeing,
      sent_qty: sent,
      remaining_meters: remaining,
      next_followup_date: nextDate,
      remark,
      cycle,
    });
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Record dispatch to dyeing house">
        <div className="modal-head">
          <div>
            <h3>Record dispatch</h3>
            <p>Metres sent out to a dyeing house</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="modal-body">
            {/* The two legs of the same journey. Same table, split by `cycle` (025):
                first trip out is per LOT, rejected metres go back per PO. */}
            <div className="seg" role="group" aria-label="Which dispatch">
              <button
                type="button"
                className={isFirstLeg ? "on" : ""}
                aria-pressed={isFirstLeg}
                onClick={() => switchCycle(CYCLE_ORIGINAL)}
              >
                Send for dyeing<span className="cnt">{dispatchLots.length}</span>
              </button>
              <button
                type="button"
                className={!isFirstLeg ? "on" : ""}
                aria-pressed={!isFirstLeg}
                onClick={() => switchCycle(CYCLE_REISSUE)}
              >
                Send back reissue<span className="cnt">{dispatchPos.length}</span>
              </button>
            </div>

            {isFirstLeg ? (
              <div className="field">
                <label htmlFor="df-lot">Lot</label>
                <select id="df-lot" ref={firstFieldRef} value={lotNo} onChange={(e) => pickLot(e.target.value)}>
                  <option value="">{dispatchLots.length ? "Select a lot…" : "No programmed lot waiting to go out"}</option>
                  {dispatchLots.map((l) => (
                    <option key={l.lot_no} value={l.lot_no}>
                      {l.lot_no}
                      {` · ${l.program_uid}`}
                      {l.po_no ? ` · PO ${l.po_no}` : ""}
                      {` · ${fmtNum(l.outstanding)} m to send`}
                    </option>
                  ))}
                </select>
                <span className="field-hint">Lots with a program card that haven&apos;t been fully sent out yet</span>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="df-po">Purchase order</label>
                <select id="df-po" ref={firstFieldRef} value={poUid} onChange={(e) => pickPo(e.target.value)}>
                  <option value="">{dispatchPos.length ? "Select a PO…" : "Nothing outstanding to dispatch"}</option>
                  {dispatchPos.map((p) => (
                    <option key={p.po_unique_id} value={p.po_unique_id}>
                      PO {p.po_no ?? p.po_unique_id}
                      {p.order_no ? ` · Order ${p.order_no}` : ""}
                      {p.vendor ? ` · ${p.vendor}` : ""}
                      {` · ${fmtNum(p.outstanding)} m to send`}
                    </option>
                  ))}
                </select>
                <span className="field-hint">POs with QC-rejected metres not yet sent back out</span>
              </div>
            )}

            {isFirstLeg && selectedLot && (
              <>
                <div className="sum">
                  <div className="sum-row"><span>Programme authorises</span><b className="mono">{fmtNum(selectedLot.programmed)} m</b></div>
                  <div className="sum-row"><span>Already sent</span><b className="mono">{fmtNum(selectedLot.dispatched)} m</b></div>
                  <div className="sum-row"><span>Outstanding to send</span><b className="mono warn">{fmtNum(selectedLot.outstanding)} m</b></div>
                </div>
                <div className="subtle-note">
                  <Icon name="info" size={16} />
                  <span>
                    {selectedLot.directToDyer
                      ? <>This lot was <b>drop-shipped straight to the dyeing house</b> — the rolls are already there. Courier the program card only; the dyer matches it to the rolls by the vendor design number.</>
                      : <>Send the rolls and the physical program card together from the warehouse.</>}
                  </span>
                </div>
              </>
            )}

            {!isFirstLeg && selectedPo && (
              <>
                <div className="sum">
                  <div className="sum-row"><span>Rejected, dispatchable</span><b className="mono">{fmtNum(selectedPo.rejected)} m</b></div>
                  {selectedPo.returned > 0 && (
                    <div className="sum-row">
                      <span>Returned to vendor</span>
                      <b className="mono dim">{fmtNum(selectedPo.returned)} m · excluded</b>
                    </div>
                  )}
                  <div className="sum-row"><span>Already dispatched</span><b className="mono">{fmtNum(selectedPo.dispatched)} m</b></div>
                  <div className="sum-row"><span>Outstanding to dispatch</span><b className="mono warn">{fmtNum(selectedPo.outstanding)} m</b></div>
                </div>

                <div className="sum-title">Rejected lots in this parcel</div>
                {selectedPo.lots.length === 0 ? (
                  <p className="muted-note">No rejected lines recorded for this PO.</p>
                ) : (
                  <table className="mini-table">
                    <thead>
                      <tr><th>Lot</th><th>Design</th><th style={{ textAlign: "right" }}>Qty (m)</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {selectedPo.lots.map((l, i) => {
                        const returned = l.status === "Returned";
                        return (
                          <tr key={`${l.lot_no ?? "—"}-${l.design_no ?? ""}-${i}`}>
                            <td className="mono">{l.lot_no ?? "—"}</td>
                            <td className="mono">{l.design_no ?? "—"}</td>
                            <td className={`num mono${returned ? " dim" : ""}`}>{fmtNum(l.qty)}</td>
                            <td>
                              <span className={`pill ${returned ? "plain" : "warning"}`}>{l.status}</span>
                              {returned && <small className="dim"> returned to vendor, not dispatchable</small>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <span className="field-hint">Read-only — the lot is recorded again when the fabric comes back.</span>
              </>
            )}

            <div className="field-row-3">
              <div className="field">
                <label htmlFor="df-house">Dyeing house</label>
                <input id="df-house" value={dyeing} onChange={(e) => setDyeing(e.target.value)} placeholder="e.g. Sunrise Dyeing" />
                <span className="field-hint">
                  {isFirstLeg ? "Defaults to the program card's house" : "May differ from the house named on the PO"}
                </span>
              </div>
              <div className="field">
                <label htmlFor="df-sent">Sent qty (m) *</label>
                <input id="df-sent" type="number" step="any" value={sent} onChange={(e) => setSent(e.target.value)} placeholder="50" aria-invalid={(!sentValid && sent.trim() !== "") || undefined} />
                <span className="field-hint">Metres dispatched on this entry</span>
              </div>
              <div className="field">
                <label htmlFor="df-rem">Remaining metres</label>
                <input id="df-rem" type="number" step="any" value={remaining} onChange={(e) => setRemaining(e.target.value)} placeholder="1200" />
                <span className="field-hint">Outstanding before this dispatch — not the amount sent</span>
              </div>
            </div>

            <div className="field-row-2">
              <div className="field">
                <label htmlFor="df-next">Next follow-up date</label>
                <input id="df-next" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} min={todayISO()} />
              </div>
              <div className="field">
                <label htmlFor="df-remark">Remark</label>
                <input id="df-remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. promised by Friday" />
              </div>
            </div>

            <div className="subtle-note">
              <Icon name="info" size={16} />
              <span>
                Sent qty is what the return is reconciled against when the fabric comes back — a dispatch without it
                can&apos;t be closed out. A next date today or earlier is flagged overdue.
              </span>
            </div>
          </div>

          <div className="modal-foot">
            <span className="amt-preview">
              {isFirstLeg
                ? (selectedLot
                    ? <>Lot <b className="mono">{selectedLot.lot_no}</b> · <b className="mono">{selectedLot.program_uid}</b></>
                    : "Select a lot to continue")
                : (selectedPo
                    ? <>PO <b className="mono">{selectedPo.po_no ?? selectedPo.po_unique_id}</b></>
                    : "Select a PO to continue")}
            </span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !canSave}>
                {saving ? "Saving…" : "Record dispatch"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
