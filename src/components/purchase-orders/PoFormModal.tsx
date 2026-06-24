"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { CHECKS_METHODS, DIRECT_SUBTYPES, SOURCING_PATHS, type SourcingPath } from "@/lib/po-meta";
import { fmtAmount, round2 } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PoFormValues, PurchaseOrder } from "@/lib/types";

const EMPTY: PoFormValues = {
  vendor_name: "",
  process: "",
  quality: "",
  order_date: "",
  order_no: "",
  po_no: "",
  delivery_days: "",
  quantity: "",
  rate: "",
  sourcing_path: "",
  quality_name: "",
  selling_merchant_no: "",
  vendor_design_no: "",
  sampling_status: "",
  cad_ref: "",
  handloom_ref: "",
  direct_subtype: "",
  checks_method: "",
  weaving_design: "",
  variants: [], // colours are split later (Program Card stage), not on the PO
};

function fromPo(po: PurchaseOrder): PoFormValues {
  return {
    vendor_name: po.vendor_name ?? "",
    process: po.process ?? "",
    quality: po.quality ?? "",
    order_date: po.order_date ?? "",
    order_no: po.order_no ?? "",
    po_no: po.po_no ?? "",
    delivery_days: po.delivery_days?.toString() ?? "",
    quantity: po.quantity?.toString() ?? "",
    rate: po.rate?.toString() ?? "",
    sourcing_path: po.sourcing_path ?? "",
    quality_name: po.quality_name ?? "",
    selling_merchant_no: po.selling_merchant_no ?? "",
    vendor_design_no: po.vendor_design_no ?? "",
    sampling_status: po.sampling_status ?? "",
    cad_ref: po.cad_ref ?? "",
    handloom_ref: po.handloom_ref ?? "",
    direct_subtype: po.direct_subtype ?? "",
    checks_method: po.checks_method ?? "",
    weaving_design: po.weaving_design ?? "",
    variants: [],
  };
}

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function PoFormModal({
  open,
  editing,
  onClose,
  onSave,
  saving,
  qualitySuggestions,
  vendorSuggestions = [],
  processSuggestions = [],
}: {
  open: boolean;
  editing: PurchaseOrder | null;
  onClose: () => void;
  onSave: (values: PoFormValues) => void;
  saving: boolean;
  qualitySuggestions: string[];
  vendorSuggestions?: string[];
  processSuggestions?: string[];
}) {
  const [v, setV] = useState<PoFormValues>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setV(editing ? fromPo(editing) : EMPTY);
      setSubmitted(false);
      const id = requestAnimationFrame(() => firstFieldRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open, editing]);

  useEscClose(open, onClose);

  const set = (k: keyof PoFormValues) => (e: ChangeEvent<HTMLInputElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  const selectPath = (path: SourcingPath) =>
    setV((p) => ({
      ...p,
      sourcing_path: path,
      sampling_status:
        path === "direct_purchase" || path === "imported" ? "not_required" : p.sampling_status === "approved" ? "approved" : "pending",
      cad_ref: path === "checks_weaves" ? p.cad_ref : "",
      handloom_ref: path === "checks_weaves" ? p.handloom_ref : "",
      checks_method: path === "checks_weaves" ? p.checks_method : "",
      weaving_design: path === "checks_weaves" ? p.weaving_design : "",
      direct_subtype: path === "direct_purchase" ? p.direct_subtype : "",
    }));

  const q = num(v.quantity);
  const r = num(v.rate);
  const amount = q != null && r != null ? round2(q * r) : null;

  // Required: the three essentials (vendor + quantity + rate). Everything else optional.
  const missing = {
    vendor_name: !v.vendor_name.trim(),
    quantity: q == null,
    rate: r == null,
  };
  const isValid = !Object.values(missing).some(Boolean);

  if (!open) return null;

  const submit = () => {
    setSubmitted(true);
    if (!isValid) return;
    onSave(v);
  };

  const reqErr = (key: keyof typeof missing) => submitted && missing[key];

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={editing ? "Edit purchase order" : "New purchase order"}>
        <div className="modal-head">
          <div>
            <h3>{editing ? "Edit purchase order" : "New purchase order"}</h3>
            <p>One adaptive form — pick a sourcing path</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="modal-body">
            {/* SOURCING PATH */}
            <div className="sum-title" style={{ marginTop: 0 }}>Sourcing path</div>
            <div className="path-pills" role="group" aria-label="Sourcing path">
              {SOURCING_PATHS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`path-pill${v.sourcing_path === p.value ? " on" : ""}`}
                  aria-pressed={v.sourcing_path === p.value}
                  onClick={() => selectPath(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {v.sourcing_path && (
              <p className="path-blurb">{SOURCING_PATHS.find((p) => p.value === v.sourcing_path)?.blurb}</p>
            )}

            {/* CHECKS & WEAVES — R&D route: CAD → direct order, or Handloom sample → weaving & design → order */}
            {v.sourcing_path === "checks_weaves" && (
              <>
                <div className="sum-title">Checks route</div>
                <div className="path-pills" role="group" aria-label="Check method">
                  {CHECKS_METHODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      className={`path-pill${v.checks_method === m.value ? " on" : ""}`}
                      aria-pressed={v.checks_method === m.value}
                      onClick={() => setV((p) => ({ ...p, checks_method: m.value }))}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {v.checks_method === "cad" && (
                  <div className="field-row-3" style={{ marginTop: 12 }}>
                    <div className="field">
                      <label htmlFor="po-cad">CAD ref</label>
                      <input id="po-cad" value={v.cad_ref} onChange={set("cad_ref")} placeholder="e.g. CAD-2291" />
                    </div>
                  </div>
                )}
                {v.checks_method === "handloom" && (
                  <div className="field-row-3" style={{ marginTop: 12 }}>
                    <div className="field">
                      <label htmlFor="po-handloom">Handloom ref</label>
                      <input id="po-handloom" value={v.handloom_ref} onChange={set("handloom_ref")} placeholder="e.g. HL-118" />
                    </div>
                    <div className="field" style={{ gridColumn: "span 2" }}>
                      <label htmlFor="po-weave">Weaving &amp; design</label>
                      <input id="po-weave" value={v.weaving_design} onChange={set("weaving_design")} placeholder="weave / design note (optional)" />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* DIRECT PURCHASE — new cloth (ready goods) vs old (Milano) */}
            {v.sourcing_path === "direct_purchase" && (
              <>
                <div className="sum-title">Direct purchase</div>
                <div className="path-pills" role="group" aria-label="Cloth type">
                  {DIRECT_SUBTYPES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className={`path-pill${v.direct_subtype === s.value ? " on" : ""}`}
                      aria-pressed={v.direct_subtype === s.value}
                      onClick={() => setV((p) => ({ ...p, direct_subtype: s.value }))}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <p className="path-blurb">Finished cloth bought ready — no dyeing, but QC'd on arrival; only QC-passed metres are stored.</p>
              </>
            )}

            {/* SHARED CORE */}
            <div className="sum-title">Order details</div>
            <div className="field-row-3">
              <div className="field">
                <label htmlFor="po-vendor">Vendor name *</label>
                <input id="po-vendor" list="po-vendors" ref={firstFieldRef} value={v.vendor_name} onChange={set("vendor_name")} placeholder="Ananta Fabrics" aria-invalid={reqErr("vendor_name") || undefined} />
                <datalist id="po-vendors">{vendorSuggestions.map((s) => <option key={s} value={s} />)}</datalist>
                {reqErr("vendor_name") && <span className="field-err">Required.</span>}
              </div>
              <div className="field"><label htmlFor="po-process">Process</label><input id="po-process" list="po-processes" value={v.process} onChange={set("process")} placeholder="e.g. GT Dyeing" /><datalist id="po-processes">{processSuggestions.map((s) => <option key={s} value={s} />)}</datalist></div>
              <div className="field"><label htmlFor="po-quality">Quality</label><input id="po-quality" list="po-qualities" value={v.quality} onChange={set("quality")} placeholder="Cordray Print" /><datalist id="po-qualities">{qualitySuggestions.map((qn) => <option key={qn} value={qn} />)}</datalist></div>
            </div>
            <div className="field-row-3">
              <div className="field"><label htmlFor="po-date">Order date</label><input id="po-date" type="date" value={v.order_date} onChange={set("order_date")} /></div>
              <div className="field"><label htmlFor="po-on">Order no</label><input id="po-on" value={v.order_no} onChange={set("order_no")} placeholder="193" /></div>
              <div className="field"><label htmlFor="po-no">PO no</label><input id="po-no" value={v.po_no} onChange={set("po_no")} placeholder="10154" /></div>
            </div>
            <div className="field-row-3">
              <div className="field"><label htmlFor="po-dd">Delivery days</label><input id="po-dd" type="number" value={v.delivery_days} onChange={set("delivery_days")} placeholder="45" /></div>
              <div className="field">
                <label htmlFor="po-qty">Quantity (m) *</label>
                <input id="po-qty" type="number" step="any" value={v.quantity} onChange={set("quantity")} placeholder="10600" aria-invalid={reqErr("quantity") || undefined} />
                {reqErr("quantity") && <span className="field-err">Required.</span>}
              </div>
              <div className="field">
                <label htmlFor="po-rate">Rate (₹/m) *</label>
                <input id="po-rate" type="number" step="any" value={v.rate} onChange={set("rate")} placeholder="160" aria-invalid={reqErr("rate") || undefined} />
                {reqErr("rate") && <span className="field-err">Required.</span>}
              </div>
            </div>

            <div className="subtle-note">
              <Icon name="info" size={16} />
              <span>Amount auto-calculates (quantity × rate) and is stored by the database. Colours are split later, at the Program Card stage. Required fields are marked *.</span>
            </div>
          </div>

          <div className="modal-foot">
            <span className="amt-preview">Amount: <b className="mono">{amount == null ? "—" : fmtAmount(amount)}</b></span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || (submitted && !isValid)}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create PO"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
