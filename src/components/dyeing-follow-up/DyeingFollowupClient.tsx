"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { CountUp } from "@/components/ui/CountUp";
import { useToast } from "@/components/ui/Toast";
import { usePagePrimaryAction, usePageSearchInput } from "@/components/experience/CommandProvider";
import { DyeingFollowupFormModal, type DispatchLot, type DispatchPo, type RejectedLot } from "./DyeingFollowupFormModal";
import { createDyeingFollowup, fetchDyeingFollowups } from "@/lib/dyeing-followups";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fetchReissueReturns } from "@/lib/reissue-return";
import { fetchProgramCards } from "@/lib/program-cards";
import { fetchAllShipments } from "@/lib/shipments";
import { optimisticList } from "@/lib/optimistic";
import { CYCLE_ORIGINAL } from "@/lib/cycle";
import { isDirectToDyer } from "@/lib/delivery-mode";
import { fmtDate, fmtNum, round2 } from "@/lib/format";
import type { DyeingFollowup, DyeingFollowupFormValues, ProgramCard, PurchaseOrder, ReissueReturn, Shipment } from "@/lib/types";

const DF_KEY = ["dyeing_followups"] as const;
const todayISO = () => new Date().toISOString().slice(0, 10);
const isOverdue = (date: string | null, today: string) => !!date && date <= today;

type ColKey = "lot_no" | "po_no" | "dying_house" | "sent" | "remaining" | "next_followup_date" | "remark";

/* PO No leads: a dispatch attaches to a PO. `Lot No` is kept for pre-rework rows —
   a PO-grain parcel can bundle several lots, so new dispatches leave it blank. */
const COLUMNS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "po_no", label: "PO No" },
  { key: "dying_house", label: "Dyeing House" },
  { key: "sent", label: "Sent Qty (m)", num: true },
  { key: "remaining", label: "Remaining (m)", num: true },
  { key: "lot_no", label: "Lot No" },
  { key: "next_followup_date", label: "Next Follow-up" },
  { key: "remark", label: "Remark" },
];

type DRow = DyeingFollowup & { po_no: string | null; vendor: string | null; dying_house: string | null; sent: number | null; remaining: number | null; overdue: boolean };

function optimisticFollowup(v: DyeingFollowupFormValues): DyeingFollowup {
  const now = new Date().toISOString();
  const r = Number(v.remaining_meters);
  const s = Number(v.sent_qty);
  return {
    id: `temp-${now}`,
    followup_id: `DF-${now}`,
    lot_no: v.lot_no.trim() || null,
    po_unique_id: v.po_unique_id || null,
    dying_house_name: v.dying_house_name.trim() || null,
    sent_qty: v.sent_qty.trim() !== "" && Number.isFinite(s) ? s : null,
    remaining_meters: v.remaining_meters.trim() !== "" && Number.isFinite(r) ? r : null,
    next_followup_date: v.next_followup_date || null,
    remark: v.remark.trim() || null,
    created_at: now,
    // carried so the optimistic row lands in the right leg's arithmetic before the refetch
    cycle: v.cycle,
  };
}

