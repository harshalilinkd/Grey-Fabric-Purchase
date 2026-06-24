"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { PoFormModal } from "./PoFormModal";
import { TrackModal } from "./TrackModal";
import { ReceiveStockModal, type ReceiveStockValues } from "./ReceiveStockModal";
import { ArchiveConfirmModal } from "./ArchiveConfirmModal";
import { ArchivedPosModal } from "./ArchivedPosModal";
import {
  createPurchaseOrder,
  deletePurchaseOrder,
  fetchPoColorVariants,
  fetchPurchaseOrders,
  fetchQualityNames,
  receiveAndQc,
  restorePurchaseOrder,
  setPoArchived,
  updatePurchaseOrder,
} from "@/lib/purchase-orders";
import { optimisticList, optimisticPatch, optimisticRemove } from "@/lib/optimistic";
import { usePagePrimaryAction, usePageSearchInput, useRegisterCommands } from "@/components/experience/CommandProvider";
import { fetchActiveMasterNames } from "@/lib/masters";
import { fetchWarehouseLog } from "@/lib/warehouse";
import { QUALITY_DEFAULTS, SOURCING_LABEL, isFinishedGoodsPo } from "@/lib/po-meta";
import { fmtDate, fmtNum, round2 } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type { PoColorVariant, PoFormValues, PurchaseOrder } from "@/lib/types";

const PO_KEY = ["purchase_orders"] as const;

type ColKey =
  | "po_no" | "vendor_name" | "quality" | "sourcing_path"
  | "quantity" | "order_date" | "process";

const COLUMNS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "po_no", label: "PO No" },
  { key: "vendor_name", label: "Vendor" },
  { key: "quality", label: "Quality" },
  { key: "sourcing_path", label: "Sourcing" },
  { key: "quantity", label: "Total Qty", num: true },
  { key: "order_date", label: "Order date" },
  { key: "process", label: "Process" },
];

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Mirror of the PO payload (incl. path nulling) for optimistic table rows. */
function poFields(v: PoFormValues) {
  const path = v.sourcing_path || null;
  const qty = num(v.quantity);
  const rate = num(v.rate);
  return {
    vendor_name: v.vendor_name.trim() || null,
    process: v.process.trim() || null,
    quality: v.quality.trim() || null,
    order_date: v.order_date || null,
    order_no: v.order_no.trim() || null,
    po_no: v.po_no.trim() || null,
    delivery_days: v.delivery_days.trim() ? parseInt(v.delivery_days, 10) : null,
    quantity: qty,
    rate,
    amount: qty != null && rate != null ? round2(qty * rate) : null,
    sourcing_path: path,
    quality_name: v.quality_name.trim() || null,
    selling_merchant_no: v.selling_merchant_no.trim() || null,
    vendor_design_no: v.vendor_design_no.trim() || null,
    sampling_status: path === "direct_purchase" || path === "imported" ? "not_required" : v.sampling_status || "pending",
    cad_ref: path === "checks_weaves" && v.checks_method === "cad" ? v.cad_ref.trim() || null : null,
    handloom_ref: path === "checks_weaves" && v.checks_method === "handloom" ? v.handloom_ref.trim() || null : null,
    checks_method: path === "checks_weaves" ? v.checks_method || null : null,
    weaving_design: path === "checks_weaves" && v.checks_method === "handloom" ? v.weaving_design.trim() || null : null,
    direct_subtype: path === "direct_purchase" ? v.direct_subtype || null : null,
  };
}

