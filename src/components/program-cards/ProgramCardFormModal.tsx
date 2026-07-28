"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { fetchPoColorVariants } from "@/lib/purchase-orders";
import { variantCode } from "@/lib/po-meta";
import { fmtNum, round2 } from "@/lib/format";
import { workingDaysLabel } from "@/lib/working-days";
import { useEscClose } from "@/lib/use-esc-close";
import { GRID_NAV_HINT_GROWS, useGridNav } from "@/lib/use-grid-nav";
import type { ProgramCardDesignInput, ProgramCardFormValues } from "@/lib/types";

/** A lot that has a shipment but no program card yet — offered in the lot dropdown. */
export type AvailableLot = {
  lot_no: string;
  po_unique_id: string;
  po_id: string | null;
  po_no: string | null;
  vendor: string | null;
  /** The PO's dyeing house — one PO goes to one dyeing house, so the card inherits it. */
  dying_house_name: string | null;
  /** Metres in this lot (the shipment's sent quantity) — one PO can span several lots. */
  lot_meters: number | null;
};

/** Card-level colour, exactly as the business writes it. */
const COLOR_MULTIPLE = "Multiple";
const COLOR_NONE = "-";

/** UI row: the design fields + a stable React key so uncontrolled file inputs don't desync
 *  on insert/remove, + the metres this colour was authorised for on the PO (placeholder only). */
type DesignRow = ProgramCardDesignInput & { _key: number; poMeters?: number | null };

const todayISO = () => new Date().toISOString().slice(0, 10);
let rowSeq = 0;
const emptyDesign = (): DesignRow => ({ _key: (rowSeq += 1), design_no: "", color: "", meter: "", file: null });