export function DyeingFollowupClient({
  initialFollowups,
  initialPos,
  initialReissues,
  initialPrograms,
  initialShipments,
}: {
  initialFollowups: DyeingFollowup[];
  initialPos: PurchaseOrder[];
  initialReissues: ReissueReturn[];
  initialPrograms: ProgramCard[];
  initialShipments: Shipment[];
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: followups = [], isFetching } = useQuery({ queryKey: DF_KEY, queryFn: fetchDyeingFollowups, initialData: initialFollowups });
  const { data: pos = [] } = useQuery({ queryKey: ["purchase_orders"], queryFn: fetchPurchaseOrders, initialData: initialPos });
  const { data: reissues = [] } = useQuery({ queryKey: ["reissue_return"], queryFn: fetchReissueReturns, initialData: initialReissues });
  // Reuse the app-wide keys so these inherit realtime invalidation with no extra wiring.
  const { data: programs = [] } = useQuery({ queryKey: ["program_cards"], queryFn: fetchProgramCards, initialData: initialPrograms });
  const { data: shipments = [] } = useQuery({ queryKey: ["shipments_all"], queryFn: fetchAllShipments, initialData: initialShipments });

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" }>({ key: "next_followup_date", dir: "asc" });
  const [formOpen, setFormOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  const openNew = useCallback(() => setFormOpen(true), []);
  usePagePrimaryAction("Record dispatch to dyeing house", openNew);

  const today = todayISO();

  const poByUid = useMemo(() => {
    const m: Record<string, PurchaseOrder> = {};
    for (const p of pos) m[p.unique_id] = p;
    return m;
  }, [pos]);

  /**
   * What can be dispatched, at PO grain.
   *
   * A dispatch attaches to a PO, not a lot: rejected metres from several lots go back to
   * a dyeing house as ONE parcel. The lot only re-enters when the fabric returns and is
   * matched back to lots. So:
   *   outstanding(PO) = Σ QC-rejected metres across all its lots − Σ already dispatched
   * A lot only becomes dispatchable AFTER QC rejects metres from it, which is why the
   * old "lots with a program card, not yet QC'd" population was the wrong set entirely —
   * those are the lots that by definition have nothing to send back.
   */
  const { dispatchPos, overDispatched } = useMemo(() => {
    /* `Returned` = metres sent back to the VENDOR. They are rejected, but they will never
       travel to a dyeing house, so they must stay OUT of the arithmetic — counting them
       floors outstanding above zero and the PO would sit in the picker forever, offering
       a dispatch that can never be filled. The source workbook can't settle this: its
       Stage 4 has one RETURN & REISSUE bucket covering both outcomes, so it never meets
       the case. The lines stay visible in the parcel table, just outside the sum.

       No cycle filter: `reissue_return` has no cycle column, and QC writes
       `original_po_unique_id` from the program's PO on every pass — so a second-round
       rejection lands against the same PO and is summed here automatically. */
    const rejectedByPo: Record<string, number> = {};
    const returnedByPo: Record<string, number> = {};
    const lotsByPo: Record<string, RejectedLot[]> = {};
    for (const r of reissues) {
      const uid = r.original_po_unique_id;
      if (!uid) continue;
      const qty = r.reissue_qty ?? 0;
      if (r.status === "Returned") returnedByPo[uid] = (returnedByPo[uid] ?? 0) + qty;
      else rejectedByPo[uid] = (rejectedByPo[uid] ?? 0) + qty;
      (lotsByPo[uid] ??= []).push({
        lot_no: r.original_lot_no,
        design_no: r.original_design_no,
        qty: r.reissue_qty,
        status: r.status,
      });
    }

    /* Reissue rows ONLY. Both legs share this table (025), so summing every row here would
       let a first-trip dispatch cancel out QC-rejected metres and quietly drop the PO from
       the reissue picker. Legacy rows predate `cycle` and default to 'reissue' in the DB;
       treat a missing value the same way so nothing already recorded changes meaning. */
    const dispatchedByPo: Record<string, number> = {};
    for (const f of followups) {
      if (!f.po_unique_id || f.cycle === CYCLE_ORIGINAL) continue;
      dispatchedByPo[f.po_unique_id] = (dispatchedByPo[f.po_unique_id] ?? 0) + (f.sent_qty ?? 0);
    }

    const out: DispatchPo[] = [];
    let over = 0;
    for (const uid of new Set([...Object.keys(rejectedByPo), ...Object.keys(dispatchedByPo)])) {
      const rejected = rejectedByPo[uid] ?? 0;
      const dispatched = dispatchedByPo[uid] ?? 0;
      const raw = round2(rejected - dispatched);
      // A line marked Returned AFTER it was dispatched drives this negative. Clamp what
      // we show, and count it so the discrepancy is visible rather than silently hidden.
      if (raw < 0) over += 1;
      const outstanding = Math.max(0, raw);
      if (outstanding <= 0) continue;
      const po = poByUid[uid];
      out.push({
        po_unique_id: uid,
        po_no: po?.po_no ?? null,
        order_no: po?.order_no ?? null,
        vendor: po?.vendor_name ?? null,
        dying_house_name: po?.dying_house_name ?? null,
        rejected: round2(rejected),
        returned: round2(returnedByPo[uid] ?? 0),
        dispatched: round2(dispatched),
        outstanding,
        lots: lotsByPo[uid] ?? [],
      });
    }
    out.sort((a, b) => (a.po_no ?? a.po_unique_id).localeCompare(b.po_no ?? b.po_unique_id, undefined, { numeric: true }));
    return { dispatchPos: out, overDispatched: over };
  }, [reissues, followups, poByUid]);

  /**
   * The FIRST trip out, at LOT grain (cycle 'original').
   *
   * A lot becomes dispatchable the moment its program card exists — the card is the
   * instruction that travels with it. Outstanding = what the card authorises minus what
   * has already gone out on this leg.
   *
   * NB this is the population an earlier revision removed from the reissue picker, and
   * removing it was right: a programmed-but-not-yet-QC'd lot has nothing to send *back*.
   * It is the correct set for the first leg, which is a different journey in the same
   * table. Don't merge the two pickers again.
   */
  const dispatchLots = useMemo<DispatchLot[]>(() => {
    const sentByLot: Record<string, number> = {};
    for (const f of followups) {
      if (f.cycle !== CYCLE_ORIGINAL || !f.lot_no) continue;
      sentByLot[f.lot_no] = (sentByLot[f.lot_no] ?? 0) + (f.sent_qty ?? 0);
    }
    const shipByLot: Record<string, Shipment> = {};
    for (const s of shipments) if (s.lot_no && !shipByLot[s.lot_no]) shipByLot[s.lot_no] = s;

    const rows: DispatchLot[] = [];
    for (const card of programs) {
      if (!card.lot_no) continue;
      /* Fall back to the lot's received metres when the card carries no total: without a
         figure the row would offer "0 m to send" and look like nothing to do. */
      const programmed = round2(card.total_meters ?? shipByLot[card.lot_no]?.sent_quantity ?? 0);
      const dispatched = round2(sentByLot[card.lot_no] ?? 0);
      const outstanding = Math.max(0, round2(programmed - dispatched));
      if (outstanding <= 0) continue;
      rows.push({
        lot_no: card.lot_no,
        po_unique_id: card.po_unique_id,
        po_no: poByUid[card.po_unique_id]?.po_no ?? null,
        program_uid: card.program_uid,
        dying_house_name: card.dying_house_name ?? poByUid[card.po_unique_id]?.dying_house_name ?? null,
        programmed,
        dispatched,
        outstanding,
        directToDyer: isDirectToDyer(shipByLot[card.lot_no]?.delivery_mode),
      });
    }
    rows.sort((a, b) => a.lot_no.localeCompare(b.lot_no, undefined, { numeric: true }));
    return rows;
  }, [programs, shipments, followups, poByUid]);

  const enriched = useMemo<DRow[]>(
    () =>
      followups.map((f) => {
        const po = f.po_unique_id ? poByUid[f.po_unique_id] : undefined;
        return { ...f, po_no: po?.po_no ?? null, vendor: po?.vendor_name ?? null, dying_house: f.dying_house_name ?? null, sent: f.sent_qty ?? null, remaining: f.remaining_meters, overdue: isOverdue(f.next_followup_date, today) };
      }),
    [followups, poByUid, today],
  );

  const overdueCount = useMemo(() => enriched.filter((r) => r.overdue).length, [enriched]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = enriched;
    if (q) {
      list = list.filter((r) =>
        [r.lot_no, r.po_no, r.vendor, r.dying_house, r.remark].some((f) => (f ?? "").toLowerCase().includes(q)),
      );
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      // overdue always floats to the top, then the chosen column sort within each group
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sort.key === "remaining" || sort.key === "sent") return ((av as number) - (bv as number)) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [enriched, search, sort]);

  const toggleSort = (k: ColKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));

  const createM = useMutation({
    mutationFn: (v: DyeingFollowupFormValues) => createDyeingFollowup(v),
    onMutate: async (v: DyeingFollowupFormValues) => {
      setFormOpen(false);
      await qc.cancelQueries({ queryKey: DF_KEY });
      const temp = optimisticFollowup(v);
      return { rollback: optimisticList<DyeingFollowup>(qc, DF_KEY, (cur) => [temp, ...cur]) };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: () => toast.success("Dispatch recorded"),
    onSettled: () => qc.invalidateQueries({ queryKey: DF_KEY }),
  });

  const renderCell = (r: DRow, k: ColKey) => {
    if (k === "sent") return <span className="mono">{r.sent == null ? "—" : fmtNum(r.sent)}</span>;
    if (k === "remaining") return <span className="mono">{fmtNum(r.remaining)}</span>;
    if (k === "lot_no") return <span className="mono">{r.lot_no ?? "—"}</span>;
    if (k === "po_no") {
      /* Both legs share this table, and they mean different things — a first trip out vs
         rejected metres going back. Without this the log is ambiguous on every row. */
      const first = r.cycle === CYCLE_ORIGINAL;
      return (
        <span className="nowrap">
          <span className="strong mono">{r.po_no ?? "—"}</span>
          <span className={`pill ${first ? "info" : "warning"}`} style={{ marginLeft: 6 }}>
            {first ? "For dyeing" : "Reissue"}
          </span>
        </span>
      );
    }
    if (k === "next_followup_date") {
      if (!r.next_followup_date) return <span className="dim">—</span>;
      return r.overdue
        ? <span className="pill danger">Overdue · {fmtDate(r.next_followup_date)}</span>
        : <span className="dim">{fmtDate(r.next_followup_date)}</span>;
    }
    return <span>{r[k] ?? "—"}</span>;
  };

  const hasData = followups.length > 0;

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Dyeing House Follow Up (Sent)</h1>
          <p>Metres dispatched to a dyeing house — overdue follow-ups float to the top</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <Icon name="plus" />Record dispatch
        </button>
      </div>

      <div className="wh-metrics">
        <div className="wh-metric">
          <div className="wh-mtop"><span className="wh-micon"><Icon name="refresh" size={18} /></span><span className="wh-mlabel">Follow-ups</span></div>
          <div className="wh-mvalue"><CountUp value={followups.length} /></div>
        </div>
        <div className="wh-metric">
          <div className="wh-mtop"><span className={`wh-micon${overdueCount > 0 ? " bad" : ""}`}><Icon name="info" size={18} /></span><span className="wh-mlabel">Overdue</span></div>
          <div className={`wh-mvalue${overdueCount > 0 ? " bad" : ""}`}><CountUp value={overdueCount} /></div>
        </div>
        <div className="wh-metric">
          <div className="wh-mtop">
            <span className="wh-micon"><Icon name="truck" size={18} /></span>
            <span className="wh-mlabel">POs to dispatch</span>
          </div>
          <div className="wh-mvalue"><CountUp value={dispatchPos.length} /></div>
        </div>
      </div>

      {/* Dispatched more than is dispatchable — usually a line marked Returned after it
          had already gone out. Outstanding is clamped at zero, so without this the
          discrepancy would simply vanish from the screen. */}
      {overDispatched > 0 && (
        <div className="subtle-note" style={{ marginBottom: 14 }}>
          <Icon name="info" size={16} />
          <span>
            <b>{overDispatched}</b> PO{overDispatched === 1 ? " has" : "s have"} more metres dispatched than are
            dispatchable — check whether a rejected line was marked <b>Returned</b> after it was already sent out.
          </span>
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder="Search lot, PO, vendor, dyeing house…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isFetching && <span className="fetching">Updating…</span>}
      </div>

      <div className="table-wrap">
        {rows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={`sortable ${c.num ? "num" : ""}`} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                      <button type="button" className="th-in" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        {sort.key === c.key && <Icon name={sort.dir === "asc" ? "arrowUp" : "arrowDown"} size={13} />}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className={c.num ? "num" : ""}>{renderCell(r, c.key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="ph-icon"><Icon name="refresh" size={26} /></div>
            <h3>{hasData ? "No matching follow-ups" : "No follow-ups yet"}</h3>
            <p>
              {hasData
                ? "Try a different search."
                : "Record a dispatch when metres go out to a dyeing house, so the return can be reconciled against what was sent."}
            </p>
            {!hasData && (
              <button className="btn btn-primary" onClick={openNew}>
                <Icon name="plus" />Record dispatch
              </button>
            )}
          </div>
        )}
      </div>

      <DyeingFollowupFormModal
        open={formOpen}
        dispatchLots={dispatchLots}
        dispatchPos={dispatchPos}
        saving={createM.isPending}
        onClose={() => setFormOpen(false)}
        onSave={(v) => createM.mutate(v)}
      />
    </>
  );
}