export function PurchaseOrdersClient({
  initialData,
  isAdmin,
  isSuperAdmin = false,
  initialQualityNames,
}: {
  initialData: PurchaseOrder[];
  isAdmin: boolean;
  isSuperAdmin?: boolean;
  initialQualityNames: string[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: pos = [], isFetching } = useQuery({ queryKey: PO_KEY, queryFn: fetchPurchaseOrders, initialData });
  const { data: qualityNames = [] } = useQuery({ queryKey: ["po-quality-names"], queryFn: fetchQualityNames, initialData: initialQualityNames });
  const { data: vendorNames = [] } = useQuery({ queryKey: ["masters-active", "vendors"], queryFn: () => fetchActiveMasterNames("vendors") });
  const { data: processNames = [] } = useQuery({ queryKey: ["masters-active", "processes"], queryFn: () => fetchActiveMasterNames("processes") });
  const { data: warehouse = [] } = useQuery({ queryKey: ["warehouse_all"], queryFn: fetchWarehouseLog });

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" }>({ key: "po_no", dir: "asc" });
  const [visible, setVisible] = useState<Record<ColKey, boolean>>({
    po_no: true, vendor_name: true, quality: true, sourcing_path: true,
    quantity: true, order_date: true, process: false,
  });
  const [colMenu, setColMenu] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [trackPo, setTrackPo] = useState<PurchaseOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseOrder | null>(null);
  const [receivePo, setReceivePo] = useState<PurchaseOrder | null>(null);
  const [archivePo, setArchivePo] = useState<PurchaseOrder | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  const openNew = useCallback(() => { setEditing(null); setFormOpen(true); }, []);
  usePagePrimaryAction("New PO", openNew);
  useRegisterCommands(
    () => [{ id: "po:search", title: "Search purchase orders", group: "This page", icon: "search", run: () => searchRef.current?.focus() }],
    [],
  );

  const qualitySuggestions = useMemo(() => {
    const set = new Set<string>([...QUALITY_DEFAULTS, ...qualityNames]);
    for (const p of pos) if (p.quality) set.add(p.quality);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [qualityNames, pos]);

  // Metres already in the Ready-Goods ledger per PO — drives the finished-goods
  // "Receive into stock" → "In stock" action on direct-purchase/imported rows.
  const stockedByUid = useMemo(() => {
    const m: Record<string, number> = {};
    for (const w of warehouse) if (w.po_unique_id) m[w.po_unique_id] = (m[w.po_unique_id] ?? 0) + (w.passed_qty ?? 0);
    return m;
  }, [warehouse]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: PO_KEY });
  };

  const createM = useMutation({
    mutationFn: (v: PoFormValues) => createPurchaseOrder(v),
    onMutate: async (v: PoFormValues) => {
      setFormOpen(false);
      await qc.cancelQueries({ queryKey: PO_KEY });
      const now = new Date().toISOString();
      const tempId = `temp-${now}`;
      const temp = { id: tempId, unique_id: tempId, created_at: now, updated_at: now, ...poFields(v) } as PurchaseOrder;
      return { rollback: optimisticList<PurchaseOrder>(qc, PO_KEY, (cur) => [temp, ...cur]) };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: () => toast.success("Purchase order created"),
    onSettled: () => invalidate(),
  });

  const updateM = useMutation({
    mutationFn: ({ id, v }: { id: string; v: PoFormValues }) => updatePurchaseOrder(id, v),
    onMutate: async ({ id, v }) => {
      setFormOpen(false);
      setEditing(null);
      await qc.cancelQueries({ queryKey: PO_KEY });
      qc.invalidateQueries({ queryKey: ["po-variants", id] });
      return { rollback: optimisticPatch<PurchaseOrder>(qc, PO_KEY, (p) => p.id === id, poFields(v) as Partial<PurchaseOrder>) };
    },
    onError: (e: Error, _vars, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: () => toast.success("Purchase order updated"),
    onSettled: () => invalidate(),
  });

  const restoreM = useMutation({
    mutationFn: ({ po, variants }: { po: PurchaseOrder; variants: PoColorVariant[] }) => restorePurchaseOrder(po, variants),
    onSuccess: () => { toast.success("Purchase order restored"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteM = useMutation({
    mutationFn: (po: PurchaseOrder) => deletePurchaseOrder(po.id),
    onMutate: async (po: PurchaseOrder) => {
      setDeleteTarget(null);
      await qc.cancelQueries({ queryKey: PO_KEY });
      const rollback = optimisticRemove<PurchaseOrder>(qc, PO_KEY, (p) => p.id === po.id);
      // snapshot the colours (CASCADE-deleted with the PO) so Undo restores them too
      const variants = await fetchPoColorVariants(po.id).catch(() => [] as PoColorVariant[]);
      return { rollback, variants };
    },
    onError: (e: Error, _po, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: (_data, po, ctx) =>
      toast.success("Purchase order deleted", { action: { label: "Undo", onClick: () => restoreM.mutate({ po, variants: ctx?.variants ?? [] }) } }),
    onSettled: () => invalidate(),
  });

  // Finished goods (direct purchase / imported) → QC'd on receipt; passed metres stored,
  // failed metres routed to Reissue & Return, and a QC record written.
  const receiveM = useMutation({
    mutationFn: ({ po, values }: { po: PurchaseOrder; values: ReceiveStockValues }) =>
      receiveAndQc(po.unique_id, values),
    onError: (e: Error) => toast.error(e.message),
    onSuccess: (res) => {
      const parts = [`${res.warehouse} stored`];
      if (res.reissue) parts.push(`${res.reissue} to reissue`);
      toast.success(`Received & QC'd — ${parts.join(", ")}`);
      setReceivePo(null);
      ["warehouse_all", "reissue_return", "qc_inspections", "qc_lots"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });

  // Archive/restore touches many domains — refresh their query keys so the rows vanish/return everywhere.
  const refreshArchive = () =>
    ["purchase_orders", "warehouse_all", "shipments_all", "program_cards", "qc_lots", "reissue_return", "final_receipts", "dyeing_followups", "fabric_receipts", "archived-pos"]
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const archiveM = useMutation({
    mutationFn: (po: PurchaseOrder) => setPoArchived(po.unique_id, true),
    onSuccess: (res, po) => {
      setArchivePo(null);
      const linked = res.shipments + res.programs + res.qc + res.warehouse + res.reissue + res.final_receipts + res.dyeing_followups + res.fabric_receipts;
      toast.success(`Archived PO ${po.po_no ?? po.unique_id}${linked ? ` + ${linked} linked record${linked === 1 ? "" : "s"}` : ""}`, {
        action: { label: "Undo", onClick: () => restoreArchivedM.mutate(po) },
      });
      refreshArchive();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const restoreArchivedM = useMutation({
    mutationFn: (po: PurchaseOrder) => setPoArchived(po.unique_id, false),
    onSuccess: (_res, po) => { toast.success(`Restored PO ${po.po_no ?? po.unique_id}`); refreshArchive(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const periodArchiveM = useMutation({
    mutationFn: async (uids: string[]) => { for (const uid of uids) await setPoArchived(uid, true); return uids.length; },
    onSuccess: (n) => { toast.success(`Archived ${n} PO${n === 1 ? "" : "s"}`); refreshArchive(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    let rows = pos;
    if (query) {
      rows = rows.filter((p) =>
        [p.po_no, p.vendor_name, p.process, p.quality, SOURCING_LABEL[p.sourcing_path ?? ""]]
          .some((f) => (f ?? "").toLowerCase().includes(query)),
      );
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key as keyof PurchaseOrder];
      const bv = b[sort.key as keyof PurchaseOrder];
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
    if (k === "sourcing_path") return p.sourcing_path ? <span className="pill plain">{SOURCING_LABEL[p.sourcing_path] ?? p.sourcing_path}</span> : <span className="dim">—</span>;
    return <span>{(p[k as keyof PurchaseOrder] as string | null) ?? "—"}</span>;
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
          <input ref={searchRef} placeholder="Search PO, vendor, quality, design no…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                    <input type="checkbox" checked={visible[c.key]} onChange={() => setVisible((vis) => ({ ...vis, [c.key]: !vis[c.key] }))} />
                    {c.label}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        {isSuperAdmin && (
          <button className="btn btn-ghost" onClick={() => setShowArchived(true)}>
            <Icon name="box" size={15} />Archived
          </button>
        )}
        {isFetching && <span className="fetching">Updating…</span>}
      </div>

      <div className="table-wrap">
        {filtered.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {shownCols.map((c) => (
                    <th key={c.key} className={`sortable ${c.num ? "num" : ""}`} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
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
                        {isFinishedGoodsPo(p) && (
                          (p.quantity ?? 0) > 0 && (stockedByUid[p.unique_id] ?? 0) >= (p.quantity ?? 0) ? (
                            <span className="pill success" title="Received into stock"><Icon name="check" size={13} />In stock</span>
                          ) : (
                            <button className="act" title="Receive & QC finished goods" onClick={() => setReceivePo(p)}>
                              <Icon name="checkCircle" size={15} />Receive &amp; QC
                            </button>
                          )
                        )}
                        <button className="act" title="Track lifecycle" onClick={() => setTrackPo(p)}>
                          <Icon name="info" size={15} />Track
                        </button>
                        <button className="act" title="Edit" onClick={() => { setEditing(p); setFormOpen(true); }}>
                          <Icon name="pencil" size={15} />
                        </button>
                        {isSuperAdmin && (
                          <button className="act" title="Archive PO + all linked data" onClick={() => setArchivePo(p)}>
                            <Icon name="box" size={15} />
                          </button>
                        )}
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
        qualitySuggestions={qualitySuggestions}
        vendorSuggestions={vendorNames}
        processSuggestions={processNames}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSave={(v) => (editing ? updateM.mutate({ id: editing.id, v }) : createM.mutate(v))}
      />

      {trackPo && <TrackModal po={trackPo} onClose={() => setTrackPo(null)} />}

      {archivePo && (
        <ArchiveConfirmModal
          po={archivePo}
          saving={archiveM.isPending}
          onClose={() => setArchivePo(null)}
          onConfirm={() => archiveM.mutate(archivePo)}
        />
      )}

      {showArchived && (
        <ArchivedPosModal
          pos={pos}
          restoringId={restoreArchivedM.isPending ? restoreArchivedM.variables?.unique_id ?? null : null}
          archivingPeriod={periodArchiveM.isPending}
          onRestore={(po) => restoreArchivedM.mutate(po)}
          onArchivePeriod={(uids) => periodArchiveM.mutate(uids)}
          onClose={() => setShowArchived(false)}
        />
      )}

      {receivePo && (
        <ReceiveStockModal
          po={receivePo}
          alreadyStocked={stockedByUid[receivePo.unique_id] ?? 0}
          saving={receiveM.isPending}
          onClose={() => setReceivePo(null)}
          onSave={(values) => receiveM.mutate({ po: receivePo, values })}
        />
      )}

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
                This permanently deletes the purchase order and its colour variants. Its shipments and programs are <b>kept</b>.
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
