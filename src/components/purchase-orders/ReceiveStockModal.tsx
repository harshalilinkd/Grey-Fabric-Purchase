"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { sourcingLabel } from "@/lib/po-meta";
import { fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PurchaseOrder } from "@/lib/types";

type RowInput = { design_no: string; color: string; metres: string; status: "Passed" | "Failed"; failed_metres: string };

export type ReceiveStockValues = {
  lot_no: string;
  stored_date: string;
  checks: { meter_qty_check: boolean; colour_check: boolean; strength_check: boolean; fabric_quality_check: boolean };
  reason: string;
  return_and_reissue: boolean;
  lines: { design_no: string; color: string; metres: number; passed: boolean; failed_metres: number }[];
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const QC_CHECKS = [
  { key: "meter_qty_check", label: "Meter & qty" },
  { key: "colour_check", label: "Colour" },
  { key: "strength_check", label: "Strength" },
  { key: "fabric_quality_check", label: "Fabric quality" },
] as const;

/**
 * Receive a finished-goods PO (direct purchase / imported) with MANDATORY QC. There is no
 * dyeing, but each design is inspected on arrival: only QC-passed metres land in the
 * Ready-Goods ledger (Warehouse); failed metres go to Reissue & Return; a QC record is kept.
 */
export function ReceiveStockModal({
  po,
  alreadyStocked,
  saving,
  onClose,
  onSave,
}: {
  po: PurchaseOrder;
  alreadyStocked: number;
  saving: boolean;
  onClose: () => void;
  onSave: (v: ReceiveStockValues) => void;
}) {
  const ordered = po.quantity ?? 0;
  const remaining = ordered > 0 ? Math.max(0, ordered - alreadyStocked) : 0;
  const [lotNo, setLotNo] = useState("");
  const [date, setDate] = useState(todayISO());
  const [checks, setChecks] = useState({ meter_qty_check: true, colour_check: true, strength_check: true, fabric_quality_check: true });
  const [reason, setReason] = useState("");
  const [returnReissue, setReturnReissue] = useState(true);
  const [rows, setRows] = useState<RowInput[]>([
    { design_no: "", color: "", metres: remaining > 0 ? String(remaining) : ordered ? String(ordered) : "", status: "Passed", failed_metres: "" },
  ]);
  const [submitted, setSubmitted] = useState(false);

  useEscClose(true, onClose);

  const setField = (i: number, k: keyof RowInput, v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const setStatus = (i: number, status: "Passed" | "Failed") =>
    setRows((rs) =>
      rs.map((r, j) =>
        j === i
          ? { ...r, status, failed_metres: status === "Passed" ? "" : r.failed_metres.trim() === "" ? r.metres : r.failed_metres }
          : r,
      ),
    );
  const addRow = () => setRows((rs) => [...rs, { design_no: "", color: "", metres: "", status: "Passed", failed_metres: "" }]);
  const removeRow = (i: number) => setRows((rs) => (rs.length === 1 ? rs : rs.filter((_, j) => j !== i)));
  const toggleCheck = (k: keyof typeof checks) => setChecks((c) => ({ ...c, [k]: !c[k] }));

  // per-row maths (failed clamped into [0, metres])
  const computed = rows.map((r) => {
    const m = num(r.metres) ?? 0;
    const failedRaw = r.status === "Failed" ? num(r.failed_metres) ?? m : 0;
    const failed = Math.min(Math.max(0, failedRaw), m);
    return { m, failed, passed: Math.max(0, m - failed) };
  });
  const totalReceived = computed.reduce((s, c) => s + c.m, 0);
  const totalPassed = computed.reduce((s, c) => s + c.passed, 0);
  const totalFailed = computed.reduce((s, c) => s + c.failed, 0);
  const anyFail = rows.some((r) => r.status === "Failed");
  const hasValidLine = computed.some((c) => c.m > 0);
  const allocState = ordered > 0 ? (totalReceived > remaining ? "warn" : totalReceived === remaining ? "ok" : "") : "";

  const submit = () => {
    setSubmitted(true);
    if (!hasValidLine) return;
    const lines = rows
      .map((r) => {
        const m = num(r.metres);
        if (m == null || m <= 0) return null;
        const passed = r.status === "Passed";
        const failed_metres = passed ? 0 : Math.min(Math.max(0, num(r.failed_metres) ?? m), m);
        return { design_no: r.design_no, color: r.color, metres: m, passed, failed_metres };
      })
      .filter((r): r is ReceiveStockValues["lines"][number] => r != null);
    onSave({ lot_no: lotNo, stored_date: date, checks, reason, return_and_reissue: returnReissue, lines });
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Receive and QC">
        <div className="modal-head">
          <div>
            <h3>Receive &amp; QC</h3>
            <p>
              PO <span className="mono">{po.po_no ?? po.unique_id}</span>
              {po.sourcing_path ? ` · ${sourcingLabel(po.sourcing_path)}` : ""}
            </p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="modal-body">
            <div className="subtle-note">
              <Icon name="info" size={16} />
              <span>Finished goods skip dyeing, but QC is required on arrival. <b>Only QC-passed metres are stored</b>; failed metres go to Reissue &amp; Return.</span>
            </div>

            <div className="field-row-2" style={{ marginTop: 14 }}>
              <div className="field">
                <label htmlFor="rs-lot">Lot / Batch No</label>
                <input id="rs-lot" value={lotNo} onChange={(e) => setLotNo(e.target.value)} placeholder="e.g. DP-2291 (optional)" />
              </div>
              <div className="field">
                <label htmlFor="rs-date">Received date</label>
                <input id="rs-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>

            <div className="sum-title">Quality checks</div>
            <div className="qc-checks">
              {QC_CHECKS.map((c) => (
                <label key={c.key} className="qc-check">
                  <input type="checkbox" checked={checks[c.key]} onChange={() => toggleCheck(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>

            <div className="designs-head" style={{ marginTop: 14 }}>
              <span className="sum-title" style={{ margin: 0 }}>Items received &amp; inspected</span>
              {ordered > 0 && (
                <span className={`alloc ${allocState}`} role="status" aria-live="polite">
                  {fmtNum(totalReceived)} of {fmtNum(remaining)} m
                </span>
              )}
            </div>

            <div className="rq-rows">
              {rows.map((r, i) => (
                <div className="rq-item" key={i}>
                  <div className="rq-top">
                    <input className="di" value={r.design_no} onChange={(e) => setField(i, "design_no", e.target.value)} placeholder="Design no" aria-label={`Design ${i + 1}`} />
                    <input className="di" value={r.color} onChange={(e) => setField(i, "color", e.target.value)} placeholder="Colour" aria-label={`Colour ${i + 1}`} />
                    <input className="di" type="number" step="any" value={r.metres} onChange={(e) => setField(i, "metres", e.target.value)} placeholder="Metres" aria-label={`Metres ${i + 1}`} />
                    <select className={`di rq-status ${r.status === "Failed" ? "fail" : "pass"}`} value={r.status} onChange={(e) => setStatus(i, e.target.value as "Passed" | "Failed")} aria-label={`QC result ${i + 1}`}>
                      <option value="Passed">Pass</option>
                      <option value="Failed">Fail</option>
                    </select>
                    <button type="button" className="mini-act danger" onClick={() => removeRow(i)} disabled={rows.length === 1} aria-label={`Remove item ${i + 1}`}>
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  {r.status === "Failed" && (
                    <div className="rq-fail">
                      <label className="rq-fail-label">Failed metres</label>
                      <input className="di" type="number" step="any" value={r.failed_metres} onChange={(e) => setField(i, "failed_metres", e.target.value)} placeholder="0" aria-label={`Failed metres ${i + 1}`} />
                      <span className="rq-hint">→ stores <b className="mono">{fmtNum(computed[i].passed)} m</b>, fails <b className="mono">{fmtNum(computed[i].failed)} m</b></span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="act add-design" onClick={addRow}>
              <Icon name="plus" size={15} />Add item
            </button>

            {anyFail && (
              <div className="fail-box">
                <div className="field" style={{ marginBottom: 10 }}>
                  <label htmlFor="rs-reason">Failure reason</label>
                  <input id="rs-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. shade variation, holes…" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="rs-action">What happens to the failed metres?</label>
                  <select id="rs-action" value={returnReissue ? "reissue" : "return"} onChange={(e) => setReturnReissue(e.target.value === "reissue")}>
                    <option value="reissue">Send back for reissue (Reissue Pending)</option>
                    <option value="return">Mark as Returned</option>
                  </select>
                </div>
              </div>
            )}

            {submitted && !hasValidLine && <p className="field-err" style={{ marginTop: 10 }}>Add at least one item with metres greater than 0.</p>}
          </div>

          <div className="modal-foot">
            <span className="amt-preview">
              Store <b className="mono">{fmtNum(totalPassed)} m</b>
              {totalFailed > 0 && <> · fail <b className="mono">{fmtNum(totalFailed)} m</b></>}
            </span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || (submitted && !hasValidLine)}>
                {saving ? "Saving…" : "Receive & QC"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
