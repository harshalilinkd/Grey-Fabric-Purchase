"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { fetchPoShipments } from "@/lib/purchase-orders";
import { createGreyInstalment, deleteShipment, fetchPoGreyInstalments, restoreShipment, updateShipment } from "@/lib/shipments";
import { optimisticList, optimisticPatch, optimisticRemove } from "@/lib/optimistic";
import { fmtDate, fmtNum, round2 } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import { DELIVERY_MODES, DELIVERY_WAREHOUSE, deliveryBadge, isDirectToDyer, type DeliveryMode } from "@/lib/delivery-mode";
import type { InstalmentLotInput, PurchaseOrder, Shipment } from "@/lib/types";

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

/** A lot line in the instalment form (+ a stable key so removing a row doesn't desync). */
type LotRow = InstalmentLotInput & { _key: number };
let lotSeq = 0;
const emptyLot = (): LotRow => ({ _key: (lotSeq += 1), lot_no: "", meters: "" });

export function ManageShipmentsModal({
  po,
  isAdmin,
  onClose,
}: {
  po: PurchaseOrder;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["po-shipments", po.unique_id];
  const instKey = ["po-instalments", po.unique_id];

  const { data: history = [], isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => fetchPoShipments(po.unique_id),
  });
  const { data: instalments = [] } = useQuery({
    queryKey: instKey,
    queryFn: () => fetchPoGreyInstalments(po.unique_id),
  });

  const [receivedDate, setReceivedDate] = useState(todayISO());
  /** Path A (to our dock) vs Path B (drop-shipped straight to the dyer) — migration 026. */
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(DELIVERY_WAREHOUSE);
  const [nextFollowup, setNextFollowup] = useState("");
  const [remark, setRemark] = useState("");
  const [lots, setLots] = useState<LotRow[]>([emptyLot()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editLot, setEditLot] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Shipment | null>(null);

  const ordered = po.quantity ?? 0;
  // Sent-to-date is always summed from the LOT rows — never from the instalments — so a
  // half-written instalment can't inflate it.
  const totalSent = useMemo(() => history.reduce((s, x) => s + (x.sent_quantity ?? 0), 0), [history]);
  const pending = round2(ordered - totalSent);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: instKey });
    qc.invalidateQueries({ queryKey: ["shipments_all"] });
    qc.invalidateQueries({ queryKey: ["grey_instalments"] });
  };

  const resetForm = () => {
    setLots([emptyLot()]);
    setNextFollowup("");
    setRemark("");
    setReceivedDate(todayISO());
    // Back to the standard route deliberately: a sticky "direct to dyer" would silently
    // mis-stamp the next ordinary receipt, and it is the rarer of the two.
    setDeliveryMode(DELIVERY_WAREHOUSE);
  };
  const cancelEdit = () => { setEditingId(null); setEditQty(""); setEditLot(""); };

  const warnIfOver = (projectedSent: number) => {
    if (ordered > 0 && projectedSent > ordered) {
      toast.warning(`Over-shipment — pending is now ${fmtNum(round2(ordered - projectedSent))} m. Saved anyway.`);
    }
  };

  const filledLots = useMemo(() => lots.filter((l) => l.lot_no.trim() !== ""), [lots]);
  const instalmentQty = useMemo(
    () => round2(filledLots.reduce((s, l) => s + (Number(l.meters) || 0), 0)),
    [filledLots],
  );

  // Log the instalment + its lots. The remaining-qty SNAPSHOT is what is outstanding
  // right now, immediately before this entry — captured here and never recomputed.
  const createM = useMutation({
    mutationFn: () =>
      createGreyInstalment(po.unique_id, {
        received_date: receivedDate,
        next_followup_date: nextFollowup || null,
        remark: remark.trim() || null,
        remaining_qty: pending,
        delivery_mode: deliveryMode,
        lots: filledLots.map((l) => ({ lot_no: l.lot_no, meters: l.meters })),
      }),
    onMutate: async () => {
      const projected = totalSent + instalmentQty;
      await qc.cancelQueries({ queryKey: key });
      const stamp = Date.now();
      const temps = filledLots.map((l, i) => ({
        id: `temp-${stamp}${i}`, shipment_id: `SHID-${stamp}${i}`, po_unique_id: po.unique_id,
        shipment_date: receivedDate, sent_quantity: numOrNull(l.meters),
        lot_no: l.lot_no.trim(), created_at: new Date().toISOString(), grey_instalment: null,
        delivery_mode: deliveryMode,
      })) as Shipment[];
      const rollback = optimisticList<Shipment>(qc, key, (cur) => [...cur, ...temps]);
      return { rollback, projected, count: temps.length };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: (_d, _v, ctx) => {
      const n = ctx?.count ?? 0;
      toast.success(`Grey receipt logged — ${n} lot${n === 1 ? "" : "s"} created`);
      if (ctx) warnIfOver(ctx.projected);
      resetForm();
    },
    onSettled: () => invalidate(),
  });

  const updateM = useMutation({
    mutationFn: () => updateShipment(editingId!, { sent_quantity: numOrNull(editQty), lot_no: editLot.trim() || null }),
    onMutate: async () => {
      const old = history.find((h) => h.id === editingId)?.sent_quantity ?? 0;
      const projected = totalSent - old + (Number(editQty) || 0);
      await qc.cancelQueries({ queryKey: key });
      const rollback = optimisticPatch<Shipment>(qc, key, (s) => s.id === editingId, { sent_quantity: numOrNull(editQty), lot_no: editLot.trim() || null });
      return { rollback, projected };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: (_d, _v, ctx) => { toast.success("Lot updated"); if (ctx) warnIfOver(ctx.projected); cancelEdit(); },
    onSettled: () => invalidate(),
  });

  const restoreM = useMutation({
    mutationFn: (s: Shipment) => restoreShipment(s),
    onSuccess: () => { toast.success("Lot restored"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteShipment(id),
    onMutate: async (id: string) => {
      setDeleteTarget(null);
      await qc.cancelQueries({ queryKey: key });
      const removed = history.find((h) => h.id === id);
      const rollback = optimisticRemove<Shipment>(qc, key, (s) => s.id === id);
      return { rollback, removed };
    },
    onError: (e: Error, _id, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: (_d, _id, ctx) =>
      toast.success("Lot deleted", ctx?.removed ? { action: { label: "Undo", onClick: () => restoreM.mutate(ctx.removed!) } } : undefined),
    onSettled: () => invalidate(),
  });

  const startEdit = (s: Shipment) => {
    setEditingId(s.id);
    setEditQty(s.sent_quantity?.toString() ?? "");
    setEditLot(s.lot_no ?? "");
  };

  const setLotNo = (i: number, val: string) =>
    setLots((rows) => rows.map((r, idx) => (idx === i ? { ...r, lot_no: val } : r)));
  const setLotMeters = (i: number, val: string) =>
    setLots((rows) => rows.map((r, idx) => (idx === i ? { ...r, meters: val } : r)));
  const addLotRow = () => setLots((rows) => [...rows, emptyLot()]);
  const removeLotRow = (i: number) => setLots((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));

  // Group the lot rows under the instalment that produced them; anything older than
  // migration 020 has no instalment and is listed separately.
  const grouped = useMemo(() => {
    const byInst = new Map<string, Shipment[]>();
    const legacy: Shipment[] = [];
    for (const s of history) {
      if (s.grey_instalment) {
        const arr = byInst.get(s.grey_instalment) ?? [];
        arr.push(s);
        byInst.set(s.grey_instalment, arr);
      } else {
        legacy.push(s);
      }
    }
    /* An instalment is only as real as the lots it produced. Deleting a lot removes the
       shipment row but never its parent instalment (that delete is admin-only and the route
       doesn't cascade), so an instalment whose lots have all gone would otherwise keep
       reporting metres that no longer exist — the history said "7,000 m received" while
       Sent-to-date said 0 m. Drop the emptied ones, and take each surviving instalment's
       figure from its LIVE lots so removing one lot of three updates the total instead of
       lying. `remaining_qty` stays the stored snapshot — it is a write-once record of what
       was outstanding at the time, and must never be recomputed. */
    const blocks = instalments
      .map((inst) => {
        const lots = byInst.get(inst.id) ?? [];
        return { inst, lots, received: round2(lots.reduce((sum, l) => sum + (l.sent_quantity ?? 0), 0)) };
      })
      .filter((b) => b.lots.length > 0);
    return { blocks, legacy };
  }, [history, instalments]);

  const canSave =
    filledLots.length > 0 && filledLots.every((l) => numOrNull(l.meters) != null && (numOrNull(l.meters) ?? 0) > 0);
  const canUpdate = editQty.trim() !== "" && Number.isFinite(Number(editQty)) && editLot.trim() !== "";

  /* Esc closes the inner confirm first, then the modal itself. */
  useEscClose(true, () => (deleteTarget ? setDeleteTarget(null) : onClose()));

  const lotRow = (s: Shipment) => (
    <tr key={s.id}>
      <td className="mono">
        {s.lot_no ?? "—"}
        {deliveryBadge(s.delivery_mode) && (
          <span className="pill info" style={{ marginLeft: 6 }} title="Drop-shipped by the vendor — these rolls never came to our warehouse">
            {deliveryBadge(s.delivery_mode)}
          </span>
        )}
      </td>
      <td className="num mono">{fmtNum(s.sent_quantity)}</td>
      <td>
        <div className="mini-actions">
          <button className="mini-act" title="Edit lot" onClick={() => startEdit(s)}><Icon name="pencil" size={14} /></button>
          <button className="mini-act danger" title={isAdmin ? "Delete lot" : "Admin only"} disabled={deleteM.isPending} onClick={() => setDeleteTarget(s)}><Icon name="trash" size={14} /></button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal split-modal" role="dialog" aria-modal="true" aria-label="Manage grey receipts">
        <div className="modal-head">
          <div>
            <h3>Grey receipts — PO <span className="mono">{po.po_no ?? po.unique_id}</span></h3>
            <p>{po.vendor_name ?? "—"}</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="split">
          <div className="split-left">
            <div className="sum">
              <div className="sum-row"><span>Vendor</span><b>{po.vendor_name ?? "—"}</b></div>
              <div className="sum-row"><span>Dyeing house</span><b>{po.dying_house_name ?? "—"}</b></div>
              <div className="sum-row"><span>Order date</span><b>{fmtDate(po.order_date)}</b></div>
              <div className="sum-row"><span>Total ordered</span><b className="mono">{fmtNum(ordered)} m</b></div>
              <div className="sum-row"><span>Sent to date</span><b className="mono">{fmtNum(totalSent)} m</b></div>
              <div className="sum-row">
                <span>Remaining on PO</span>
                <b className={`mono ${pending < 0 ? "neg" : pending > 0 ? "warn" : ""}`}>{fmtNum(pending)} m</b>
              </div>
            </div>

            <div className="sum-title">Instalment history</div>
            {isLoading ? (
              <div className="skeleton" style={{ height: 80 }} />
            ) : isError ? (
              <p className="muted-note">
                Couldn&apos;t load the history.{" "}
                <button type="button" className="act" onClick={() => refetch()}>Retry</button>
              </p>
            ) : grouped.blocks.length === 0 && grouped.legacy.length === 0 ? (
              <p className="muted-note">No grey received yet.</p>
            ) : (
              <>
                {grouped.blocks.map(({ inst, lots: instLots, received }) => (
                  <div className="inst-block" key={inst.id}>
                    <div className="inst-head">
                      <span className="strong">{fmtDate(inst.received_date)}</span>
                      <span><span className="mono">{fmtNum(received)}</span> m received</span>
                      <span>
                        Remaining before: <span className="mono">{fmtNum(inst.remaining_qty)}</span> m
                      </span>
                      {inst.next_followup_date && (
                        <span className="pill info">Next follow-up · {fmtDate(inst.next_followup_date)}</span>
                      )}
                    </div>
                    {inst.remark && <p className="inst-remark">{inst.remark}</p>}
                    {instLots.length > 0 && (
                      <table className="mini-table">
                        <thead>
                          <tr><th>Lot no</th><th style={{ textAlign: "right" }}>Metres</th><th></th></tr>
                        </thead>
                        <tbody>{instLots.map(lotRow)}</tbody>
                      </table>
                    )}
                  </div>
                ))}

                {grouped.legacy.length > 0 && (
                  <div className="inst-block">
                    <div className="inst-head">
                      <span className="strong">Earlier lots</span>
                      <span>logged before instalments were tracked</span>
                    </div>
                    <table className="mini-table">
                      <thead>
                        <tr><th>Lot no</th><th style={{ textAlign: "right" }}>Metres</th><th></th></tr>
                      </thead>
                      <tbody>{grouped.legacy.map(lotRow)}</tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="split-right">
            {editingId ? (
              <>
                <div className="sum-title">Edit lot</div>
                <div className="field">
                  <label htmlFor="gr-elot">Lot no</label>
                  <input id="gr-elot" value={editLot} onChange={(e) => setEditLot(e.target.value)} placeholder="Lot 24" />
                </div>
                <div className="field">
                  <label htmlFor="gr-eqty">Metres</label>
                  <input id="gr-eqty" type="number" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} placeholder="2400" />
                </div>
                <div className="foot-actions" style={{ marginTop: 4 }}>
                  <button className="btn btn-ghost" onClick={cancelEdit}>Cancel edit</button>
                  <button className="btn btn-primary" disabled={!canUpdate || updateM.isPending} onClick={() => updateM.mutate()}>
                    {updateM.isPending ? "Saving…" : "Update lot"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="sum-title">Log grey receipt</div>

                {/* PATH A vs PATH B — where the rolls physically went. On a drop-ship the
                    fabric never reaches us, so this receipt is virtual (logged off the
                    vendor's invoice) — but the lot is real and enters the queue either way. */}
                <div className="field">
                  <label id="gr-mode-label">How did it arrive?</label>
                  <div className="path-pills" role="group" aria-labelledby="gr-mode-label">
                    {DELIVERY_MODES.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        className={`path-pill${deliveryMode === m.value ? " on" : ""}`}
                        aria-pressed={deliveryMode === m.value}
                        onClick={() => setDeliveryMode(m.value)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <span className="field-hint">
                    {DELIVERY_MODES.find((m) => m.value === deliveryMode)?.blurb}
                  </span>
                </div>

                <div className="field">
                  <label htmlFor="gr-date">{isDirectToDyer(deliveryMode) ? "Invoice date" : "Received date"}</label>
                  <input id="gr-date" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
                </div>

                <div className="sum-title">Lots in this instalment</div>
                <div className="lot-rows">
                  {lots.map((l, i) => (
                    <div className="lot-row" key={l._key}>
                      <div className="field">
                        <label htmlFor={`gr-lot-${i}`}>Lot no</label>
                        <input id={`gr-lot-${i}`} value={l.lot_no} onChange={(e) => setLotNo(i, e.target.value)} placeholder="Lot 24" />
                      </div>
                      <div className="field">
                        <label htmlFor={`gr-lm-${i}`}>Metres</label>
                        <input id={`gr-lm-${i}`} type="number" step="any" value={l.meters} onChange={(e) => setLotMeters(i, e.target.value)} placeholder="2400" />
                      </div>
                      <button
                        type="button"
                        className="lot-del"
                        onClick={() => removeLotRow(i)}
                        disabled={lots.length === 1}
                        title="Remove this lot"
                        aria-label={`Remove lot row ${i + 1}`}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" className="act" style={{ marginTop: 8 }} onClick={addLotRow}>
                  <Icon name="plus" size={15} />Add another lot
                </button>

                <div className="sum" style={{ marginTop: 12 }}>
                  <div className="sum-row"><span>This instalment</span><b className="mono">{fmtNum(instalmentQty)} m</b></div>
                  <div className="sum-row"><span>Remaining before entry</span><b className="mono">{fmtNum(pending)} m</b></div>
                </div>

                <div className="field" style={{ marginTop: 12 }}>
                  <label htmlFor="gr-next">Next follow-up date</label>
                  <input id="gr-next" type="date" value={nextFollowup} onChange={(e) => setNextFollowup(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="gr-remark">Remark</label>
                  <input id="gr-remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. balance promised next week" />
                </div>

                <div className="foot-actions" style={{ marginTop: 4 }}>
                  <button className="btn btn-primary" disabled={!canSave || createM.isPending} onClick={() => createM.mutate()}>
                    {createM.isPending ? "Saving…" : "Log receipt"}
                  </button>
                </div>
                <div className="subtle-note">
                  <Icon name="info" size={16} />
                  <span>
                    One instalment can be split into several lots — add a row per lot. Remaining Qty is stored as a
                    snapshot of what was outstanding before this entry. Over-shipment is allowed, with a warning.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {deleteTarget && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)}>
          <div className="modal sm" role="dialog" aria-modal="true" aria-label="Delete lot?">
            <div className="modal-head">
              <div>
                <h3>Delete lot?</h3>
                <p>Lot <span className="mono">{deleteTarget.lot_no ?? "—"}</span> · <span className="mono">{fmtNum(deleteTarget.sent_quantity)}</span> m</p>
              </div>
              <button className="close-x" onClick={() => setDeleteTarget(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                This permanently deletes the lot from the queue. The instalment it belonged to is kept.
                {!isAdmin && (
                  <>
                    <br />
                    <span className="confirm-warn">Note: only admins can delete — this may be rejected.</span>
                  </>
                )}
              </p>
            </div>
            <div className="modal-foot">
              <span />
              <div className="foot-actions">
                <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button className="btn btn-danger" disabled={deleteM.isPending} onClick={() => deleteM.mutate(deleteTarget.id)}>
                  {deleteM.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
