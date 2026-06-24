"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { fetchProgramCardDesigns } from "@/lib/program-cards";
import { fmtAmount, fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { ProgramCard, PurchaseOrder, ReissueReturn, WarehouseLog } from "@/lib/types";

export function WarehouseDetailModal({
  entries,
  lotNo,
  po,
  program,
  reissues,
  onClose,
}: {
  entries: WarehouseLog[];
  lotNo: string | null;
  po: PurchaseOrder | undefined;
  program: ProgramCard | undefined;
  reissues: ReissueReturn[];
  onClose: () => void;
}) {
  // Colour per design comes from the program card's designs (warehouse_log only stores the code).
  const designsQ = useQuery({
    queryKey: ["program-card-designs", program?.id],
    queryFn: () => fetchProgramCardDesigns(program!.id),
    enabled: !!program?.id,
  });

  const colorByCode = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const d of designsQ.data ?? []) if (d.design_no) m[d.design_no] = d.color;
    return m;
  }, [designsQ.data]);

  useEscClose(true, onClose);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Ready goods for lot ${lotNo ?? "unknown"}`}>
        <div className="modal-head">
          <div>
            <h3>Ready goods — Lot <span className="mono">{lotNo ?? "—"}</span></h3>
            <p>{po?.quality ?? po?.quality_name ?? po?.vendor_name ?? "Stored after QC pass"}</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="modal-body">
          <div className="sum-title" style={{ marginTop: 0 }}>General information</div>
          <div className="sum">
            <div className="sum-row"><span>Program ID</span><b className="mono">{program?.program_uid ?? "—"}</b></div>
            <div className="sum-row"><span>PO No</span><b className="mono">{po?.po_no ?? "—"}</b></div>
            <div className="sum-row"><span>Quality name</span><b>{po?.quality ?? po?.quality_name ?? "—"}</b></div>
            <div className="sum-row"><span>Vendor</span><b>{po?.vendor_name ?? "—"}</b></div>
            <div className="sum-row"><span>Rate</span><b className="mono">{po?.rate == null ? "—" : fmtAmount(po.rate)}</b></div>
            <div className="sum-row"><span>Dyeing house</span><b>{program?.dying_house_name ?? "—"}</b></div>
            <div className="sum-row"><span>Lot No</span><b className="mono">{lotNo ?? "—"}</b></div>
          </div>

          <div className="sum-title">Stored designs</div>
          {entries.length > 0 ? (
            <table className="mini-table">
              <thead><tr><th>Design</th><th>Colour</th><th style={{ textAlign: "right" }}>Metres</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{e.design_no ?? "—"}</td>
                    <td>{e.color ?? (e.design_no ? colorByCode[e.design_no] ?? (designsQ.isLoading ? "…" : "—") : "—")}</td>
                    <td className="num mono">{fmtNum(e.passed_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted-note">No stored designs for this lot.</p>
          )}

          {reissues.length > 0 && (
            <>
              <div className="sum-title">Failed / reissued designs</div>
              <table className="mini-table">
                <thead><tr><th>Design</th><th>Reason</th><th style={{ textAlign: "right" }}>Metres</th></tr></thead>
                <tbody>
                  {reissues.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.original_design_no ?? "—"}</td>
                      <td>{r.reason ?? "—"}</td>
                      <td className="num mono">{fmtNum(r.reissue_qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="modal-foot">
          <span />
          <div className="foot-actions">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
