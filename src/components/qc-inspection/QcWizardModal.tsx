"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { fetchProgramCardDesigns } from "@/lib/program-cards";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { QcResult, QcSubmitInput } from "@/lib/types";

/** A program available for QC (its lot has not been inspected yet). */
export type QcProgramOption = {
  id: string;
  program_uid: string;
  lot_no: string | null;
  po_unique_id: string;
  po_no: string | null;
  vendor: string | null;
};

type Checks = {
  meter_qty_check: boolean;
  colour_check: boolean;
  strength_check: boolean;
  fabric_quality_check: boolean;
};

const ALL_CHECKS = (v: boolean): Checks => ({
  meter_qty_check: v,
  colour_check: v,
  strength_check: v,
  fabric_quality_check: v,
});

const CHECK_LABELS: { key: keyof Checks; label: string }[] = [
  { key: "meter_qty_check", label: "Meter Qty" },
  { key: "colour_check", label: "Colour" },
  { key: "strength_check", label: "Strength" },
  { key: "fabric_quality_check", label: "Fabric Quality" },
];

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const STEP_LABELS = ["Select", "Result", "Details"];

export function QcWizardModal({
  programs,
  saving,
  onClose,
  onSubmit,
}: {
  programs: QcProgramOption[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: QcSubmitInput) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [cardId, setCardId] = useState("");
  const [receivedQty, setReceivedQty] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<QcResult | null>(null);
  const [checks, setChecks] = useState<Checks>(ALL_CHECKS(true));
  const [failedQty, setFailedQty] = useState("");
  const [reason, setReason] = useState("");
  const [returnAndReissue, setReturnAndReissue] = useState(true);

  useEscClose(true, onClose);

  const program = useMemo(() => programs.find((p) => p.id === cardId) ?? null, [programs, cardId]);

  const { data: designs = [], isLoading: designsLoading, isError: designsError, refetch: refetchDesigns } = useQuery({
    queryKey: ["program-card-designs", cardId],
    queryFn: () => fetchProgramCardDesigns(cardId),
    enabled: !!cardId,
  });

  const selectedDesigns = useMemo(
    () => designs.filter((d) => selectedIds.has(d.id)),
    [designs, selectedIds],
  );

  const rq = num(receivedQty);
  const fq = num(failedQty);
  const allSelected = designs.length > 0 && selectedIds.size === designs.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const step1Valid = !!program && rq != null && rq > 0 && selectedIds.size >= 1;
  const failValid = result === "Failed" ? fq != null && fq > 0 && rq != null && fq <= rq : true;
  const canSubmit = !!program && !!result && failValid && !saving;

  const passedPreview = rq == null ? null : rq - (result === "Failed" ? fq ?? 0 : 0);

  const pickProgram = (id: string) => {
    setCardId(id);
    setSelectedIds(new Set()); // designs differ per program
  };

  const toggleDesign = (id: string) =>
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelectedIds((cur) => (cur.size === designs.length ? new Set() : new Set(designs.map((d) => d.id))));

  const chooseResult = (r: QcResult) => {
    setResult(r);
    setChecks(ALL_CHECKS(r === "Passed")); // a pass defaults all checks ticked; a fail clears them
    setStep(3);
  };

  const submit = () => {
    if (!program || !result || !failValid) return;
    onSubmit({
      program: { program_uid: program.program_uid, lot_no: program.lot_no, po_unique_id: program.po_unique_id },
      designNos: selectedDesigns.map((d) => d.design_no),
      receivedQty: rq ?? 0,
      result,
      checks,
      failedQty: result === "Failed" ? fq ?? 0 : 0,
      reason,
      returnAndReissue,
    });
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="QC inspection">
        <div className="modal-head">
          <div>
            <h3>QC inspection</h3>
            <p>Step {step} of 3 · {STEP_LABELS[step - 1]}</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="modal-body">
          <div className="wizard-steps" aria-hidden="true">
            {STEP_LABELS.map((label, i) => {
              const n = i + 1;
              return (
                <div key={label} className={`wstep${step === n ? " active" : ""}${step > n ? " done" : ""}`}>
                  <span className="wsn">{step > n ? <Icon name="check" size={13} /> : n}</span>
                  {label}
                  {n < 3 && <span className="wstep-sep" />}
                </div>
              );
            })}
          </div>

          {/* STEP 1 — program, received qty, designs */}
          {step === 1 && (
            <>
              <div className="field">
                <label htmlFor="qc-prog">Program / lot</label>
                <select id="qc-prog" value={cardId} onChange={(e) => pickProgram(e.target.value)}>
                  <option value="">
                    {programs.length ? "Select a program…" : "No programs awaiting QC"}
                  </option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.program_uid}
                      {p.lot_no ? ` · Lot ${p.lot_no}` : ""}
                      {p.po_no ? ` · PO ${p.po_no}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="qc-recv">Received quantity (m)</label>
                <input id="qc-recv" type="number" step="any" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} placeholder="2400" />
              </div>

              <div className="sum-title">Designs to inspect</div>
              {!cardId ? (
                <p className="muted-note">Pick a program to list its designs.</p>
              ) : designsLoading ? (
                <div className="skeleton" style={{ height: 96 }} />
              ) : designsError ? (
                <p className="muted-note">
                  Couldn&apos;t load this program&apos;s designs.{" "}
                  <button type="button" className="act" onClick={() => refetchDesigns()}>Retry</button>
                </p>
              ) : designs.length === 0 ? (
                <p className="muted-note">This program has no designs recorded — nothing to inspect.</p>
              ) : (
                <div className="check-list">
                  <label className="check-all">
                    <input
                      type="checkbox"
                      ref={(el) => { if (el) el.indeterminate = someSelected; }}
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                    Select all ({designs.length})
                  </label>
                  {designs.map((d) => (
                    <label key={d.id} className="check-row">
                      <input type="checkbox" checked={selectedIds.has(d.id)} onChange={() => toggleDesign(d.id)} />
                      <span className="strong mono">{d.design_no ?? "—"}</span>
                      <span className="dim">{d.color ?? "—"}</span>
                      <span className="num mono dim">{fmtNum(d.meter)} m</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          {/* STEP 2 — summary + pass/fail */}
          {step === 2 && program && (
            <>
              <div className="sum">
                <div className="sum-row"><span>Program</span><b className="mono">{program.program_uid}</b></div>
                <div className="sum-row"><span>Lot</span><b className="mono">{program.lot_no ?? "—"}</b></div>
                <div className="sum-row"><span>Received qty</span><b className="mono">{fmtNum(rq)} m</b></div>
                <div className="sum-row"><span>Designs selected</span><b className="mono">{selectedDesigns.length}</b></div>
              </div>
              <div className="design-chips">
                {selectedDesigns.map((d) => (
                  <span key={d.id} className="pill brand">{d.design_no ?? "—"}</span>
                ))}
              </div>

              <div className="sum-title">Inspection result</div>
              <div className="outcome-btns">
                <button type="button" className="outcome pass" onClick={() => chooseResult("Passed")}>
                  <Icon name="checkCircle" size={22} />
                  <b>Pass</b>
                  <small>Record checks · store passed fabric</small>
                </button>
                <button type="button" className="outcome fail" onClick={() => chooseResult("Failed")}>
                  <Icon name="xCircle" size={22} />
                  <b>Fail</b>
                  <small>Record failed qty · return / reissue</small>
                </button>
              </div>
            </>
          )}

          {/* STEP 3 — pass checks OR fail details */}
          {step === 3 && result && (
            <div className="result-banner">
              Result
              <span className={`pill ${result === "Passed" ? "success" : "danger"}`}>{result}</span>
              <button type="button" className="result-change" onClick={() => setStep(2)}>Change</button>
            </div>
          )}

          {step === 3 && result === "Passed" && (
            <>
              <div className="sum-title">Quality checks</div>
              <div className="qc-checks">
                {CHECK_LABELS.map((c) => (
                  <label key={c.key} className="qc-check">
                    <input
                      type="checkbox"
                      checked={checks[c.key]}
                      onChange={(e) => setChecks((p) => ({ ...p, [c.key]: e.target.checked }))}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              <div className="subtle-note">
                <Icon name="info" size={16} />
                <span>
                  Passing stores <b className="mono">{fmtNum(passedPreview)} m</b> per design to the warehouse,
                  for {selectedDesigns.length} design{selectedDesigns.length === 1 ? "" : "s"}.
                </span>
              </div>
            </>
          )}

          {step === 3 && result === "Failed" && (
            <>
              <div className="field">
                <label htmlFor="qc-fail">Failed quantity (m)</label>
                <input
                  id="qc-fail"
                  type="number"
                  step="any"
                  value={failedQty}
                  onChange={(e) => setFailedQty(e.target.value)}
                  placeholder="400"
                />
                {fq != null && rq != null && fq > rq && (
                  <span className="field-err">Can&apos;t exceed the received quantity ({fmtNum(rq)} m).</span>
                )}
              </div>
              <div className="field">
                <label htmlFor="qc-reason">Reason</label>
                <textarea id="qc-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Shade mismatch on the lighter designs" />
              </div>
              <label className="check-row standalone">
                <input type="checkbox" checked={returnAndReissue} onChange={(e) => setReturnAndReissue(e.target.checked)} />
                Return &amp; reissue (send back for re-dyeing)
              </label>
              <div className="subtle-note">
                <Icon name="info" size={16} />
                <span>
                  Marks <b className="mono">{returnAndReissue ? "Reissue Pending" : "Returned"}</b> for{" "}
                  {selectedDesigns.length} design{selectedDesigns.length === 1 ? "" : "s"}
                  {passedPreview != null && passedPreview > 0 && <> · stores <b className="mono">{fmtNum(passedPreview)} m</b> passed per design</>}.
                </span>
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <span className="amt-preview">
            {result && rq != null ? <>Passed/design <b className="mono">{fmtNum(passedPreview)} m</b></> : <>&nbsp;</>}
          </span>
          <div className="foot-actions">
            {step > 1 && (
              <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => (s === 3 ? 2 : 1) as 1 | 2)}>
                Back
              </button>
            )}
            {step === 1 && (
              <>
                <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={!step1Valid} onClick={() => setStep(2)}>Next</button>
              </>
            )}
            {step === 3 && (
              <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
                {saving ? "Saving…" : "Submit QC"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
