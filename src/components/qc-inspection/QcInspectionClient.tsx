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
import { fmtDate, fmtNum } from "@/lib/format";
import type { ProgramCard, PurchaseOrder, QcInspection, QcSubmitInput } from "@/lib/types";

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

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "Passed" | "Failed">("all");
  const [wizardOpen, setWizardOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  usePagePrimaryAction("Start QC", useCallback(() => setWizardOpen(true), []));

  const poByUid = useMemo(() => {
    const m: Record<string, PurchaseOrder> = {};
    for (const p of pos) m[p.unique_id] = p;
    return m;
  }, [pos]);

  // Programs already inspected disappear from the picker (and their lots from Dyeing Queue /
  // Program Cards). Keyed by program_uid (always present + unique) AND lot_no, so a program
  // with a null lot_no can't be re-inspected.
  const inspected = useMemo(() => {
    const uids = new Set<string>();
    const lots = new Set<string>();
    for (const r of inspections) {
      if (r.program_uid) uids.add(r.program_uid);
      if (r.lot_no) lots.add(r.lot_no);
    }
    return { uids, lots };
  }, [inspections]);

  const availablePrograms = useMemo<QcProgramOption[]>(
    () =>
      programs
        .filter((c) => !inspected.uids.has(c.program_uid) && !(c.lot_no && inspected.lots.has(c.lot_no)))
        .map((c) => {
          const po = poByUid[c.po_unique_id];
          return {
            id: c.id,
            program_uid: c.program_uid,
            lot_no: c.lot_no,
            po_unique_id: c.po_unique_id,
            po_no: po?.po_no ?? null,
            vendor: po?.vendor_name ?? null,
          };
        }),
    [programs, inspected, poByUid],
  );

  const passedCount = useMemo(() => inspections.filter((r) => r.overall_status === "Passed").length, [inspections]);
  const failedCount = inspections.length - passedCount;

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
          <p>Quality check on dyed fabric returns — pass to the warehouse or fail to reissue</p>
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
          <button className={view === "Passed" ? "on" : ""} aria-pressed={view === "Passed"} onClick={() => setView("Passed")}>
            Passed <span className="cnt mono">{passedCount}</span>
          </button>
          <button className={view === "Failed" ? "on" : ""} aria-pressed={view === "Failed"} onClick={() => setView("Failed")}>
            Failed <span className="cnt mono">{failedCount}</span>
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
                  <th className="num">Passed Qty</th>
                  <th className="num">Failed Qty</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><span className="dim">{fmtDate(r.checked_date ?? r.created_at)}</span></td>
                    <td><span className="strong mono">{r.program_uid ?? "—"}</span></td>
                    <td><span className="mono">{r.lot_no ?? "—"}</span></td>
                    <td><span className="mono">{r.design_no ?? "—"}</span></td>
                    <td className="num mono">{fmtNum(r.passed_qty)}</td>
                    <td className="num mono">{fmtNum(r.failed_qty)}</td>
                    <td>
                      <span className={`pill ${r.overall_status === "Passed" ? "success" : "danger"}`}>
                        {r.overall_status ?? "—"}
                      </span>
                    </td>
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
