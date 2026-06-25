"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { usePagePrimaryAction, usePageSearchInput, useRegisterCommands } from "@/components/experience/CommandProvider";
import { SampleFormModal } from "./SampleFormModal";
import { PoFormModal } from "@/components/purchase-orders/PoFormModal";
import {
  createSampleApproval,
  deleteSampleApproval,
  fetchSampleApprovals,
  linkSampleToPo,
  setSampleStatus,
} from "@/lib/sample-approvals";
import { createPurchaseOrder, fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fetchActiveMasterNames } from "@/lib/masters";
import { CHECKS_METHOD_LABEL, QUALITY_DEFAULTS, SOURCING_LABEL, sourcingFlow } from "@/lib/po-meta";
import { optimisticList, optimisticPatch, optimisticRemove } from "@/lib/optimistic";
import { fmtDate } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import type {
  PoFormValues,
  PurchaseOrder,
  SampleApproval,
  SampleApprovalFormValues,
  SampleApprovalStatus,
} from "@/lib/types";

const SA_KEY = ["sample_approvals"] as const;
type View = "all" | "Pending" | "Approved" | "Rejected";

const statusPill = (s: SampleApprovalStatus) => (s === "Approved" ? "success" : s === "Rejected" ? "danger" : "warning");

function sourceLabel(s: SampleApproval): string {
  const base = s.sourcing_path ? SOURCING_LABEL[s.sourcing_path] ?? s.sourcing_path : "—";
  if (s.sourcing_path === "checks_weaves" && s.checks_method) return `${base} · ${CHECKS_METHOD_LABEL[s.checks_method] ?? s.checks_method}`;
  return base;
}

function optimisticSample(v: SampleApprovalFormValues): SampleApproval {
  const now = new Date().toISOString();
  const isChecks = v.sourcing_path === "checks_weaves";
  return {
    id: `temp-${now}`,
    approval_id: `SA-${now}`,
    sourcing_path: v.sourcing_path || null,
    checks_method: isChecks ? v.checks_method || null : null,
    vendor_name: v.vendor_name.trim() || null,
    quality_name: v.quality_name.trim() || null,
    vendor_design_no: v.vendor_design_no.trim() || null,
    selling_merchant_no: v.selling_merchant_no.trim() || null,
    cad_ref: isChecks && v.checks_method === "cad" ? v.cad_ref.trim() || null : null,
    handloom_ref: isChecks && v.checks_method === "handloom" ? v.handloom_ref.trim() || null : null,
    sample_date: v.sample_date || null,
    remark: v.remark.trim() || null,
    status: "Pending",
    approved_date: null,
    po_unique_id: null,
    created_at: now,
  };
}

