"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { PoFormModal } from "./PoFormModal";
import { TrackModal } from "./TrackModal";
import {
  createPurchaseOrder,
  deletePurchaseOrder,
  fetchPurchaseOrders,
  restorePurchaseOrder,
  updatePurchaseOrder,
} from "@/lib/purchase-orders";
import { optimisticRemove } from "@/lib/optimistic";
import { usePagePrimaryAction, usePageSearchInput } from "@/components/experience/CommandProvider";
import { fmtDate, fmtNum } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PoFormValues, PurchaseOrder } from "@/lib/types";

const PO_KEY = ["purchase_orders"] as const;

type ColKey = "po_no" | "vendor_name" | "process" | "quality" | "order_date" | "quantity";

const COLUMNS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "po_no", label: "PO No" },
  { key: "vendor_name", label: "Vendor" },
  { key: "process", label: "Process" },
  { key: "quality", label: "Quality" },
  { key: "order_date", label: "Order date" },
  { key: "quantity", label: "Total Qty", num: true },
];

export function PurchaseOrdersClient({
  initialData,
  isAdmin,
}: {
  initialData: PurchaseOrder[];
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: pos = [], isFetching } = useQuery({
    queryKey: ["purchase_orders"],
    queryFn: fetchPurchaseOrders,
    initialData,
  });

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" }>({ key: "po_no", dir: "asc" });
  const [visible, setVisible] = useState<Record<ColKey, boolean>>({
    po_no: true, vendor_name: true, process: true, quality: true, order_date: true, quantity: true,
  });
  const [colMenu, setColMenu] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [trackPo, setTrackPo] = useState<PurchaseOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseOrder | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  const openNew = useCallback(() => { setEditing(null); setFormOpen(true); }, []);
  usePagePrimaryAction("New PO", openNew);

  const invalidate = () => qc.invalidateQueries({ queryKey: PO_KEY });

  const createM = useMutation({
    mutationFn: (v: PoFormValues) => createPurchaseOrder(v),
    onSuccess: () => { toast.success("Purchase order created"); invalidate(); setFormOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateM = useMutation({
    mutationFn: ({ id, v }: { id: string; v: PoFormValues }) => updatePurchaseOrder(id, v),
    onSuccess: () => { toast.success("Purchase order updated"); invalidate(); setFormOpen(false); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const restoreM = useMutation({
    mutationFn: (po: PurchaseOrder) => restorePurchaseOrder(po),
    onSuccess: () => { toast.success("Purchase order restored"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Optimistic delete: drop the row instantly, roll back on error, offer Undo (re-insert).
  const deleteM = useMutation({
    mutationFn: (po: PurchaseOrder) => deletePurchaseOrder(po.id),
    onMutate: async (po: PurchaseOrder) => {
      setDeleteTarget(null);
      await qc.cancelQueries({ queryKey: PO_KEY });
      return { rollback: optimisticRemove<PurchaseOrder>(qc, PO_KEY, (p) => p.id === po.id) };
    },
    onError: (e: Error, _po, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: (_data, po) => {
      toast.success("Purchase order deleted", { action: { label: "Undo", onClick: () => restoreM.mutate(po) } });
    },
    onSettled: () => invalidate(),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = pos;
    if (q) {
      rows = rows.filter((p) =>
        [p.po_no, p.vendor_name, p.process].some((f) => (f ?? "").toLowerCase().includes(q)),
      );
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sort.key === "quantity") return ((av as number) - (bv as number)) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [pos, search, sort]);

  const toggleSort = (k: ColKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));

  const renderCell = (p: PurchaseOrder, k: ColKey) => {
    if (k === "order_date") return <span className="dim">{fmtDate(p.order_date)}</span>;
    if (k === "quantity") return <span className="mono">{fmtNum(p.quantity)}</span>;
    if (k === "po_no") return <span className="strong mono">{p.po_no ?? "—"}</span>;
    return <span>{(p[k] as string | null) ?? "—"}</span>;
  };

  const shownCols = COLUMNS.filter((c) => visible[c.key]);
  const hasData = pos.length > 0;

  useEscClose(!!deleteTarget, () => setDeleteTarget(null));

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Purchase Orders</h1>
          <p>Grey fabric purchase orders from vendors</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <Icon name="plus" />New PO
        </button>
      </div>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder="Search PO no, vendor, process…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="col-wrap">
          <button className="btn btn-ghost" onClick={() => setColMenu((o) => !o)}>
            <Icon name="columns" size={15} />Columns
          </button>
          {colMenu && (
            <>
              <div className="col-backdrop" onClick={() => setColMenu(false)} />
              <div className="col-menu">
                {COLUMNS.map((c) => (
                  <label key={c.key}>
                    <input type="checkbox" checked={visible[c.key]} onChange={() => setVisible((v) => ({ ...v, [c.key]: !v[c.key] }))} />
                    {c.label}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        {isFetching && <span className="fetching">Updating…</span>}
      </div>

      <div className="table-wrap">
        {filtered.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {shownCols.map((c) => (
                    <th
                      key={c.key}
                      className={`sortable ${c.num ? "num" : ""}`}
                      aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      <button type="button" className="th-in" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        {sort.key === c.key && <Icon name={sort.dir === "asc" ? "arrowUp" : "arrowDown"} size={13} />}
                      </button>
                    </th>
                  ))}
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    {shownCols.map((c) => (
                      <td key={c.key} className={c.num ? "num" : ""}>{renderCell(p, c.key)}</td>
                    ))}
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="act" title="Track lifecycle" onClick={() => setTrackPo(p)}>
                          <Icon name="info" size={15} />Track
                        </button>
                        <button className="act" title="Edit" onClick={() => { setEditing(p); setFormOpen(true); }}>
                          <Icon name="pencil" size={15} />
                        </button>
                        <button className="act danger" title={isAdmin ? "Delete" : "Admin only"} onClick={() => setDeleteTarget(p)}>
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="ph-icon"><Icon name="file" size={26} /></div>
            <h3>{hasData ? "No matching purchase orders" : "No purchase orders yet"}</h3>
            <p>{hasData ? "Try a different search or clear filters." : "Create your first PO to get started."}</p>
            {!hasData && (
              <button className="btn btn-primary" onClick={openNew}>
                <Icon name="plus" />New PO
              </button>
            )}
          </div>
        )}
      </div>

      <PoFormModal
        open={formOpen}
        editing={editing}
        saving={createM.isPending || updateM.isPending}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSave={(v) => (editing ? updateM.mutate({ id: editing.id, v }) : createM.mutate(v))}
      />

      {trackPo && <TrackModal po={trackPo} onClose={() => setTrackPo(null)} />}

      {deleteTarget && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)}>
          <div className="modal sm" role="dialog" aria-modal="true" aria-label="Delete purchase order?">
            <div className="modal-head">
              <div>
                <h3>Delete purchase order?</h3>
                <p>PO <span className="mono">{deleteTarget.po_no ?? deleteTarget.unique_id}</span></p>
              </div>
              <button className="close-x" onClick={() => setDeleteTarget(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                This permanently deletes the purchase order. Its shipments and programs are <b>kept</b> (not deleted).
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
                <button className="btn btn-danger" disabled={deleteM.isPending} onClick={() => deleteM.mutate(deleteTarget)}>
                  {deleteM.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
