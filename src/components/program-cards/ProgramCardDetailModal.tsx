"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { fetchProgramCardDesigns } from "@/lib/program-cards";
import { fetchHolidayDates } from "@/lib/masters";
import { fmtDate, fmtNum } from "@/lib/format";
import { workingDaysLabel } from "@/lib/working-days";
import { useEscClose } from "@/lib/use-esc-close";
import type { ProgramCard, PurchaseOrder } from "@/lib/types";

export function ProgramCardDetailModal({
  card,
  po,
  onClose,
}: {
  card: ProgramCard;
  po: PurchaseOrder | undefined;
  onClose: () => void;
}) {
  const { data: designs = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["program-card-designs", card.id],
    queryFn: () => fetchProgramCardDesigns(card.id),
  });
  // Lead time is counted in working days, so weekends + holidays push the return date out.
  const { data: holidays = [] } = useQuery({ queryKey: ["holidays"], queryFn: fetchHolidayDates });
  const holidaySet = useMemo(() => new Set(holidays), [holidays]);

  useEscClose(true, onClose);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Program card ${card.program_uid}`}>
        <div className="modal-head">
          <div>
            <h3>Program <span className="mono">{card.program_uid}</span></h3>
            <p>Lot <span className="mono">{card.lot_no ?? "—"}</span> · {card.dying_house_name ?? "No dyeing house"}</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="modal-body">
          <div className="sum">
            <div className="sum-row"><span>PO No</span><b className="mono">{po?.po_no ?? "—"}</b></div>
            <div className="sum-row"><span>Vendor</span><b>{po?.vendor_name ?? "—"}</b></div>
            <div className="sum-row"><span>Program ID</span><b className="mono">{card.program_uid}</b></div>
            <div className="sum-row"><span>Lot No</span><b className="mono">{card.lot_no ?? "—"}</b></div>
            <div className="sum-row"><span>Dyeing house</span><b>{card.dying_house_name ?? "—"}</b></div>
            <div className="sum-row"><span>Program date</span><b>{fmtDate(card.program_date)}</b></div>
            <div className="sum-row"><span>Color</span><b>{card.color ?? "—"}</b></div>
            <div className="sum-row"><span>Total meters</span><b className="mono">{fmtNum(card.total_meters)} m</b></div>
            <div className="sum-row"><span>Delivery days</span><b className="mono">{card.delivery_days ?? "—"}</b></div>
            <div className="sum-row">
              <span>Planned dyeing return</span>
              <b className="mono">{workingDaysLabel(card.program_date, card.delivery_days ?? null, holidaySet)}</b>
            </div>
          </div>

          <div className="sum-title">Colour cuttings</div>
          {isLoading ? (
            <div className="skeleton" style={{ height: 96 }} />
          ) : isError ? (
            <p className="muted-note">
              Couldn&apos;t load the cuttings.{" "}
              <button type="button" className="act" onClick={() => refetch()}>Retry</button>
            </p>
          ) : designs.length > 0 ? (
            <table className="mini-table">
              <thead>
                <tr><th>Design No</th><th>Colour</th><th style={{ textAlign: "right" }}>Meters</th><th>Cutting</th></tr>
              </thead>
              <tbody>
                {designs.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.design_no ?? "—"}</td>
                    <td>{d.color ?? "—"}</td>
                    <td className="num mono">{fmtNum(d.meter)}</td>
                    <td>
                      {d.cutting_url ? (
                        <a className="cutting-link" href={d.cutting_url} target="_blank" rel="noopener noreferrer">
                          <Icon name="file" size={13} />View
                        </a>
                      ) : (
                        <span className="dim">{(d.color ?? "").trim().toLowerCase() === "white" ? "White" : "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted-note">No colour cuttings recorded for this program.</p>
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