export function SampleApprovalClient({
  initialSamples,
  isAdmin,
}: {
  initialSamples: SampleApproval[];
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: samples = [], isFetching } = useQuery({ queryKey: SA_KEY, queryFn: fetchSampleApprovals, initialData: initialSamples });
  const { data: pos = [] } = useQuery({ queryKey: ["purchase_orders"], queryFn: fetchPurchaseOrders, initialData: [] as PurchaseOrder[] });
  const { data: vendorNames = [] } = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => fetchActiveMasterNames("vendors") });
  const { data: processNames = [] } = useQuery({ queryKey: ["masters", "processes"], queryFn: () => fetchActiveMasterNames("processes") });
  const { data: qualityNames = [] } = useQuery({ queryKey: ["masters", "qualities"], queryFn: () => fetchActiveMasterNames("qualities") });

  const qualitySuggestions = useMemo(() => Array.from(new Set([...QUALITY_DEFAULTS, ...qualityNames])).sort((a, b) => a.localeCompare(b)), [qualityNames]);

  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<SampleApproval | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SampleApproval | null>(null);
  const [raisePoFor, setRaisePoFor] = useState<SampleApproval | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  const openNew = useCallback(() => setFormOpen(true), []);
  usePagePrimaryAction("New sample", openNew);
  useRegisterCommands(
    () => [{ id: "sa:search", title: "Search samples", group: "This page", icon: "search", run: () => searchRef.current?.focus() }],
    [],
  );

  useEscClose(!!detail, () => setDetail(null));
  useEscClose(!!deleteTarget, () => setDeleteTarget(null));

  const poNoByUid = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of pos) if (p.unique_id) m[p.unique_id] = p.po_no ?? p.unique_id;
    return m;
  }, [pos]);

  const counts = useMemo(
    () => ({
      all: samples.length,
      Pending: samples.filter((s) => s.status === "Pending").length,
      Approved: samples.filter((s) => s.status === "Approved").length,
      Rejected: samples.filter((s) => s.status === "Rejected").length,
    }),
    [samples],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = samples;
    if (view !== "all") list = list.filter((s) => s.status === view);
    if (!q) return list;
    return list.filter((s) =>
      [s.approval_id, s.vendor_name, s.quality_name, s.vendor_design_no, sourceLabel(s)].some((f) => (f ?? "").toLowerCase().includes(q)),
    );
  }, [samples, view, search]);

  const createM = useMutation({
    mutationFn: (v: SampleApprovalFormValues) => createSampleApproval(v),
    onMutate: async (v) => {
      setFormOpen(false);
      await qc.cancelQueries({ queryKey: SA_KEY });
      return { rollback: optimisticList<SampleApproval>(qc, SA_KEY, (cur) => [optimisticSample(v), ...cur]) };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: () => toast.success("Sample created"),
    onSettled: () => qc.invalidateQueries({ queryKey: SA_KEY }),
  });

  const statusM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SampleApprovalStatus }) => setSampleStatus(id, status),
    onMutate: async ({ id, status }) => {
      setDetail(null);
      await qc.cancelQueries({ queryKey: SA_KEY });
      const approved_date = status === "Approved" ? new Date().toISOString().slice(0, 10) : null;
      return { rollback: optimisticPatch<SampleApproval>(qc, SA_KEY, (r) => r.id === id, { status, approved_date }) };
    },
    onError: (e: Error, _v, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: (_d, { status }) => toast.success(`Sample ${status.toLowerCase()}`),
    onSettled: () => qc.invalidateQueries({ queryKey: SA_KEY }),
  });

  const deleteM = useMutation({
    mutationFn: (s: SampleApproval) => deleteSampleApproval(s.id),
    onMutate: async (s) => {
      setDeleteTarget(null);
      await qc.cancelQueries({ queryKey: SA_KEY });
      return { rollback: optimisticRemove<SampleApproval>(qc, SA_KEY, (r) => r.id === s.id) };
    },
    onError: (e: Error, _s, ctx) => { ctx?.rollback(); toast.error(e.message); },
    onSuccess: () => toast.success("Sample deleted"),
    onSettled: () => qc.invalidateQueries({ queryKey: SA_KEY }),
  });

  // Raise a PO from an approved sample: create the PO, then link it back to the sample.
  const raisePoM = useMutation({
    mutationFn: async ({ values, sampleId }: { values: PoFormValues; sampleId: string }) => {
      const po = await createPurchaseOrder(values);
      await linkSampleToPo(sampleId, po.unique_id).catch(() => {}); // PO is created either way
      return po;
    },
    // keep the (long) PO form open until the create succeeds, so a transient failure is retryable
    onError: (e: Error) => toast.error(e.message),
    onSuccess: (po) => {
      setRaisePoFor(null);
      toast.success(`PO ${po.po_no ?? po.unique_id} created from sample`);
      qc.invalidateQueries({ queryKey: SA_KEY });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
    },
  });

  // Stable prefill for the PO form while the modal is open (memoized on the chosen sample).
  const poPrefill = useMemo<Partial<PoFormValues> | null>(() => {
    if (!raisePoFor) return null;
    const s = raisePoFor;
    const isChecks = s.sourcing_path === "checks_weaves";
    return {
      sourcing_path: s.sourcing_path ?? "",
      checks_method: isChecks ? s.checks_method ?? "" : "",
      vendor_name: s.vendor_name ?? "",
      quality_name: s.quality_name ?? "",
      vendor_design_no: s.vendor_design_no ?? "",
      selling_merchant_no: s.selling_merchant_no ?? "",
      cad_ref: isChecks && s.checks_method === "cad" ? s.cad_ref ?? "" : "",
      handloom_ref: isChecks && s.checks_method === "handloom" ? s.handloom_ref ?? "" : "",
      sampling_status: "approved",
    };
  }, [raisePoFor]);

  const detailSteps = useMemo(() => {
    if (!detail?.sourcing_path) return [] as string[];
    const flow = sourcingFlow(detail.sourcing_path, { checks_method: detail.checks_method });
    const i = flow.indexOf("PO");
    return i >= 0 ? flow.slice(0, i) : flow;
  }, [detail]);

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Sampling &amp; Approval</h1>
          <p>Pre-PO sample submissions and their approval — raise a PO once a sample is approved</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <Icon name="plus" />New sample
        </button>
      </div>

      <div className="toolbar split">
        <div className="seg" role="group" aria-label="Filter by status">
          {(["all", "Pending", "Approved", "Rejected"] as View[]).map((v) => (
            <button key={v} className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "all" ? "All" : v} <span className="cnt mono">{counts[v]}</span>
            </button>
          ))}
        </div>
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder="Search vendor, quality, design no, source…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isFetching && <span className="fetching">Updating…</span>}
      </div>

      <div className="table-wrap">
        {rows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sample ID</th>
                  <th>Source</th>
                  <th>Vendor</th>
                  <th>Quality name</th>
                  <th>Design no</th>
                  <th>Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setDetail(s)}>
                    <td><span className="strong mono">{s.approval_id}</span></td>
                    <td>{sourceLabel(s)}</td>
                    <td>{s.vendor_name ?? <span className="dim">—</span>}</td>
                    <td>{s.quality_name ?? <span className="dim">—</span>}</td>
                    <td><span className="mono">{s.vendor_design_no ?? "—"}</span></td>
                    <td>
                      <span className={`pill ${statusPill(s.status)}`}>{s.status}</span>
                      {s.po_unique_id && <span className="pill brand mono" style={{ marginLeft: 6 }}>PO {poNoByUid[s.po_unique_id] ?? s.po_unique_id}</span>}
                    </td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        <button className="act" onClick={() => setDetail(s)}><Icon name="info" size={15} />Details</button>
                        {isAdmin && (
                          <button className="act danger" title="Delete sample" aria-label={`Delete ${s.approval_id}`} onClick={() => setDeleteTarget(s)}>
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
            <div className="ph-icon"><Icon name="checkCircle" size={26} /></div>
            <h3>{samples.length ? (search.trim() ? "No matching samples" : "Nothing here") : "No samples yet"}</h3>
            <p>
              {samples.length
                ? search.trim() ? "Try a different search." : "No samples in this status."
                : "Log a sample for a grey / client-fabric / checks order. Once approved, you can raise its PO."}
            </p>
            {!samples.length && <button className="btn btn-primary" onClick={openNew}><Icon name="plus" />New sample</button>}
          </div>
        )}
      </div>

      <SampleFormModal
        open={formOpen}
        saving={createM.isPending}
        vendorSuggestions={vendorNames}
        qualitySuggestions={qualitySuggestions}
        onClose={() => setFormOpen(false)}
        onSave={(v) => createM.mutate(v)}
      />

      <PoFormModal
        open={!!raisePoFor}
        editing={null}
        prefill={poPrefill}
        saving={raisePoM.isPending}
        qualitySuggestions={qualitySuggestions}
        vendorSuggestions={vendorNames}
        processSuggestions={processNames}
        onClose={() => setRaisePoFor(null)}
        onSave={(values) => raisePoFor && raisePoM.mutate({ values, sampleId: raisePoFor.id })}
      />

      {detail && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Sample details">
            <div className="modal-head">
              <div>
                <h3>Sample <span className="mono">{detail.approval_id}</span></h3>
                <p>{sourceLabel(detail)}</p>
              </div>
              <button className="close-x" onClick={() => setDetail(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <div className="sum">
                <div className="sum-row"><span>Status</span><b><span className={`pill ${statusPill(detail.status)}`}>{detail.status}</span></b></div>
                <div className="sum-row"><span>Vendor</span><b>{detail.vendor_name ?? "—"}</b></div>
                <div className="sum-row"><span>Quality name</span><b>{detail.quality_name ?? "—"}</b></div>
                <div className="sum-row"><span>Vendor design no</span><b className="mono">{detail.vendor_design_no ?? "—"}</b></div>
                <div className="sum-row"><span>Selling merchant no</span><b className="mono">{detail.selling_merchant_no ?? "—"}</b></div>
                {detail.cad_ref && <div className="sum-row"><span>CAD ref</span><b className="mono">{detail.cad_ref}</b></div>}
                {detail.handloom_ref && <div className="sum-row"><span>Handloom ref</span><b className="mono">{detail.handloom_ref}</b></div>}
                <div className="sum-row"><span>Sample date</span><b>{fmtDate(detail.sample_date)}</b></div>
                {detail.approved_date && <div className="sum-row"><span>Approved on</span><b>{fmtDate(detail.approved_date)}</b></div>}
                {detail.remark && <div className="sum-row"><span>Remark</span><b>{detail.remark}</b></div>}
                {detail.po_unique_id && <div className="sum-row"><span>PO raised</span><b className="mono">{poNoByUid[detail.po_unique_id] ?? detail.po_unique_id}</b></div>}
              </div>

              {detailSteps.length > 0 && (
                <>
                  <div className="sum-title">Sampling steps</div>
                  <div className="path-flow" role="group" aria-label="Sampling steps">
                    {detailSteps.map((s, i) => (
                      <span key={s} className={`path-flow-step${i === detailSteps.length - 1 ? " qc" : ""}`}>{s}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <span className="amt-preview" />
              <div className="foot-actions">
                {detail.status === "Pending" && (
                  <>
                    <button className="btn btn-danger" disabled={statusM.isPending} onClick={() => statusM.mutate({ id: detail.id, status: "Rejected" })}>Reject</button>
                    <button className="btn btn-primary" disabled={statusM.isPending} onClick={() => statusM.mutate({ id: detail.id, status: "Approved" })}>Approve</button>
                  </>
                )}
                {detail.status === "Rejected" && (
                  <button className="btn btn-ghost" disabled={statusM.isPending} onClick={() => statusM.mutate({ id: detail.id, status: "Pending" })}>Reopen</button>
                )}
                {detail.status === "Approved" && !detail.po_unique_id && (
                  <button className="btn btn-primary" onClick={() => { setRaisePoFor(detail); setDetail(null); }}>
                    <Icon name="file" size={15} />Raise PO
                  </button>
                )}
                {detail.status === "Approved" && detail.po_unique_id && (
                  <span className="pill success">PO {poNoByUid[detail.po_unique_id] ?? detail.po_unique_id}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)}>
          <div className="modal sm" role="dialog" aria-modal="true" aria-label="Delete sample?">
            <div className="modal-head">
              <div>
                <h3>Delete this sample?</h3>
                <p><span className="mono">{deleteTarget.approval_id}</span></p>
              </div>
              <button className="close-x" onClick={() => setDeleteTarget(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                This removes the sample record{deleteTarget.po_unique_id ? " (the PO already raised from it is not affected)" : ""}.
                <br /><span className="confirm-warn">This can&apos;t be undone.</span>
              </p>
            </div>
            <div className="modal-foot">
              <span className="amt-preview" />
              <div className="foot-actions">
                <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button className="btn btn-danger" disabled={deleteM.isPending} onClick={() => deleteM.mutate(deleteTarget)}>
                  {deleteM.isPending ? "Deleting…" : "Delete sample"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
