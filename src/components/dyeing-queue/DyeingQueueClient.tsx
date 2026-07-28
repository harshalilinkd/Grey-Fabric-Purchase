"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { usePagePrimaryAction, usePageSearchInput, useRegisterCommands } from "@/components/experience/CommandProvider";
import { ProgramCardFormModal, type AvailableLot } from "@/components/program-cards/ProgramCardFormModal";
import { ProgramCardDetailModal } from "@/components/program-cards/ProgramCardDetailModal";
import { deleteShipment, fetchAllShipments } from "@/lib/shipments";
import { fetchPoColorVariants, fetchPurchaseOrders } from "@/lib/purchase-orders";
import { createProgramCard, deleteProgramCard, fetchProgramCards } from "@/lib/program-cards";
import { fetchActiveMasterNames, fetchHolidayDates } from "@/lib/masters";
import { fetchClosedQcLotNos } from "@/lib/dyeing-queue";
import { isDirectToDyer } from "@/lib/delivery-mode";
import { optimisticList, optimisticRemove } from "@/lib/optimistic";
import { fmtAmount, fmtDate, fmtNum, round2 } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { ProgramCard, ProgramCardFormValues, PurchaseOrder, Shipment } from "@/lib/types";

const PC_KEY = ["program_cards"] as const;
const LOTS_KEY = ["program_card_lots"] as const;

function optimisticCard(v: ProgramCardFormValues, programUid: string): ProgramCard {
  const now = new Date().toISOString();
  const sum = v.designs.reduce((s, d) => s + (Number(d.meter) || 0), 0);
  const total = Number(v.total_meters);
  return {
    id: `temp-${now}`,
    program_uid: programUid,
    lot_no: v.lot_no.trim() || null,
    po_unique_id: v.po_unique_id,
    program_date: v.program_date || null,
    dying_house_name: v.dying_house_name.trim() || null,
    total_meters: Number.isFinite(total) && v.total_meters.trim() !== "" ? round2(total) : sum || null,
    created_at: now,
  };
}

