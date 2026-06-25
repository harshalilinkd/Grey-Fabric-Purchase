"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { CHECKS_METHODS, SOURCING_PATHS, sourcingFlow } from "@/lib/po-meta";
import { useEscClose } from "@/lib/use-esc-close";
import type { SampleApprovalFormValues } from "@/lib/types";

/** Only the sampled sources reach this stage — direct purchase & imported skip sampling. */
const SAMPLED = SOURCING_PATHS.filter((p) => p.value === "grey" || p.value === "client_fabric" || p.value === "checks_weaves");

const todayISO = () => new Date().toISOString().slice(0, 10);

export function SampleFormModal({
  open,
  saving,
  vendorSuggestions = [],
  qualitySuggestions = [],
  onClose,
  onSave,
}: {
  open: boolean;
  saving: boolean;
  vendorSuggestions?: string[];
  qualitySuggestions?: string[];
  onClose: () => void;
  onSave: (v: SampleApprovalFormValues) => void;
}) {
  const [path, setPath] = useState("");
  const [method, setMethod] = useState("");
  const [vendor, setVendor] = useState("");
  const [quality, setQuality] = useState("");
  const [designNo, setDesignNo] = useState("");
  const [merchant, setMerchant] = useState("");
  const [cadRef, setCadRef] = useState("");
  const [handloomRef, setHandloomRef] = useState("");
  const [sampleDate, setSampleDate] = useState(todayISO());
  const [remark, setRemark] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const firstFieldRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setPath("");
      setMethod("");
      setVendor("");
      setQuality("");
      setDesignNo("");
      setMerchant("");
      setCadRef("");
      setHandloomRef("");
      setSampleDate(todayISO());
      setRemark("");
      setSubmitted(false);
      const id = requestAnimationFrame(() => firstFieldRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  useEscClose(open, onClose);

  // The pre-PO sampling steps for the chosen source (the chain up to "PO"), shown as a guide.
  const steps = useMemo(() => {
    if (!path) return [];
    const flow = sourcingFlow(path, { checks_method: method });
    const i = flow.indexOf("PO");
    return i >= 0 ? flow.slice(0, i) : flow;
  }, [path, method]);

  if (!open) return null;

  const isChecks = path === "checks_weaves";
  const valid = path !== "" && (!isChecks || method !== "");

  const submit = () => {
    setSubmitted(true);
    if (!valid) return;
    onSave({
      sourcing_path: path,
      checks_method: isChecks ? method : "",
      vendor_name: vendor,
      quality_name: quality,
      vendor_design_no: designNo,
      selling_merchant_no: merchant,
      cad_ref: cadRef,
      handloom_ref: handloomRef,
      sample_date: sampleDate,
      remark,
    });
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="New sample">
        <div className="modal-head">
          <div>
            <h3>New sample</h3>
            <p>Pre-PO sampling — a PO can be raised once this sample is approved</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="modal-body">
            <div className="sum-title" style={{ marginTop: 0 }}>Source</div>
            <div className="path-pills" role="group" aria-label="Source">
              {SAMPLED.map((p, i) => (
                <button
                  key={p.value}
                  ref={i === 0 ? firstFieldRef : undefined}
                  type="button"
                  className={`path-pill${path === p.value ? " on" : ""}`}
                  aria-pressed={path === p.value}
                  onClick={() => { setPath(p.value); if (p.value !== "checks_weaves") setMethod(""); }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {submitted && !path && <span className="field-err">Pick a source.</span>}
            {path && <p className="path-blurb">{SAMPLED.find((p) => p.value === path)?.blurb}</p>}

            {isChecks && (
              <>
                <div className="sum-title">Checks route</div>
                <div className="path-pills" role="group" aria-label="Checks route">
                  {CHECKS_METHODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      className={`path-pill${method === m.value ? " on" : ""}`}
                      aria-pressed={method === m.value}
                      onClick={() => setMethod(m.value)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {submitted && isChecks && !method && <span className="field-err">Pick CAD or Handloom.</span>}
                {method === "cad" && (
                  <div className="field-row-3" style={{ marginTop: 12 }}>
                    <div className="field">
                      <label htmlFor="sa-cad">CAD ref</label>
                      <input id="sa-cad" value={cadRef} onChange={(e) => setCadRef(e.target.value)} placeholder="e.g. CAD-2291" />
                    </div>
                  </div>
                )}
                {method === "handloom" && (
                  <div className="field-row-3" style={{ marginTop: 12 }}>
                    <div className="field">
                      <label htmlFor="sa-handloom">Handloom ref</label>
                      <input id="sa-handloom" value={handloomRef} onChange={(e) => setHandloomRef(e.target.value)} placeholder="e.g. HL-118" />
                    </div>
                  </div>
                )}
              </>
            )}

            {steps.length > 0 && (
              <div className="path-flow" role="group" aria-label="Sampling steps">
                <span className="path-flow-label">Steps</span>
                {steps.map((s, i) => (
                  <span key={s} className={`path-flow-step${i === steps.length - 1 ? " qc" : ""}`}>{s}</span>
                ))}
              </div>
            )}

            <div className="sum-title">Sample details</div>
            <div className="field-row-3">
              <div className="field">
                <label htmlFor="sa-vendor">Vendor</label>
                <input id="sa-vendor" list="sa-vendors" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Ananta Fabrics" />
                <datalist id="sa-vendors">{vendorSuggestions.map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="field">
                <label htmlFor="sa-quality">Quality name</label>
                <input id="sa-quality" list="sa-qualities" value={quality} onChange={(e) => setQuality(e.target.value)} placeholder="e.g. Innova" />
                <datalist id="sa-qualities">{qualitySuggestions.map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="field">
                <label htmlFor="sa-design">Vendor design no</label>
                <input id="sa-design" value={designNo} onChange={(e) => setDesignNo(e.target.value)} placeholder="e.g. 3100" />
              </div>
            </div>
            <div className="field-row-3">
              <div className="field">
                <label htmlFor="sa-merchant">Selling merchant no</label>
                <input id="sa-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. SM-204" />
              </div>
              <div className="field">
                <label htmlFor="sa-date">Sample date</label>
                <input id="sa-date" type="date" value={sampleDate} onChange={(e) => setSampleDate(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="sa-remark">Remark</label>
                <input id="sa-remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="optional" />
              </div>
            </div>
          </div>

          <div className="modal-foot">
            <span className="amt-preview">Saved as <b className="mono">Pending</b> — approve it to raise a PO</span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || (submitted && !valid)}>
                {saving ? "Saving…" : "Create sample"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