/** The keyboard-navigable cells of a design row (the file input is excluded on purpose). */
type PcCell = "dno" | "dcol" | "dm";
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
  holidays = [],
}: {
  open: boolean;
  availableLots: AvailableLot[];
  nextProgramId: string;
  saving: boolean;
  onClose: () => void;
  onSave: (values: ProgramCardFormValues) => void;
  dyeingHouseSuggestions?: string[];
  /** Holiday dates (YYYY-MM-DD) — skipped when counting the dyeing lead time. */
  holidays?: string[];
}) {
  const [vendor, setVendor] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [dyeing, setDyeing] = useState("");
  const [programDate, setProgramDate] = useState(todayISO());
  const [totalMeters, setTotalMeters] = useState("");
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
    // The dyeing house is fixed on the PO — inherit it, but leave it editable.
    if (l?.dying_house_name) setDyeing(l.dying_house_name);
    if (l?.lot_meters != null) setTotalMeters(String(l.lot_meters));
  };

  /* The colours were authorised at PO time. Pull them through rather than making the
     operator retype them — that double entry is where colour names drift, and a drifted
     name is exactly the "mystery box" the PO breakdown exists to prevent. */
  const variantsQ = useQuery({
    queryKey: ["po-variants", selectedLot?.po_id],
    queryFn: () => fetchPoColorVariants(selectedLot!.po_id!),
    enabled: open && !!selectedLot?.po_id,
  });

  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { seededFor.current = null; return; }
    const key = selectedLot ? `${selectedLot.po_id}__${selectedLot.lot_no}` : null;
    if (!key || !variantsQ.data?.length || seededFor.current === key) return;
    seededFor.current = key;

    const poTotal = round2(variantsQ.data.reduce((s, x) => s + (x.meters ?? 0), 0));
    const lotMeters = selectedLot?.lot_meters ?? null;
    /* Metres only carry across when this lot IS the whole PO. A PO is routinely split
       across several lots, so copying the full breakdown into one lot would over-allocate
       it. When they differ, the colours come through and the authorised figure shows as a
       placeholder for the operator to distribute against. */
    const sameScope = lotMeters != null && round2(lotMeters) === poTotal;

    setDesigns(
      variantsQ.data.map((x, i) => ({
        _key: (rowSeq += 1),
        design_no: x.code ?? variantCode(i),
        color: x.color_name ?? "",
        meter: sameScope && x.meters != null ? String(x.meters) : "",
        poMeters: x.meters ?? null,
        file: null,
      })),
    );
    if (lotMeters == null) setTotalMeters(String(poTotal));
  }, [open, selectedLot, variantsQ.data]);

  const cuttingTotal = useMemo(() => designs.reduce((s, d) => s + (Number(d.meter) || 0), 0), [designs]);
  const filled = useMemo(() => designs.filter(hasContent), [designs]);
  const filledCount = filled.length;

  /** Card-level colour: the single colour name, "Multiple", or "-" when nothing is named. */
  const derivedColor = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of designs) {
      const name = d.color.trim();
      if (name) seen.set(name.toLowerCase(), name);
    }
    if (seen.size === 0) return COLOR_NONE;
    if (seen.size === 1) return [...seen.values()][0];
    return COLOR_MULTIPLE;
  }, [designs]);

  const seededFromPo = designs.some((d) => d.poMeters != null);
  const needsDistribution = seededFromPo && designs.every((d) => d.meter.trim() === "");

  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const plannedReturn = workingDaysLabel(programDate, Number(deliveryDays) || null, holidaySet);

  /* Spreadsheet keyboard nav — see `use-grid-nav.ts`. The ids here must stay in step with
     the inputs' own ids. The cutting file input is deliberately left out: Enter on a file
     picker should open it, not jump rows.

     ⚠️ MUST stay above the `if (!open)` early return — useGridNav calls useRef/useEffect, and
     a hook after a conditional return changes the hook order between renders. */
  const addRow = () => setDesigns((rows) => [...rows, emptyDesign()]);
  const cellId = (field: PcCell, row: number) => `pc-${field}-${row}`;
  const { onCellKeyDown } = useGridNav<PcCell>({ cellId, rowCount: designs.length, onAppendRow: addRow });

  if (!open) return null;

  const setDesignNo = (i: number) => (e: ChangeEvent<HTMLInputElement>) =>
    setDesigns((rows) => rows.map((r, idx) => (idx === i ? { ...r, design_no: e.target.value } : r)));
  const setColor = (i: number) => (e: ChangeEvent<HTMLInputElement>) =>
    setDesigns((rows) => rows.map((r, idx) => (idx === i ? { ...r, color: e.target.value } : r)));
  const setMeter = (i: number) => (e: ChangeEvent<HTMLInputElement>) =>
    setDesigns((rows) => rows.map((r, idx) => (idx === i ? { ...r, meter: e.target.value } : r)));
  const setFile = (i: number) => (e: ChangeEvent<HTMLInputElement>) =>
    setDesigns((rows) => rows.map((r, idx) => (idx === i ? { ...r, file: e.target.files?.[0] ?? null } : r)));
  const removeRow = (i: number) => setDesigns((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));

  const total = Number(totalMeters);
  const totalValid = totalMeters.trim() !== "" && Number.isFinite(total) && total > 0;
  const balanced = totalValid && round2(cuttingTotal) === round2(total);
  const allocState = balanced ? "ok" : cuttingTotal > 0 && totalValid ? "warn" : "";

  /* Gate rules — the card cannot be created unless all of these hold:
     · design-line metres sum EXACTLY to the card total
     · every design line names a colour
     · every non-White colour carries a cutting (White needs none) */
  const missingColor = filled.filter((d) => d.color.trim() === "").length;
  const missingCutting = filled.filter((d) => d.color.trim() !== "" && !isWhite(d.color) && !d.file).length;
  const blockers: string[] = [];
  if (!selectedLot) blockers.push("Select the lot this program is for.");
  if (!dyeing.trim()) blockers.push("Pick the dyeing house.");
  if (!totalValid) blockers.push("Enter the card's total metres.");
  if (filledCount === 0) blockers.push("Add at least one design line.");
  if (totalValid && filledCount > 0 && !balanced)
    blockers.push(`Design metres must total exactly ${fmtNum(total)} m — currently ${fmtNum(cuttingTotal)} m.`);
  if (missingColor > 0) blockers.push(`${missingColor} design line${missingColor === 1 ? "" : "s"} without a colour.`);
  if (missingCutting > 0)
    blockers.push(`${missingCutting} non-White colour${missingCutting === 1 ? "" : "s"} without a cutting.`);
  const canSubmit = blockers.length === 0;

  const submit = () => {
    if (!canSubmit || !selectedLot) return;
    onSave({
      lot_no: selectedLot.lot_no,
      po_unique_id: selectedLot.po_unique_id,
      dying_house_name: dyeing,
      program_date: programDate,
      total_meters: totalMeters,
      color: derivedColor,
      delivery_days: deliveryDays,
      color_cutting_attached: cuttingAttached === "Yes",
      designs: designs.map((d) => ({ design_no: d.design_no, color: d.color, meter: d.meter, file: d.file })),
    });
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="New program card">
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
                <input id="pc-color" value={derivedColor} readOnly />
                <span className="field-hint">Auto — &quot;{COLOR_MULTIPLE}&quot;, the single colour name, or &quot;{COLOR_NONE}&quot;</span>
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
                <span className="field-hint">Planned dyeing return: <b className="mono">{plannedReturn}</b> (working days)</span>
              </div>
            </div>

            {/* Design Details */}
            <div className="pcd-section">
              <div className="pcd-head">
                <h4>Design Details</h4>
                <span className={`alloc ${allocState}`} role="status" aria-live="polite">{fmtNum(cuttingTotal)}{total > 0 ? ` of ${fmtNum(total)}` : ""} m allocated</span>
              </div>
              {seededFromPo && (
                <p className="muted-note" style={{ marginTop: -4 }}>
                  Colours pulled from the PO&apos;s authorised breakdown.
                  {needsDistribution
                    ? " This lot is part of the PO, so enter the metres going to dyeing for each colour — the authorised figure is shown in each box."
                    : ""}
                </p>
              )}

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
                        <input id={cellId("dno", i)} value={d.design_no} onChange={setDesignNo(i)} onKeyDown={onCellKeyDown("dno", i)} placeholder="e.g., D-123" />
                      </div>
                      <div className="field">
                        <label htmlFor={`pc-dcol-${i}`}>Design Color</label>
                        <input id={cellId("dcol", i)} value={d.color} onChange={setColor(i)} onKeyDown={onCellKeyDown("dcol", i)} placeholder="e.g., Navy" />
                      </div>
                      <div className="field">
                        <label htmlFor={`pc-dm-${i}`}>Design Meter</label>
                        <input
                          id={cellId("dm", i)}
                          type="number"
                          step="any"
                          value={d.meter}
                          onChange={setMeter(i)}
                          onKeyDown={onCellKeyDown("dm", i)}
                          placeholder={d.poMeters != null ? `PO authorised ${fmtNum(d.poMeters)}` : "e.g., 50"}
                        />
                      </div>
                    </div>

                    <div className="pcd-cut">
                      {isWhite(d.color) ? (
                        <span className="white-note"><Icon name="check" size={13} />White needs no cutting</span>
                      ) : (
                        <>
                          <span className="pcd-cut-label">
                            Color cutting {d.file ? <span className="pcd-cut-opt">(attached)</span> : <span className="pcd-cut-req">(required)</span>}
                          </span>
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
            <span className="field-hint">{GRID_NAV_HINT_GROWS}</span>
          </div>

          <div className="modal-foot">
            <span className="amt-preview">
              {blockers.length > 0
                ? <span className="pcd-blocker">{blockers[0]}</span>
                : selectedLot ? <>PO <b className="mono">{selectedLot.po_no ?? selectedLot.po_unique_id}</b></> : null}
            </span>
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !canSubmit}>
                {saving ? "Saving…" : "Create program"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
