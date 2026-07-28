"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { usePagePrimaryAction, usePageSearchInput } from "@/components/experience/CommandProvider";
import { QcWizardModal, type QcProgramOption } from "./QcWizardModal";
import { fetchQcInspections, submitQcInspection } from "@/lib/qc-inspection";
import { fetchProgramCards } from "@/lib/program-cards";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fetchFabricReceipts } from "@/lib/fabric-receipts";
import { CYCLE_ORIGINAL, CYCLE_REISSUE, CYCLE_LABEL, isReissue, ofCycle } from "@/lib/cycle";
import { fmtDate, fmtNum } from "@/lib/format";
import { QC_OKAY, QC_REISSUE, QC_SHORT, isOkayStatus, remainingForQc } from "@/lib/qc-status";
import type { ProgramCard, PurchaseOrder, QcInspection, QcResult, QcSubmitInput } from "@/lib/types";

export function QcInspectionClient({
  initialInspections,
  initialPrograms,
  initialPos,
}: {
  initialInspections: QcInspection[];
  initialPrograms: ProgramCard[];
  initialPos: PurchaseOrder[];
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: inspections = [], isFetching } = useQuery({
    queryKey: ["qc_inspections"],
    queryFn: fetchQcInspections,
    initialData: initialInspections,
  });
  const { data: programs = [] } = useQuery({
    queryKey: ["program_cards"],
    queryFn: fetchProgramCards,
    initialData: initialPrograms,
  });
  const { data: pos = [] } = useQuery({
    queryKey: ["purchase_orders"],
    queryFn: fetchPurchaseOrders,
    initialData: initialPos,
  });
  // Stage 7 receipts set the reissue leg's QC target.
  const { data: receipts = [] } = useQuery({ queryKey: ["fabric_receipts"], queryFn: fetchFabricReceipts });

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | QcResult>("all");
  const [wizardOpen, setWizardOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  usePagePrimaryAction("Start QC", useCallback(() => setWizardOpen(true), []));

  const poByUid = useMemo(() => {
    const m: Record<string, PurchaseOrder> = {};
    for (const p of pos) m[p.unique_id] = p;
    return m;
  }, [pos]);

  /* QC is incremental: a lot is NOT finished after one inspection. Metres accounted for
     per lot = Σ (good + reissue) across its rows, and the lot stays available until
     remainingForQC hits zero. Keyed by lot_no, because several inspection events over
     weeks all belong to the same lot. */
  /* Scoped by (lot, cycle): the two tracks run concurrently on the same lot, so mixing
     them would close the original lot when the reissue loop finishes. */
  const accountedByLotCycle = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of inspections) {
      if (!r.lot_no) continue;
      const k = `${r.lot_no}||${r.cycle ?? CYCLE_ORIGINAL}`;
      m[k] = (m[k] ?? 0) + (r.passed_qty ?? 0) + (r.failed_qty ?? 0);
    }
    return m;
  }, [inspections]);

  /** The reissue leg's target: metres that came back at Stage 7. */
  const reissueReceivedByLot = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of ofCycle(receipts, CYCLE_REISSUE)) {
      if (r.lot_no) m[r.lot_no] = (m[r.lot_no] ?? 0) + (r.received_meters ?? 0);
    }
    return m;
  }, [receipts]);

  const availablePrograms = useMemo<QcProgramOption[]>(
    () =>
      programs
        .map((c) => {
          const po = poByUid[c.po_unique_id];
          const lot = c.lot_no;
          const origTarget = c.total_meters ?? 0;
          const origDone = lot ? accountedByLotCycle[`${lot}||${CYCLE_ORIGINAL}`] ?? 0 : 0;
          const reTarget = lot ? reissueReceivedByLot[lot] ?? 0 : 0;
          const reDone = lot ? accountedByLotCycle[`${lot}||${CYCLE_REISSUE}`] ?? 0 : 0;
          return {
            id: c.id,
            program_uid: c.program_uid,
            lot_no: lot,
            po_unique_id: c.po_unique_id,
            po_no: po?.po_no ?? null,
            vendor: po?.vendor_name ?? null,
            remainingForQc: remainingForQc(origTarget, origDone, 0),
            remainingForReissueQc: remainingForQc(reTarget, reDone, 0),
          };
        })
        // Offered if EITHER leg still has metres to account for; the wizard filters to
        // the leg being inspected.
        .filter((o) => o.remainingForQc > 0 || o.remainingForReissueQc > 0),
    [programs, accountedByLotCycle, reissueReceivedByLot, poByUid],
  );

  const okayCount = useMemo(() => inspections.filter((r) => isOkayStatus(r.overall_status)).length, [inspections]);
  const reissueCount = inspections.length - okayCount;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = inspections;
    if (view !== "all") list = list.filter((r) => r.overall_status === view);
    if (!q) return list;
    return list.filter((r) =>
      [r.program_uid, r.lot_no, r.design_no].some((f) => (f ?? "").toLowerCase().includes(q)),
    );
  }, [inspections, view, search]);

  const submitM = useMutation({
    mutationFn: (input: QcSubmitInput) => submitQcInspection(input),
    onSuccess: (res) => {
      const extra = [res.warehouse ? `${res.warehouse} stored` : "", res.reissue ? `${res.reissue} reissued` : ""]
        .filter(Boolean)
        .join(" · ");
      toast.success(`QC recorded — ${res.qc} checklist${extra ? ` · ${extra}` : ""}`);
      qc.invalidateQueries({ queryKey: ["qc_inspections"] });
      qc.invalidateQueries({ queryKey: ["qc_lots"] }); // hides the lot on Dyeing Queue + Program Cards
      setWizardOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasData = inspections.length > 0;

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>QC Inspection</h1>
          <p>Incremental quality check — a lot closes only when nothing remains for QC</p>
        </div>
        <button className="btn btn-primary" onClick={() => setWizardOpen(true)}>
          <Icon name="checkCircle" />Start QC
        </button>
      </div>

      <div className="toolbar split">
        <div className="seg" role="group" aria-label="Filter by result">
          <button className={view === "all" ? "on" : ""} aria-pressed={view === "all"} onClick={() => setView("all")}>
            All <span className="cnt mono">{inspections.length}</span>
          </button>
          <button className={view === QC_OKAY ? "on" : ""} aria-pressed={view === QC_OKAY} onClick={() => setView(QC_OKAY)}>
            {QC_OKAY} <span className="cnt mono">{okayCount}</span>
          </button>
          <button className={view === QC_REISSUE ? "on" : ""} aria-pressed={view === QC_REISSUE} onClick={() => setView(QC_REISSUE)}>
            {QC_REISSUE} <span className="cnt mono">{reissueCount}</span>
          </button>
        </div>
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder="Search program, lot, design…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isFetching && <span className="fetching">Updating…</span>}
      </div>

      <div className="table-wrap">
        {rows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Program</th>
                  <th>Lot</th>
                  <th>Design</th>
                  <th>Track</th>
                  <th>Actually found</th>
                  <th className="num">Good Qty</th>
                  <th className="num">Reissue Qty</th>
                  <th>Status</th>
                  <th>Remark</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><span className="dim">{fmtDate(r.checked_date ?? r.created_at)}</span></td>
                    <td><span className="strong mono">{r.program_uid ?? "—"}</span></td>
                    <td><span className="mono">{r.lot_no ?? "—"}</span></td>
                    <td><span className="mono">{r.design_no ?? "—"}</span></td>
                    <td>
                      <span className={`pill ${isReissue(r.cycle) ? "brand" : "plain"}`}>
                        {CYCLE_LABEL[r.cycle ?? CYCLE_ORIGINAL]}
                      </span>
                    </td>
                    <td>
                      {r.actual_design_no || r.actual_color || r.actual_qty != null ? (
                        <span className="dim">
                          <span className="mono">{r.actual_design_no ?? "—"}</span>
                          {r.actual_color ? ` · ${r.actual_color}` : ""}
                          {r.actual_qty != null ? ` · ${fmtNum(r.actual_qty)} m` : ""}
                        </span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="num mono">{fmtNum(r.passed_qty)}</td>
                    <td className="num mono">{fmtNum(r.failed_qty)}</td>
                    <td>
                      <span
                        className={`pill ${isOkayStatus(r.overall_status) ? "success" : "danger"}`}
                        title={r.overall_status ?? undefined}
                      >
                        {QC_SHORT[r.overall_status ?? ""] ?? r.overall_status ?? "—"}
                      </span>
                    </td>
                    <td><span className="dim">{r.remark ?? "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="ph-icon"><Icon name="checkCircle" size={26} /></div>
            <h3>{hasData ? "No matching inspections" : "No QC inspections yet"}</h3>
            <p>
              {hasData
                ? "Try a different search or filter."
                : "Start a QC inspection on a dyed lot — passed fabric goes to the warehouse, failures go to reissue."}
            </p>
            {!hasData && (
              <button className="btn btn-primary" onClick={() => setWizardOpen(true)}>
                <Icon name="checkCircle" />Start QC
              </button>
            )}
          </div>
        )}
      </div>

      {wizardOpen && (
        <QcWizardModal
          programs={availablePrograms}
          saving={submitM.isPending}
          onClose={() => setWizardOpen(false)}
          onSubmit={(input) => submitM.mutate(input)}
        />
      )}
    </>
  );
}
