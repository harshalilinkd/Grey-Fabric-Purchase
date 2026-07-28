"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { fetchProgramCardDesigns } from "@/lib/program-cards";
import { fmtNum } from "@/lib/format";
import { QC_OKAY, QC_REISSUE } from "@/lib/qc-status";
import { CYCLES, CYCLE_ORIGINAL, isReissue, type Cycle } from "@/lib/cycle";
import { useEscClose } from "@/lib/use-esc-close";
import type { QcDesignInput, QcResult, QcSubmitInput } from "@/lib/types";

/** A program whose lot still has metres to account for. */
export type QcProgramOption = {
  id: string;
  program_uid: string;
  lot_no: string | null;
  po_unique_id: string;
  po_no: string | null;
  vendor: string | null;
  /** lot qty − (goodQty + reissueQty), for the ORIGINAL leg. */
  remainingForQc: number;
  /** Same, for the REISSUE leg: metres received back at Stage 7 minus those disposed at 8. */
  remainingForReissueQc: number;
};

/** What was actually found for one design, keyed by the design row id. */
type ActualByDesign = Record<string, { design_no: string; color: string; qty: string }>;

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
  const [remark, setRemark] = useState("");
  const [returnAndReissue, setReturnAndReissue] = useState(true);
  const [actuals, setActuals] = useState<ActualByDesign>({});
  /* Stage 4 vs Stage 8 — same fields, same two statuses, different leg. The two run
     concurrently on one lot, so every rollup below is scoped to the chosen cycle. */
  const [cycle, setCycle] = useState<Cycle>(CYCLE_ORIGINAL);

  useEscClose(true, onClose);

  /** Remaining on the leg being inspected — the two tracks never share a figure. */
  const remainingOn = (p: QcProgramOption) => (isReissue(cycle) ? p.remainingForReissueQc : p.remainingForQc);
  const cycleOptions = useMemo(() => programs.filter((p) => remainingOn(p) > 0), [programs, cycle]);

  const program = useMemo(() => cycleOptions.find((p) => p.id === cardId) ?? null, [cycleOptions, cardId]);

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
  const failValid = result === QC_REISSUE ? fq != null && fq > 0 && rq != null && fq <= rq : true;
  const canSubmit = !!program && !!result && failValid && !saving;

  const passedPreview = rq == null ? null : rq - (result === QC_REISSUE ? fq ?? 0 : 0);
  /** What this event leaves unaccounted on the lot — 0 means the lot closes. */
  const remainingAfter =
    program == null || rq == null ? null : Math.round((remainingOn(program) - rq * selectedIds.size) * 100) / 100;

  const pickProgram = (id: string) => {
    setCardId(id);
    setSelectedIds(new Set()); // designs differ per program
    setActuals({});
  };

  /** Seed the "actual" fields from the program card, so the common case is one tick. */
  const toggleDesign = (id: string) =>
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        const d = designs.find((x) => x.id === id);
        setActuals((p) =>
          p[id] ? p : { ...p, [id]: { design_no: d?.design_no ?? "", color: d?.color ?? "", qty: receivedQty } },
        );
      }
      return next;
    });

  const setActual = (id: string, field: "design_no" | "color" | "qty", value: string) =>
    setActuals((p) => ({ ...p, [id]: { ...(p[id] ?? { design_no: "", color: "", qty: "" }), [field]: value } }));

  const toggleAll = () =>
    setSelectedIds((cur) => {
      if (cur.size === designs.length) return new Set();
      setActuals((p) => {
        const next = { ...p };
        for (const d of designs) {
          if (!next[d.id]) next[d.id] = { design_no: d.design_no ?? "", color: d.color ?? "", qty: receivedQty };
        }
        return next;
      });
      return new Set(designs.map((d) => d.id));
    });

  const chooseResult = (r: QcResult) => {
    setResult(r);
    // Okay defaults all checks ticked; a return & reissue clears them.
    setChecks(ALL_CHECKS(r === QC_OKAY));
    setStep(3);
  };

  const submit = () => {
    if (!program || !result || !failValid) return;
    const designInputs: QcDesignInput[] = selectedDesigns.map((d) => {
      const a = actuals[d.id];
      return {
        design_no: d.design_no,
        actual_design_no: a?.design_no ?? d.design_no ?? "",
        actual_color: a?.color ?? d.color ?? "",
        actual_qty: a?.qty ?? receivedQty,
      };
    });
    onSubmit({
      program: { program_uid: program.program_uid, lot_no: program.lot_no, po_unique_id: program.po_unique_id },
      designs: designInputs,
      receivedQty: rq ?? 0,
      result,
      checks,
      failedQty: result === QC_REISSUE ? fq ?? 0 : 0,
      reason,
      remark,
      cycle,
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
              <div className="seg" role="group" aria-label="Which track this inspection belongs to" style={{ marginBottom: 14 }}>
                {CYCLES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cycle === c ? "on" : ""}
                    aria-pressed={cycle === c}
                    onClick={() => { setCycle(c); setCardId(""); setSelectedIds(new Set()); setActuals({}); }}
                  >
                    {c === CYCLE_ORIGINAL ? "Original (Stage 4)" : "Reissue (Stage 8)"}
                  </button>
                ))}
              </div>

              <div className="field">
                <label htmlFor="qc-prog">Program / lot</label>
                <select id="qc-prog" value={cardId} onChange={(e) => pickProgram(e.target.value)}>
                  <option value="">
                    {cycleOptions.length ? "Select a program…" : "Nothing awaiting QC on this leg"}
                  </option>
                  {cycleOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.program_uid}
                      {p.lot_no ? ` · Lot ${p.lot_no}` : ""}
                      {p.po_no ? ` · PO ${p.po_no}` : ""}
                      {` · ${fmtNum(remainingOn(p))} m left for QC`}
                    </option>
                  ))}
                </select>
                <span className="field-hint">A lot stays here until nothing remains for QC — inspect it as many times as it takes.</span>
              </div>

              <div className="field">
                <label htmlFor="qc-recv">Quantity inspected now (m, per design)</label>
                <input id="qc-recv" type="number" step="any" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} placeholder="2400" />
                {program && (
                  <span className="field-hint">
                    Lot has <b className="mono">{fmtNum(remainingOn(program))} m</b> left for QC
                    {remainingAfter != null && (
                      <> · after this event: <b className="mono">{fmtNum(Math.max(0, remainingAfter))} m</b>
                        {remainingAfter <= 0 ? " — the lot closes" : ""}</>
                    )}
                  </span>
                )}
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
                    <div key={d.id}>
                      <label className="check-row">
                        <input type="checkbox" checked={selectedIds.has(d.id)} onChange={() => toggleDesign(d.id)} />
                        <span className="strong mono">{d.design_no ?? "—"}</span>
                        <span className="dim">{d.color ?? "—"}</span>
                        <span className="num mono dim">{fmtNum(d.meter)} m</span>
                      </label>
                      {/* What was ACTUALLY found — seeded from the program card, editable
                          because the fabric that comes back doesn't always match it. */}
                      {selectedIds.has(d.id) && (
                        <div className="qc-actual">
                          <span className="qc-actual-label">Actually found</span>
                          <input
                            value={actuals[d.id]?.design_no ?? ""}
                            onChange={(e) => setActual(d.id, "design_no", e.target.value)}
                            aria-label={`Actual design no for ${d.design_no ?? "design"}`}
                            placeholder="Design no"
                          />
                          <input
                            value={actuals[d.id]?.color ?? ""}
                            onChange={(e) => setActual(d.id, "color", e.target.value)}
                            aria-label={`Actual colour for ${d.design_no ?? "design"}`}
                            placeholder="Colour"
                          />
                          <input
                            type="number"
                            step="any"
                            value={actuals[d.id]?.qty ?? ""}
                            onChange={(e) => setActual(d.id, "qty", e.target.value)}
                            aria-label={`Actual quantity for ${d.design_no ?? "design"}`}
                            placeholder="Qty (m)"
                          />
                        </div>
                      )}
                    </div>
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

              <div className="sum-title">Disposition for these metres</div>
              <div className="outcome-btns">
                <button type="button" className="outcome pass" onClick={() => chooseResult(QC_OKAY)}>
                  <Icon name="checkCircle" size={22} />
                  <b>Okay</b>
                  <small>Good metres → warehouse · lot stays open for the rest</small>
                </button>
                <button type="button" className="outcome fail" onClick={() => chooseResult(QC_REISSUE)}>
                  <Icon name="xCircle" size={22} />
                  <b>Return &amp; reissue</b>
                  <small>Rejected metres → reissue track</small>
                </button>
              </div>
            </>
          )}

          {/* STEP 3 — pass checks OR fail details */}
          {step === 3 && result && (
            <div className="result-banner">
              Status
              <span className={`pill ${result === QC_OKAY ? "success" : "danger"}`}>{result}</span>
              <button type="button" className="result-change" onClick={() => setStep(2)}>Change</button>
            </div>
          )}

          {step === 3 && result === QC_OKAY && (
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
              <div className="field">
                <label htmlFor="qc-remark">Remark</label>
                <input id="qc-remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional note kept on the QC row" />
              </div>
              <div className="subtle-note">
                <Icon name="info" size={16} />
                <span>
                  Stores <b className="mono">{fmtNum(passedPreview)} m</b> per design to the warehouse,
                  for {selectedDesigns.length} design{selectedDesigns.length === 1 ? "" : "s"}
                  {remainingAfter != null && remainingAfter > 0 && (
                    <> · <b className="mono">{fmtNum(remainingAfter)} m</b> still to account for on this lot</>
                  )}.
                </span>
              </div>
            </>
          )}

          {step === 3 && result === QC_REISSUE && (
            <>
              <div className="field">
                <label htmlFor="qc-fail">Reissue quantity (m)</label>
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
                  {passedPreview != null && passedPreview > 0 && (
                    <> · the other <b className="mono">{fmtNum(passedPreview)} m</b> per design is recorded separately as good and stored</>
                  )}.
                </span>
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <span className="amt-preview">
            {result && rq != null ? <>Good/design <b className="mono">{fmtNum(passedPreview)} m</b></> : <>&nbsp;</>}
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
