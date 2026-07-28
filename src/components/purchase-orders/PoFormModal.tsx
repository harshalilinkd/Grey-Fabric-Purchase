"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { GRID_NAV_HINT_GROWS, useGridNav } from "@/lib/use-grid-nav";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { fetchPoColorVariants } from "@/lib/purchase-orders";
import { variantCode } from "@/lib/po-meta";
import {
  CHECKS_METHODS, DIRECT_SUBTYPES, ORDER_PO_BRANCHES, SOURCES,
  goesToDyeing, isFinishedGoodsPath, sourceOf, sourcingFlow,
  type SourceKind, type SourcingPath,
} from "@/lib/po-meta";
import { addCalendarDays, fmtAmount, fmtNum, round2 } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PoFormValues, PurchaseOrder } from "@/lib/types";

const EMPTY: PoFormValues = {
  vendor_name: "",
  dying_house_name: "",
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
  // The supplier bills in bulk; the operator unpicks it into per-colour meterage here.
  variants: [{ code: "A", color_name: "", meters: "" }],
};

function fromPo(po: PurchaseOrder): PoFormValues {
  return {
    vendor_name: po.vendor_name ?? "",
    dying_house_name: po.dying_house_name ?? "",
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
    // seeded from po_color_variants once they load (see the effect below)
    variants: [{ code: "A", color_name: "", meters: "" }],
  };
}

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const intOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = parseInt(t, 10);
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
  dyeingHouseSuggestions = [],
}: {
  open: boolean;
  editing: PurchaseOrder | null;
  onClose: () => void;
  onSave: (values: PoFormValues) => void;
  saving: boolean;
  qualitySuggestions: string[];
  vendorSuggestions?: string[];
  processSuggestions?: string[];
  dyeingHouseSuggestions?: string[];
}) {
  const [v, setV] = useState<PoFormValues>(EMPTY);
  /** Which of the 4 sources is picked. Order PO then asks for its branch, which is what
   *  `sourcing_path` actually stores — so this can be set while the path is still blank. */
  const [source, setSource] = useState<SourceKind | "">("");
  const [submitted, setSubmitted] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setV(editing ? fromPo(editing) : EMPTY);
      setSource(editing ? sourceOf(editing.sourcing_path) : "");
      setSubmitted(false);
      const id = requestAnimationFrame(() => firstFieldRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open, editing]);

  // Editing: load the PO's saved colour split so it can be adjusted rather than retyped.
  const variantsQ = useQuery({
    queryKey: ["po-variants", editing?.id],
    queryFn: () => fetchPoColorVariants(editing!.id),
    enabled: open && !!editing?.id,
  });
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !editing?.id || !variantsQ.data || seededFor.current === editing.id) return;
    seededFor.current = editing.id;
    if (variantsQ.data.length) {
      setV((p) => ({
        ...p,
        variants: variantsQ.data.map((x, i) => ({
          code: x.code ?? variantCode(i),
          color_name: x.color_name ?? "",
          meters: x.meters?.toString() ?? "",
        })),
      }));
    }
  }, [open, editing, variantsQ.data]);
  useEffect(() => {
    if (!open) seededFor.current = null;
  }, [open]);

  useEscClose(open, onClose);

  const set = (k: keyof PoFormValues) => (e: ChangeEvent<HTMLInputElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  /** Apply a stored branch value ("" while Order PO waits for its branch to be picked). */
  const applyPath = (path: SourcingPath | "") =>
    setV((p) => ({
      ...p,
      sourcing_path: path,
      sampling_status:
        path === "direct_purchase" || path === "imported" ? "not_required" : p.sampling_status === "approved" ? "approved" : "pending",
      // finished goods never reach a dyeing house
      dying_house_name: isFinishedGoodsPath(path) ? "" : p.dying_house_name,
      cad_ref: path === "checks_weaves" ? p.cad_ref : "",
      handloom_ref: path === "checks_weaves" ? p.handloom_ref : "",
      checks_method: path === "checks_weaves" ? p.checks_method : "",
      weaving_design: path === "checks_weaves" ? p.weaving_design : "",
      direct_subtype: path === "direct_purchase" ? p.direct_subtype : "",
    }));

  /** Pick one of the 4 sources. Order PO stores nothing yet — its branch does that;
   *  re-picking it keeps the branch already chosen. The other three ARE their path. */
  const selectSource = (kind: SourceKind) => {
    setSource(kind);
    if (kind !== "order_po") applyPath(kind);
    else if (sourceOf(v.sourcing_path) !== "order_po") applyPath("");
  };

  const q = num(v.quantity);
  const r = num(v.rate);
  const amount = q != null && r != null ? round2(q * r) : null;

  // One PO → one dyeing house. Hidden on finished goods (they never reach one); required
  // once a dyeing path is picked. A path-less PO stays saveable, as before.
  // The quality dropdown is the master list; keep an existing PO's value even if that
  // entry has since been deactivated, so editing can't silently blank it.
  const qualityOptions = useMemo(() => {
    const set = new Set(qualitySuggestions);
    if (v.quality_name) set.add(v.quality_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [qualitySuggestions, v.quality_name]);

  const showDyeingHouse = !isFinishedGoodsPath(v.sourcing_path);
  const needsDyeingHouse = goesToDyeing(v.sourcing_path);
  // Derived at Stage 1: when the grey is planned to arrive (order date + delivery days).
  const plannedGrey = addCalendarDays(v.order_date, intOrNull(v.delivery_days));

  /* The colour breakdown: the supplier bills in bulk, so the operator unpicks the order
     into exact metres per colour variant. Codes are auto A/B/C by row position. */
  const setVariant = (i: number, field: "color_name" | "meters", value: string) =>
    setV((p) => ({ ...p, variants: p.variants.map((x, idx) => (idx === i ? { ...x, [field]: value } : x)) }));
  const addVariant = () =>
    setV((p) => ({ ...p, variants: [...p.variants, { code: variantCode(p.variants.length), color_name: "", meters: "" }] }));
  const removeVariant = (i: number) =>
    setV((p) => ({ ...p, variants: p.variants.length > 1 ? p.variants.filter((_, idx) => idx !== i) : p.variants }));

  /* Spreadsheet keyboard nav for the colour grid — see `use-grid-nav.ts`. */
  const cellId = (field: "name" | "meters", row: number) => `po-variant-${field}-${row}`;
  const { onCellKeyDown } = useGridNav<"name" | "meters">({
    cellId,
    rowCount: v.variants.length,
    onAppendRow: addVariant,
  });

  const filledVariants = useMemo(
    () => v.variants.filter((x) => x.color_name.trim() !== "" || num(x.meters) != null),
    [v.variants],
  );
  const allocated = useMemo(
    () => round2(v.variants.reduce((s, x) => s + (num(x.meters) ?? 0), 0)),
    [v.variants],
  );
  const allocState = q == null || allocated === 0 ? "" : round2(allocated) === round2(q) ? "ok" : "warn";
  /** Live projected cost from the broken-down metres — display only; `amount` is a
   *  generated column and never travels in the payload. */
  const projected = r == null ? null : round2(allocated * r);

  // Required: vendor + design no + dyeing house + the internal identifiers (the forcing
  // functions downstream relies on) + quantity + rate + at least one colour variant.
  const missing = {
    // Order PO is the only source with a branch — and it must be resolved, since the two
    // routes diverge downstream (our grey fabric vs. the client's own cloth).
    sourcing_branch: source === "order_po" && !v.sourcing_path,
    vendor_name: !v.vendor_name.trim(),
    vendor_design_no: !v.vendor_design_no.trim(),
    dying_house_name: needsDyeingHouse && !v.dying_house_name.trim(),
    quality_name: !v.quality_name.trim(),
    selling_merchant_no: !v.selling_merchant_no.trim(),
    quantity: q == null,
    rate: r == null,
    variants: filledVariants.length === 0 || filledVariants.some((x) => x.color_name.trim() === "" || num(x.meters) == null),
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
            <p>One adaptive form — pick the source this order came from</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="modal-body">
            {/* SOURCE — the 4 ways a PO gets raised. Order PO then asks which branch. */}
            <div className="sum-title" style={{ marginTop: 0 }}>Source</div>
            <div className="path-pills" role="group" aria-label="Source">
              {SOURCES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`path-pill${source === s.value ? " on" : ""}`}
                  aria-pressed={source === s.value}
                  onClick={() => selectSource(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {source && <p className="path-blurb">{SOURCES.find((s) => s.value === source)?.blurb}</p>}

            {/* ORDER PO — our own grey fabric, or fabric the client supplies for finishing */}
            {source === "order_po" && (
              <>
                <div className="sum-title">Order PO route *</div>
                <div className="path-pills" role="group" aria-label="Order PO route">
                  {ORDER_PO_BRANCHES.map((b) => (
                    <button
                      key={b.value}
                      type="button"
                      className={`path-pill${v.sourcing_path === b.value ? " on" : ""}`}
                      aria-pressed={v.sourcing_path === b.value}
                      onClick={() => applyPath(b.value)}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
                {v.sourcing_path
                  ? <p className="path-blurb">{ORDER_PO_BRANCHES.find((b) => b.value === v.sourcing_path)?.blurb}</p>
                  : reqErr("sourcing_branch") && <span className="field-err">Pick the route — grey fabric, or client-supplied fabric.</span>}
              </>
            )}

            {v.sourcing_path && (
              <div className="path-flow" role="group" aria-label="The flow this order follows">
                <span className="path-flow-label">Flow</span>
                {sourcingFlow(v.sourcing_path, { direct_subtype: v.direct_subtype }).map((step, i) => (
                  <Fragment key={step}>
                    {i > 0 && <span className="path-flow-arrow" aria-hidden="true">→</span>}
                    <span className={`path-flow-step${step === "QC" ? " qc" : step === "PO" ? " po" : ""}`}>{step}</span>
                  </Fragment>
                ))}
              </div>
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
            {showDyeingHouse && (
              <div className="field-row-3">
                <div className="field">
                  <label htmlFor="po-dhouse">Dyeing house {needsDyeingHouse && "*"}</label>
                  <input
                    id="po-dhouse"
                    list="po-dhouses"
                    value={v.dying_house_name}
                    onChange={set("dying_house_name")}
                    placeholder="e.g. Shree Processors"
                    aria-invalid={reqErr("dying_house_name") || undefined}
                  />
                  <datalist id="po-dhouses">{dyeingHouseSuggestions.map((h) => <option key={h} value={h} />)}</datalist>
                  {reqErr("dying_house_name")
                    ? <span className="field-err">Required — one PO goes to one dyeing house.</span>
                    : <span className="field-hint">Fixed for the whole order — one PO goes to one dyeing house.</span>}
                </div>
              </div>
            )}
            <div className="field-row-3">
              <div className="field">
                <label htmlFor="po-qname">Quality name (internal) *</label>
                <select
                  id="po-qname"
                  value={v.quality_name}
                  onChange={(e) => setV((p) => ({ ...p, quality_name: e.target.value }))}
                  aria-invalid={reqErr("quality_name") || undefined}
                >
                  <option value="">Select a quality name…</option>
                  {qualityOptions.map((qn) => <option key={qn} value={qn}>{qn}</option>)}
                </select>
                {reqErr("quality_name")
                  ? <span className="field-err">Required — name the fabric at PO time, not when it arrives.</span>
                  : <span className="field-hint">Manage this list in Settings → Master Lists</span>}
              </div>
              <div className="field">
                <label htmlFor="po-merchant">Selling merchant no *</label>
                <input id="po-merchant" value={v.selling_merchant_no} onChange={set("selling_merchant_no")} placeholder="e.g. SM-204" aria-invalid={reqErr("selling_merchant_no") || undefined} />
                {reqErr("selling_merchant_no") && <span className="field-err">Required — which merchant/brand this fabric sells under.</span>}
              </div>
              <div className="field">
                <label htmlFor="po-vdesign">Vendor design no *</label>
                <input id="po-vdesign" value={v.vendor_design_no} onChange={set("vendor_design_no")} placeholder="e.g. 3100" aria-invalid={reqErr("vendor_design_no") || undefined} />
                {reqErr("vendor_design_no") && <span className="field-err">Required — the supplier&apos;s own design reference.</span>}
              </div>
            </div>
            <div className="field-row-3">
              <div className="field"><label htmlFor="po-date">Order date</label><input id="po-date" type="date" value={v.order_date} onChange={set("order_date")} /></div>
              <div className="field"><label htmlFor="po-on">Order no</label><input id="po-on" value={v.order_no} onChange={set("order_no")} placeholder="193" /></div>
              <div className="field"><label htmlFor="po-no">PO no</label><input id="po-no" value={v.po_no} onChange={set("po_no")} placeholder="10154" /></div>
            </div>
            <div className="field-row-3">
              <div className="field">
                <label htmlFor="po-dd">Delivery days</label>
                <input id="po-dd" type="number" value={v.delivery_days} onChange={set("delivery_days")} placeholder="45" />
                <span className="field-hint">
                  {showDyeingHouse ? "Planned grey arrival" : "Planned arrival"}: <b className="mono">{plannedGrey}</b>
                </span>
              </div>
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

            {/* COLOUR BREAKDOWN — the supplier bills in bulk; split it per colour here */}
            <div className="pcd-head" style={{ marginTop: 18 }}>
              <div className="sum-title" style={{ marginTop: 0 }}>Colour breakdown *</div>
              <span className={`alloc ${allocState}`} role="status" aria-live="polite">
                {fmtNum(allocated)}{q != null ? ` of ${fmtNum(q)}` : ""} m allocated
                {projected != null && allocated > 0 ? ` · ${fmtAmount(projected)}` : ""}
              </span>
            </div>
            <div className="design-rows">
              <div className="design-row design-row-head" aria-hidden="true">
                <span>Code</span><span>Colour name</span><span>Metres</span><span />
              </div>
              {v.variants.map((row, i) => (
                <div className="design-row" key={i}>
                  <input className="di code" value={variantCode(i)} readOnly tabIndex={-1} aria-label={`Colour code ${variantCode(i)}`} />
                  <input
                    id={cellId("name", i)}
                    className="di"
                    value={row.color_name}
                    onChange={(e) => setVariant(i, "color_name", e.target.value)}
                    onKeyDown={onCellKeyDown("name", i)}
                    placeholder="e.g. Royal Blue"
                    aria-label={`Colour name for variant ${variantCode(i)}`}
                  />
                  <input
                    id={cellId("meters", i)}
                    className="di"
                    type="number"
                    step="any"
                    value={row.meters}
                    onChange={(e) => setVariant(i, "meters", e.target.value)}
                    onKeyDown={onCellKeyDown("meters", i)}
                    placeholder="400"
                    aria-label={`Metres for variant ${variantCode(i)}`}
                  />
                  <button
                    type="button"
                    className="lot-del"
                    onClick={() => removeVariant(i)}
                    disabled={v.variants.length === 1}
                    title="Remove this colour"
                    aria-label={`Remove colour ${variantCode(i)}`}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
            <div className="grid-actions">
              <button type="button" className="act" onClick={addVariant}>
                <Icon name="plus" size={15} />Add colour
              </button>
              <span className="field-hint">{GRID_NAV_HINT_GROWS}</span>
            </div>
            {reqErr("variants") && (
              <span className="field-err">Every colour needs a name and its metres — this is what stops a bulk order arriving as a mystery box.</span>
            )}

            <div className="subtle-note">
              <Icon name="info" size={16} />
              <span>Amount auto-calculates (quantity × rate) and is stored by the database — it is never sent in the payload. Required fields are marked *.</span>
            </div>
          </div>

          <div className="modal-foot">
            <span className="amt-preview">Amount: <b className="mono">{amount == null ? "—" : fmtAmount(amount)}</b></span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || (submitted && !isValid)}>
                {saving ? "Saving…" : editing ? "Save changes" : "Generate PO"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
