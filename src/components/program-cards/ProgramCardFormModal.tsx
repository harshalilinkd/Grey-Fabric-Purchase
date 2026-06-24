"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { variantCode } from "@/lib/po-meta";
import { fmtNum, round2 } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { ProgramCardDesignInput, ProgramCardFormValues } from "@/lib/types";

/** A lot that has a shipment but no program card yet — offered in the lot dropdown. */
export type AvailableLot = {
  lot_no: string;
  po_unique_id: string;
  po_id: string | null;
  po_no: string | null;
  vendor: string | null;
};

/** UI row: the design fields + a stable React key so uncontrolled file inputs don't desync on insert/remove. */
type DesignRow = ProgramCardDesignInput & { _key: number };

const todayISO = () => new Date().toISOString().slice(0, 10);
let rowSeq = 0;
const emptyDesign = (): DesignRow => ({ _key: (rowSeq += 1), design_no: "", color: "", meter: "", file: null });
const isWhite = (c: string) => c.trim().toLowerCase() === "white";
const hasContent = (d: ProgramCardDesignInput) =>
  d.design_no.trim() !== "" || d.color.trim() !== "" || d.meter.trim() !== "" || !!d.file;

export function ProgramCardFormModal({
  open,
  availableLots,
  nextProgramId,
  saving,
  onClose,
  onSave,
  dyeingHouseSuggestions = [],
}: {
  open: boolean;
  availableLots: AvailableLot[];
  nextProgramId: string;
  saving: boolean;
  onClose: () => void;
  onSave: (values: ProgramCardFormValues) => void;
  dyeingHouseSuggestions?: string[];
}) {
  const toast = useToast();
  const [vendor, setVendor] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [dyeing, setDyeing] = useState("");
  const [programDate, setProgramDate] = useState(todayISO());
  const [totalMeters, setTotalMeters] = useState("");
  const [baseColor, setBaseColor] = useState("");
  const [deliveryDays, setDeliveryDays] = useState("");
  const [cuttingAttached, setCuttingAttached] = useState("No");
  const [designs, setDesigns] = useState<DesignRow[]>([emptyDesign()]);

  useEffect(() => {
    if (open) {
      setVendor("");
      setLotNo("");
      setDyeing("");
      setProgramDate(todayISO());
      setTotalMeters("");
      setBaseColor("");
      setDeliveryDays("");
      setCuttingAttached("No");
      setDesigns([emptyDesign()]);
    }
  }, [open]);

  useEscClose(open, onClose);

  // Vendors offered (from the available lots' POs) — picking one narrows the Lot list.
  const vendors = useMemo(() => {
    const set = new Set<string>();
    for (const l of availableLots) if (l.vendor) set.add(l.vendor);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [availableLots]);

  const lotOptions = useMemo(
    () => (vendor ? availableLots.filter((l) => l.vendor === vendor) : availableLots),
    [availableLots, vendor],
  );

  const selectedLot = useMemo(() => availableLots.find((l) => l.lot_no === lotNo) ?? null, [availableLots, lotNo]);

  const onVendorChange = (v: string) => {
    setVendor(v);
    if (v && selectedLot && selectedLot.vendor !== v) setLotNo(""); // drop a lot that no longer matches
  };
  const onLotChange = (lot: string) => {
    setLotNo(lot);
    const l = availableLots.find((x) => x.lot_no === lot);
    if (l?.vendor) setVendor(l.vendor); // keep the vendor field in sync with the chosen lot
  };

  const cuttingTotal = useMemo(() => designs.reduce((s, d) => s + (Number(d.meter) || 0), 0), [designs]);
  const filledCount = useMemo(() => designs.filter(hasContent).length, [designs]);

  if (!open) return null;

  const setDesignNo = (i: number) => (e: ChangeEvent<HTMLInputElement>) =>
    setDesigns((rows) => rows.map((r, idx) => (idx === i ? { ...r, design_no: e.target.value } : r)));
  const setColor = (i: number) => (e: ChangeEvent<HTMLInputElement>) =>
    setDesigns((rows) => rows.map((r, idx) => (idx === i ? { ...r, color: e.target.value } : r)));
  const setMeter = (i: number) => (e: ChangeEvent<HTMLInputElement>) =>
    setDesigns((rows) => rows.map((r, idx) => (idx === i ? { ...r, meter: e.target.value } : r)));
  const setFile = (i: number) => (e: ChangeEvent<HTMLInputElement>) =>
    setDesigns((rows) => rows.map((r, idx) => (idx === i ? { ...r, file: e.target.files?.[0] ?? null } : r)));
  const addRow = () => setDesigns((rows) => [...rows, emptyDesign()]);
  const removeRow = (i: number) => setDesigns((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));

  const total = Number(totalMeters);
  const balanced = total > 0 && round2(cuttingTotal) === round2(total);
  const allocState = balanced ? "ok" : cuttingTotal > 0 && total > 0 ? "warn" : "";

  const submit = () => {
    if (!selectedLot) return;
    if (total > 0 && cuttingTotal > 0 && round2(cuttingTotal) !== round2(total)) {
      toast.warning(`Designs allocate ${fmtNum(cuttingTotal)} m vs ${fmtNum(total)} m total. Saved anyway.`);
    }
    onSave({
      lot_no: selectedLot.lot_no,
      po_unique_id: selectedLot.po_unique_id,
      dying_house_name: dyeing,
      program_date: programDate,
      total_meters: totalMeters,
      color: baseColor,
      delivery_days: deliveryDays,
      color_cutting_attached: cuttingAttached === "Yes",
      designs: designs.map((d) => ({ design_no: d.design_no, color: d.color, meter: d.meter, file: d.file })),
    });
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide pcd-modal" role="dialog" aria-modal="true" aria-label="New program card">
        <div className="modal-head">
          <div>
            <h3>New program card</h3>
            <p>Program ID assigned on save — next is <span className="mono">{nextProgramId}</span></p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="modal-body">
            {/* Row 1 — Date · Vendor Name · Dying House Name */}
            <div className="field-row-3">
              <div className="field">
                <label htmlFor="pc-date">Date</label>
                <input id="pc-date" type="date" value={programDate} onChange={(e) => setProgramDate(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="pc-vendor">Vendor Name</label>
                <select id="pc-vendor" value={vendor} onChange={(e) => onVendorChange(e.target.value)}>
                  <option value="">{vendors.length ? "All vendors" : "No vendors available"}</option>
                  {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pc-dye">Dying House Name</label>
                {dyeingHouseSuggestions.length ? (
                  <select id="pc-dye" value={dyeing} onChange={(e) => setDyeing(e.target.value)}>
                    <option value="">Select dyeing house…</option>
                    {dyeingHouseSuggestions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input id="pc-dye" value={dyeing} onChange={(e) => setDyeing(e.target.value)} placeholder="e.g. Sunrise Dyeing" />
                )}
              </div>
            </div>

            {/* Row 2 — Lot No · Color · Meters */}
            <div className="field-row-3">
              <div className="field">
                <label htmlFor="pc-lot">Lot No</label>
                <select id="pc-lot" value={lotNo} onChange={(e) => onLotChange(e.target.value)}>
                  <option value="">
                    {lotOptions.length ? "Select a lot…" : vendor ? "No lots for this vendor" : "No lots awaiting a program"}
                  </option>
                  {lotOptions.map((l) => (
                    <option key={l.lot_no} value={l.lot_no}>
                      {l.lot_no}{l.po_no ? ` · PO ${l.po_no}` : ""}{!vendor && l.vendor ? ` · ${l.vendor}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pc-color">Color</label>
                <input id="pc-color" value={baseColor} onChange={(e) => setBaseColor(e.target.value)} placeholder="e.g., Royal Blue" />
              </div>
              <div className="field">
                <label htmlFor="pc-meters">Meters</label>
                <input id="pc-meters" type="number" step="any" value={totalMeters} onChange={(e) => setTotalMeters(e.target.value)} placeholder="Enter total meters" />
              </div>
            </div>

            {/* Row 3 — Color Cutting Attached · Total Color Cutting · Delivery Days */}
            <div className="field-row-3">
              <div className="field">
                <label htmlFor="pc-cut-attached">Color Cutting Attached</label>
                <select id="pc-cut-attached" value={cuttingAttached} onChange={(e) => setCuttingAttached(e.target.value)}>
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="pc-cut-total">Total Color Cutting</label>
                <input id="pc-cut-total" value={filledCount || ""} readOnly placeholder="No. of design rows" />
                <span className="field-hint">Auto — number of colour cuttings</span>
              </div>
              <div className="field">
                <label htmlFor="pc-delivery">Delivery Days</label>
                <input id="pc-delivery" type="number" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} placeholder="e.g., 7" />
              </div>
            </div>

            {/* Design Details */}
            <div className="pcd-section">
              <div className="pcd-head">
                <h4>Design Details</h4>
                <span className={`alloc ${allocState}`} role="status" aria-live="polite">{fmtNum(cuttingTotal)}{total > 0 ? ` of ${fmtNum(total)}` : ""} m allocated</span>
              </div>

              <div className="pcd-rows">
                {designs.map((d, i) => (
                  <div className="pcd-row" key={d._key}>
                    <div className="pcd-row-top">
                      <span className="pcd-row-title">Design Row {i + 1}<span className="pcd-code mono">{variantCode(i)}</span></span>
                      <button type="button" className="pcd-del" onClick={() => removeRow(i)} disabled={designs.length === 1} aria-label={`Remove design row ${i + 1}`} title="Remove this design row">
                        <Icon name="trash" size={15} />
                      </button>
                    </div>

                    <div className="pcd-fields">
                      <div className="field">
                        <label htmlFor={`pc-dno-${i}`}>Design No.</label>
                        <input id={`pc-dno-${i}`} value={d.design_no} onChange={setDesignNo(i)} placeholder="e.g., D-123" />
                      </div>
                      <div className="field">
                        <label htmlFor={`pc-dcol-${i}`}>Design Color</label>
                        <input id={`pc-dcol-${i}`} value={d.color} onChange={setColor(i)} placeholder="e.g., Navy" />
                      </div>
                      <div className="field">
                        <label htmlFor={`pc-dm-${i}`}>Design Meter</label>
                        <input id={`pc-dm-${i}`} type="number" step="any" value={d.meter} onChange={setMeter(i)} placeholder="e.g., 50" />
                      </div>
                    </div>

                    <div className="pcd-cut">
                      {isWhite(d.color) ? (
                        <span className="white-note"><Icon name="check" size={13} />White needs no cutting</span>
                      ) : (
                        <>
                          <span className="pcd-cut-label">Color cutting <span className="pcd-cut-opt">(optional)</span></span>
                          <input type="file" accept="image/*,application/pdf" onChange={setFile(i)} aria-label={`Cutting for design row ${i + 1}`} />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pcd-addbar">
            <button type="button" className="pcd-add" onClick={addRow}>
              <Icon name="plus" size={15} />Add design row
            </button>
          </div>

          <div className="modal-foot">
            <span className="amt-preview">
              {selectedLot ? <>PO <b className="mono">{selectedLot.po_no ?? selectedLot.po_unique_id}</b></> : "Select a lot to continue"}
            </span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !selectedLot}>
                {saving ? "Saving…" : "Create program"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