function predictNextProgramId(cards: ProgramCard[]): string {
  let max = 0;
  for (const c of cards) {
    const m = /^PG-(\d+)$/.exec(c.program_uid ?? "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PG-${max + 1}`;
}

type QueueRow = { shipment: Shipment; po: PurchaseOrder | undefined; created: boolean; program: ProgramCard | undefined };

export function DyeingQueueClient({
  initialShipments,
  initialPos,
  initialPrograms,
  initialQcLots,
  isAdmin,
}: {
  initialShipments: Shipment[];
  initialPos: PurchaseOrder[];
  initialPrograms: ProgramCard[];
  initialQcLots: string[];
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: shipments = [], isFetching } = useQuery({ queryKey: ["shipments_all"], queryFn: fetchAllShipments, initialData: initialShipments });
  const { data: pos = [] } = useQuery({ queryKey: ["purchase_orders"], queryFn: fetchPurchaseOrders, initialData: initialPos });
  const { data: programs = [] } = useQuery({ queryKey: PC_KEY, queryFn: fetchProgramCards, initialData: initialPrograms });
  const { data: qcLots = [] } = useQuery({ queryKey: ["qc_lots"], queryFn: fetchClosedQcLotNos, initialData: initialQcLots });
  const { data: dyeingHouseNames = [] } = useQuery({ queryKey: ["masters-active", "dyeing_houses"], queryFn: () => fetchActiveMasterNames("dyeing_houses") });
  // Non-working days, so the planned dyeing-return date counts working days only.
  const { data: holidays = [] } = useQuery({ queryKey: ["holidays"], queryFn: fetchHolidayDates });

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "pending" | "created">("all");
  const [infoPo, setInfoPo] = useState<PurchaseOrder | null>(null);
  const [detail, setDetail] = useState<ProgramCard | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<QueueRow | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  const openForm = useCallback(() => setFormOpen(true), []);
  usePagePrimaryAction("New program", openForm);
  useRegisterCommands(
    () => [{ id: "dq:search", title: "Search lots", group: "This page", icon: "search", run: () => searchRef.current?.focus() }],
    [],
  );

  const variantsQ = useQuery({ queryKey: ["po-variants", infoPo?.id], queryFn: () => fetchPoColorVariants(infoPo!.id), enabled: !!infoPo });

  useEscClose(!!infoPo, () => setInfoPo(null));
  useEscClose(!!deleteTarget, () => setDeleteTarget(null));

  const poByUid = useMemo(() => {
    const m: Record<string, PurchaseOrder> = {};
    for (const p of pos) m[p.unique_id] = p;
    return m;
  }, [pos]);
  const qcSet = useMemo(() => new Set(qcLots), [qcLots]);
  const programSet = useMemo(() => new Set(programs.map((c) => c.lot_no).filter((x): x is string => !!x)), [programs]);
  const lotToProgram = useMemo(() => {
    const m: Record<string, ProgramCard> = {};
    for (const c of programs) if (c.lot_no && !m[c.lot_no]) m[c.lot_no] = c;
    return m;
  }, [programs]);

  // Every shipment is a lot entry; hide any lot already QC'd; derive status.
  const baseQueue = useMemo(() => {
    return shipments
      .filter((s) => !(s.lot_no && qcSet.has(s.lot_no)))
      .map((s) => {
        const created = !!(s.lot_no && programSet.has(s.lot_no));
        return { shipment: s, po: poByUid[s.po_unique_id] as PurchaseOrder | undefined, created, program: s.lot_no ? lotToProgram[s.lot_no] : undefined };
      });
  }, [shipments, qcSet, programSet, poByUid, lotToProgram]);

  const pendingCount = baseQueue.filter((r) => !r.created).length;
  const createdCount = baseQueue.filter((r) => r.created).length;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = baseQueue;
    if (view !== "all") list = list.filter((r) => (view === "created" ? r.created : !r.created));
    if (!q) return list;
    return list.filter((r) =>
      [r.shipment.lot_no, r.po?.po_no, r.po?.vendor_name, r.program?.program_uid, r.program?.dying_house_name].some((f) => (f ?? "").toLowerCase().includes(q)),
    );
  }, [baseQueue, search, view]);

  // Pending lots (have a shipment, no program yet, not QC'd) — offered in the New-program form.
  const availableLots = useMemo<AvailableLot[]>(() => {
    const seen = new Set<string>();
    const out: AvailableLot[] = [];
    for (const r of baseQueue) {
      const lot = r.shipment.lot_no;
      if (r.created || !lot || seen.has(lot)) continue;
      seen.add(lot);
      out.push({
        lot_no: lot,
        po_unique_id: r.shipment.po_unique_id,
        po_id: r.po?.id ?? null,
        po_no: r.po?.po_no ?? null,
        vendor: r.po?.vendor_name ?? null,
        dying_house_name: r.po?.dying_house_name ?? null,
        lot_meters: r.shipment.sent_quantity ?? null,
      });
    }
    return out;
  }, [baseQueue]);

  const nextProgramId = useMemo(() => predictNextProgramId(programs), [programs]);

  const createM = useMutation({
    mutationFn: (v: ProgramCardFormValues) => createProgramCard(v),
    onMutate: async (v: ProgramCardFormValues) => {
      setFormOpen(false);
      await qc.cancelQueries({ queryKey: PC_KEY });
      const temp = optimisticCard(v, nextProgramId);
      return { rollback: optimisticList<ProgramCard>(qc, PC_KEY, (cur) => [temp, ...cur]) };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: () => toast.success("Program card created"),
    onSettled: () => { qc.invalidateQueries({ queryKey: PC_KEY }); qc.invalidateQueries({ queryKey: LOTS_KEY }); },
  });

  // Delete a lot: removes its shipment (so it leaves the Dyeing Queue + Grey House) and, if a
  // program was already created, its program card too. Admin-only (the route handlers enforce it).
  const deleteM = useMutation({
    mutationFn: async (row: QueueRow) => {
      if (row.created && row.program) await deleteProgramCard(row.program.id);
      await deleteShipment(row.shipment.id);
    },
    onMutate: async (row: QueueRow) => {
      setDeleteTarget(null);
      await qc.cancelQueries({ queryKey: ["shipments_all"] });
      const rollback = optimisticRemove<Shipment>(qc, ["shipments_all"], (s) => s.id === row.shipment.id);
      return { rollback };
    },
    onError: (e: Error, _row, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: () => toast.success("Lot deleted"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["shipments_all"] });
      qc.invalidateQueries({ queryKey: PC_KEY });
      qc.invalidateQueries({ queryKey: LOTS_KEY });
    },
  });

  const detailPo = detail ? poByUid[detail.po_unique_id] : undefined;

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Dyeing Queue</h1>
          <p>Lots awaiting or in dyeing — create a program to send a lot for dyeing</p>
        </div>
        <button className="btn btn-primary" onClick={openForm} disabled={availableLots.length === 0} title={availableLots.length === 0 ? "No lots awaiting a program" : "Create a dyeing program"}>
          <Icon name="plus" />New program
        </button>
      </div>

      <div className="toolbar split">
        <div className="seg" role="group" aria-label="Filter by program status">
          <button className={view === "all" ? "on" : ""} aria-pressed={view === "all"} onClick={() => setView("all")}>
            All lots <span className="cnt mono">{baseQueue.length}</span>
          </button>
          <button className={view === "pending" ? "on" : ""} aria-pressed={view === "pending"} onClick={() => setView("pending")}>
            Pending program <span className="cnt mono">{pendingCount}</span>
          </button>
          <button className={view === "created" ? "on" : ""} aria-pressed={view === "created"} onClick={() => setView("created")}>
            Program created <span className="cnt mono">{createdCount}</span>
          </button>
        </div>
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder="Search lot, PO, vendor, program, dyeing house…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isFetching && <span className="fetching">Updating…</span>}
      </div>

      <div className="table-wrap">
        {rows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Shipment date</th>
                  <th>Lot No</th>
                  <th className="num">Sent Qty</th>
                  <th>PO No</th>
                  <th>Program</th>
                  <th>Dyeing House</th>
                  <th>Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.shipment.id}>
                    <td><span className="dim">{fmtDate(r.shipment.shipment_date)}</span></td>
                    <td>
                      <span className="strong mono">{r.shipment.lot_no ?? "—"}</span>
                      {/* Drop-shipped: the rolls are already sitting at the dyeing house, so
                          there is nothing here to pick — only the card gets couriered out. */}
                      {isDirectToDyer(r.shipment.delivery_mode) && (
                        <span className="pill info" style={{ marginLeft: 6 }} title="Vendor drop-shipped these rolls straight to the dyeing house — send the program card only">
                          Direct to dyer
                        </span>
                      )}
                    </td>
                    <td className="num mono">{fmtNum(r.shipment.sent_quantity)}</td>
                    <td><span className="mono">{r.po?.po_no ?? "—"}</span></td>
                    <td>{r.program ? <span className="strong mono">{r.program.program_uid}</span> : <span className="dim">—</span>}</td>
                    <td>{r.program?.dying_house_name ?? <span className="dim">—</span>}</td>
                    <td><span className={`pill ${r.created ? "success" : "warning"}`}>{r.created ? "Program Created" : "Pending Program"}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        {r.created && r.program ? (
                          <button className="act" onClick={() => setDetail(r.program!)}>
                            <Icon name="card" size={15} />Program
                          </button>
                        ) : (
                          <button className="act" onClick={() => r.po && setInfoPo(r.po)} disabled={!r.po}>
                            <Icon name="info" size={15} />Info
                          </button>
                        )}
                        {isAdmin && (
                          <button className="act danger" title="Delete this lot" aria-label={`Delete lot ${r.shipment.lot_no ?? ""}`} onClick={() => setDeleteTarget(r)}>
                            <Icon name="trash" size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="ph-icon"><Icon name="lines" size={26} /></div>
            <h3>
              {baseQueue.length
                ? search.trim() ? "No matching lots" : view === "pending" ? "Nothing pending" : "No programs created yet"
                : "Queue is clear"}
            </h3>
            <p>
              {baseQueue.length
                ? search.trim() ? "Try a different search." : view === "pending" ? "Every lot in the queue has a dyeing program." : "Create a program for a pending lot and it'll show up here."
                : shipments.length ? "Every lot has been quality-checked — nothing left in the dyeing queue." : "Log shipments on Grey House Follow Up and lots will appear here, ready for dyeing."}
            </p>
            {!shipments.length ? (
              <Link className="btn btn-primary" href="/grey-receipts"><Icon name="box" />Log a grey receipt</Link>
            ) : availableLots.length > 0 ? (
              <button className="btn btn-primary" onClick={openForm}><Icon name="plus" />New program</button>
            ) : null}
          </div>
        )}
      </div>

      <ProgramCardFormModal
        open={formOpen}
        availableLots={availableLots}
        nextProgramId={nextProgramId}
        saving={createM.isPending}
        dyeingHouseSuggestions={dyeingHouseNames}
        holidays={holidays}
        onClose={() => setFormOpen(false)}
        onSave={(v) => createM.mutate(v)}
      />

      {detail && <ProgramCardDetailModal card={detail} po={detailPo} onClose={() => setDetail(null)} />}

      {infoPo && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setInfoPo(null)}>
          <div className="modal sm" role="dialog" aria-modal="true" aria-label="Parent purchase order">
            <div className="modal-head">
              <div>
                <h3>PO <span className="mono">{infoPo.po_no ?? infoPo.unique_id}</span></h3>
                <p>Parent purchase order</p>
              </div>
              <button className="close-x" onClick={() => setInfoPo(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <div className="sum">
                <div className="sum-row"><span>PO No</span><b className="mono">{infoPo.po_no ?? "—"}</b></div>
                <div className="sum-row"><span>Vendor</span><b>{infoPo.vendor_name ?? "—"}</b></div>
                <div className="sum-row"><span>Quality name</span><b>{infoPo.quality_name ?? infoPo.quality ?? "—"}</b></div>
                <div className="sum-row"><span>Process</span><b>{infoPo.process ?? "—"}</b></div>
                <div className="sum-row"><span>Order date</span><b>{fmtDate(infoPo.order_date)}</b></div>
                <div className="sum-row"><span>Total qty</span><b className="mono">{fmtNum(infoPo.quantity)} m</b></div>
                <div className="sum-row"><span>Rate</span><b className="mono">{infoPo.rate == null ? "—" : fmtAmount(infoPo.rate)}</b></div>
                <div className="sum-row"><span>Amount</span><b className="mono">{fmtAmount(infoPo.amount)}</b></div>
              </div>

              <div className="sum-title">Colour breakdown</div>
              {variantsQ.isLoading ? (
                <div className="skeleton" style={{ height: 60 }} />
              ) : (variantsQ.data?.length ?? 0) > 0 ? (
                <table className="mini-table">
                  <thead><tr><th>Code</th><th>Colour</th><th style={{ textAlign: "right" }}>Metres</th></tr></thead>
                  <tbody>
                    {variantsQ.data!.map((vv) => (
                      <tr key={vv.id}><td className="mono">{vv.code ?? "—"}</td><td>{vv.color_name ?? "—"}</td><td className="num mono">{fmtNum(vv.meters)}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted-note">No colour split recorded.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)}>
          <div className="modal sm" role="dialog" aria-modal="true" aria-label="Delete lot?">
            <div className="modal-head">
              <div>
                <h3>Delete this lot?</h3>
                <p>Lot <span className="mono">{deleteTarget.shipment.lot_no ?? "—"}</span>{deleteTarget.po?.po_no ? ` · PO ${deleteTarget.po.po_no}` : ""}</p>
              </div>
              <button className="close-x" onClick={() => setDeleteTarget(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                This removes the lot&apos;s shipment, so it disappears from the <b>Dyeing Queue</b> and <b>Grey House Follow Up</b>
                {deleteTarget.created && deleteTarget.program ? <> and deletes its program <b className="mono">{deleteTarget.program.program_uid}</b></> : null}.
                <br />
                <span className="confirm-warn">This can&apos;t be undone.</span>
              </p>
            </div>
            <div className="modal-foot">
              <span className="amt-preview" />
              <div className="foot-actions">
                <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={() => deleteM.mutate(deleteTarget)} disabled={deleteM.isPending}>
                  {deleteM.isPending ? "Deleting…" : "Delete lot"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
