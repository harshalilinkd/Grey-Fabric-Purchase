"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { Icon } from "@/components/ui/Icon";
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
  };
}

export function PoFormModal({
  open,
  editing,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  editing: PurchaseOrder | null;
  onClose: () => void;
  onSave: (values: PoFormValues) => void;
  saving: boolean;
}) {
  const [v, setV] = useState<PoFormValues>(EMPTY);

  useEffect(() => {
    if (open) setV(editing ? fromPo(editing) : EMPTY);
  }, [open, editing]);

  useEscClose(open, onClose);

  if (!open) return null;

  const set = (k: keyof PoFormValues) => (e: ChangeEvent<HTMLInputElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  const q = Number(v.quantity);
  const r = Number(v.rate);
  const amount =
    v.quantity.trim() !== "" && v.rate.trim() !== "" && Number.isFinite(q) && Number.isFinite(r)
      ? round2(q * r)
      : null;

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={editing ? "Edit purchase order" : "New purchase order"}>
        <div className="modal-head">
          <div>
            <h3>{editing ? "Edit purchase order" : "New purchase order"}</h3>
            <p>Grey fabric order from vendor</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
          <div className="modal-body">
            <div className="field-row-3">
              <div className="field"><label>Vendor name</label><input value={v.vendor_name} onChange={set("vendor_name")} placeholder="Ananta Fabrics" /></div>
              <div className="field"><label>Process</label><input value={v.process} onChange={set("process")} placeholder="e.g. GT Dyeing" /></div>
              <div className="field"><label>Quality</label><input value={v.quality} onChange={set("quality")} placeholder="Cordray Print" /></div>
            </div>
            <div className="field-row-3">
              <div className="field"><label>Order date</label><input type="date" value={v.order_date} onChange={set("order_date")} /></div>
              <div className="field"><label>Order no</label><input value={v.order_no} onChange={set("order_no")} placeholder="193" /></div>
              <div className="field"><label>PO no</label><input value={v.po_no} onChange={set("po_no")} placeholder="10154" /></div>
            </div>
            <div className="field-row-3">
              <div className="field"><label>Delivery days</label><input type="number" value={v.delivery_days} onChange={set("delivery_days")} placeholder="45" /></div>
              <div className="field"><label>Quantity (m)</label><input type="number" step="any" value={v.quantity} onChange={set("quantity")} placeholder="10600" /></div>
              <div className="field"><label>Rate (₹/m)</label><input type="number" step="any" value={v.rate} onChange={set("rate")} placeholder="160" /></div>
            </div>
            <div className="subtle-note">
              <Icon name="info" size={16} />
              <span>Amount auto-calculates as quantity × rate (2 decimals) and is stored by the database.</span>
            </div>
          </div>

          <div className="modal-foot">
            <span className="amt-preview">Amount: <b className="mono">{amount == null ? "—" : fmtAmount(amount)}</b></span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save record"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
