"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { fetchPoShipments } from "@/lib/purchase-orders";
import { createShipment, deleteShipment, updateShipment } from "@/lib/shipments";
import { optimisticList, optimisticPatch, optimisticRemove } from "@/lib/optimistic";
import { fmtDate, fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PurchaseOrder, Shipment } from "@/lib/types";

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

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
  const { data: history = [], isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => fetchPoShipments(po.unique_id),
  });

  const [qty, setQty] = useState("");
  const [lot, setLot] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shipment | null>(null);

  const ordered = po.quantity ?? 0;
  const totalSent = useMemo(() => history.reduce((s, x) => s + (x.sent_quantity ?? 0), 0), [history]);
  const pending = ordered - totalSent;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["shipments_all"] });
  };
  const resetForm = () => { setQty(""); setLot(""); setEditingId(null); };

  const warnIfOver = (projectedSent: number) => {
    if (ordered > 0 && projectedSent > ordered) {
      toast.warning(`Over-shipment — pending is now ${fmtNum(ordered - projectedSent)} m. Saved anyway.`);
    }
  };

  // Optimistic on the modal's own ["po-shipments", uid] history (instant); the Grey House
  // table (shipments_all) refreshes on the onSettled invalidate. warnIfOver uses the
  // pre-mutation projection captured in onMutate. resetForm runs in onSuccess so the
  // mutationFn still reads qty/lot/editingId.
  const createM = useMutation({
    mutationFn: () => createShipment(po.unique_id, { sent_quantity: numOrNull(qty), lot_no: lot.trim() || null }),
    onMutate: async () => {
      const projected = totalSent + (Number(qty) || 0);
      await qc.cancelQueries({ queryKey: key });
      const stamp = Date.now();
      const temp = {
        id: `temp-${stamp}`, shipment_id: `SHID-${stamp}`, po_unique_id: po.unique_id,
        shipment_date: new Date().toISOString().slice(0, 10), sent_quantity: numOrNull(qty),
        lot_no: lot.trim() || null, created_at: new Date().toISOString(),
      } as Shipment;
      const rollback = optimisticList<Shipment>(qc, key, (cur) => [...cur, temp]);
      return { rollback, projected };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: (_d, _v, ctx) => { toast.success("Shipment logged"); if (ctx) warnIfOver(ctx.projected); resetForm(); },
    onSettled: () => invalidate(),
  });

  const updateM = useMutation({
    mutationFn: () => updateShipment(editingId!, { sent_quantity: numOrNull(qty), lot_no: lot.trim() || null }),
    onMutate: async () => {
      const old = history.find((h) => h.id === editingId)?.sent_quantity ?? 0;
      const projected = totalSent - old + (Number(qty) || 0);
      await qc.cancelQueries({ queryKey: key });
      const rollback = optimisticPatch<Shipment>(qc, key, (s) => s.id === editingId, { sent_quantity: numOrNull(qty), lot_no: lot.trim() || null });
      return { rollback, projected };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: (_d, _v, ctx) => { toast.success("Shipment updated"); if (ctx) warnIfOver(ctx.projected); resetForm(); },
    onSettled: () => invalidate(),
  });

  const restoreM = useMutation({
    mutationFn: (s: Shipment) => createShipment(po.unique_id, { sent_quantity: s.sent_quantity, lot_no: s.lot_no }),
    onSuccess: () => { toast.success("Shipment restored"); invalidate(); },
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
      toast.success("Shipment deleted", ctx?.removed ? { action: { label: "Undo", onClick: () => restoreM.mutate(ctx.removed!) } } : undefined),
    onSettled: () => invalidate(),
  });

  const startEdit = (s: Shipment) => {
    setEditingId(s.id);
    setQty(s.sent_quantity?.toString() ?? "");
    setLot(s.lot_no ?? "");
  };

  const canSave = qty.trim() !== "" && Number.isFinite(Number(qty)) && lot.trim() !== "";
  const saving = createM.isPending || updateM.isPending;

  /* Esc closes the inner confirm first, then the modal itself. */
  useEscClose(true, () => (deleteTarget ? setDeleteTarget(null) : onClose()));

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal split-modal" role="dialog" aria-modal="true" aria-label="Manage shipments">
        <div className="modal-head">
          <div>
            <h3>Manage shipments — PO <span className="mono">{po.po_no ?? po.unique_id}</span></h3>
            <p>{po.vendor_name ?? "—"}</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="split">
          <div className="split-left">
            <div className="sum">
              <div className="sum-row"><span>Vendor</span><b>{po.vendor_name ?? "—"}</b></div>
              <div className="sum-row"><span>Process</span><b>{po.process ?? "—"}</b></div>
              <div className="sum-row"><span>Order date</span><b>{fmtDate(po.order_date)}</b></div>
              <div className="sum-row"><span>Total ordered</span><b className="mono">{fmtNum(ordered)} m</b></div>
              <div className="sum-row"><span>Total sent</span><b className="mono">{fmtNum(totalSent)} m</b></div>
              <div className="sum-row">
                <span>Pending</span>
                <b className={`mono ${pending < 0 ? "neg" : pending > 0 ? "warn" : ""}`}>{fmtNum(pending)} m</b>
              </div>
            </div>

            <div className="sum-title">Shipment history</div>
            {isLoading ? (
              <div className="skeleton" style={{ height: 80 }} />
            ) : isError ? (
              <p className="muted-note">
                Couldn&apos;t load the shipment history.{" "}
                <button type="button" className="act" onClick={() => refetch()}>Retry</button>
              </p>
            ) : history.length > 0 ? (
              <table className="mini-table">
                <thead>
                  <tr><th>Date</th><th>Lot no</th><th style={{ textAlign: "right" }}>Sent qty</th><th></th></tr>
                </thead>
                <tbody>
                  {history.map((s) => (
                    <tr key={s.id}>
                      <td>{fmtDate(s.shipment_date)}</td>
                      <td className="mono">{s.lot_no ?? "—"}</td>
                      <td className="num mono">{fmtNum(s.sent_quantity)}</td>
                      <td>
                        <div className="mini-actions">
                          <button className="mini-act" title="Edit" onClick={() => startEdit(s)}><Icon name="pencil" size={14} /></button>
                          <button className="mini-act danger" title={isAdmin ? "Delete" : "Admin only"} disabled={deleteM.isPending} onClick={() => setDeleteTarget(s)}><Icon name="trash" size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted-note">No shipments yet.</p>
            )}
          </div>

          <div className="split-right">
            <div className="sum-title">{editingId ? "Edit shipment" : "Log new shipment"}</div>
            <div className="field">
              <label>Sent quantity (m)</label>
              <input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="2400" />
            </div>
            <div className="field">
              <label>Lot no</label>
              <input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Lot 24" />
            </div>
            <div className="foot-actions" style={{ marginTop: 4 }}>
              {editingId && <button className="btn btn-ghost" onClick={resetForm}>Cancel edit</button>}
              <button
                className="btn btn-primary"
                disabled={!canSave || saving}
                onClick={() => (editingId ? updateM.mutate() : createM.mutate())}
              >
                {saving ? "Saving…" : editingId ? "Update shipment" : "Log shipment"}
              </button>
            </div>
            <div className="subtle-note">
              <Icon name="info" size={16} />
              <span>Logging a shipment creates its lot in the system. Over-shipment is allowed — you&apos;ll get a warning but it still saves.</span>
            </div>
          </div>
        </div>
      </div>

      {deleteTarget && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)}>
          <div className="modal sm" role="dialog" aria-modal="true" aria-label="Delete shipment?">
            <div className="modal-head">
              <div>
                <h3>Delete shipment?</h3>
                <p>Lot <span className="mono">{deleteTarget.lot_no ?? "—"}</span> · <span className="mono">{fmtNum(deleteTarget.sent_quantity)}</span> m</p>
              </div>
              <button className="close-x" onClick={() => setDeleteTarget(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                This permanently deletes the shipment <b>and its lot</b> from the queue.
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
