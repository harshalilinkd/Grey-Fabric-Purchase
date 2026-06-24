"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { CountUp } from "@/components/ui/CountUp";
import { useToast } from "@/components/ui/Toast";
import { usePagePrimaryAction, usePageSearchInput } from "@/components/experience/CommandProvider";
import { DyeingFollowupFormModal, type DyeingLot } from "./DyeingFollowupFormModal";
import { createDyeingFollowup, fetchDyeingFollowups } from "@/lib/dyeing-followups";
import { fetchProgramCards } from "@/lib/program-cards";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fetchQcCheckedLotNos } from "@/lib/dyeing-queue";
import { optimisticList } from "@/lib/optimistic";
import { fmtDate, fmtNum } from "@/lib/format";
import type { DyeingFollowup, DyeingFollowupFormValues, ProgramCard, PurchaseOrder } from "@/lib/types";

const DF_KEY = ["dyeing_followups"] as const;
const todayISO = () => new Date().toISOString().slice(0, 10);
const isOverdue = (date: string | null, today: string) => !!date && date <= today;

type ColKey = "lot_no" | "po_no" | "dying_house" | "remaining" | "next_followup_date" | "remark";

const COLUMNS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "lot_no", label: "Lot No" },
  { key: "po_no", label: "PO No" },
  { key: "dying_house", label: "Dyeing House" },
  { key: "remaining", label: "Remaining (m)", num: true },
  { key: "next_followup_date", label: "Next Follow-up" },
  { key: "remark", label: "Remark" },
];

type DRow = DyeingFollowup & { po_no: string | null; vendor: string | null; dying_house: string | null; remaining: number | null; overdue: boolean };

function optimisticFollowup(v: DyeingFollowupFormValues): DyeingFollowup {
  const now = new Date().toISOString();
  const r = Number(v.remaining_meters);
  return {
    id: `temp-${now}`,
    followup_id: `DF-${now}`,
    lot_no: v.lot_no.trim() || null,
    po_unique_id: v.po_unique_id || null,
    dying_house_name: v.dying_house_name.trim() || null,
    remaining_meters: v.remaining_meters.trim() !== "" && Number.isFinite(r) ? r : null,
    next_followup_date: v.next_followup_date || null,
    remark: v.remark.trim() || null,
    created_at: now,
  };
}

export function DyeingFollowupClient({
  initialFollowups,
  initialPrograms,
  initialPos,
  initialQcLots,
}: {
  initialFollowups: DyeingFollowup[];
  initialPrograms: ProgramCard[];
  initialPos: PurchaseOrder[];
  initialQcLots: string[];
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: followups = [], isFetching } = useQuery({ queryKey: DF_KEY, queryFn: fetchDyeingFollowups, initialData: initialFollowups });
  const { data: programs = [] } = useQuery({ queryKey: ["program_cards"], queryFn: fetchProgramCards, initialData: initialPrograms });
  const { data: pos = [] } = useQuery({ queryKey: ["purchase_orders"], queryFn: fetchPurchaseOrders, initialData: initialPos });
  const { data: qcLots = [] } = useQuery({ queryKey: ["qc_lots"], queryFn: fetchQcCheckedLotNos, initialData: initialQcLots });

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" }>({ key: "next_followup_date", dir: "asc" });
  const [formOpen, setFormOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  const openNew = useCallback(() => setFormOpen(true), []);
  usePagePrimaryAction("Log dyeing follow-up", openNew);

  const today = todayISO();

  const poByUid = useMemo(() => {
    const m: Record<string, PurchaseOrder> = {};
    for (const p of pos) m[p.unique_id] = p;
    return m;
  }, [pos]);

  // Lots at the dyeing house = have a program card, not yet QC'd.
  const availableLots = useMemo<DyeingLot[]>(() => {
    const qcSet = new Set(qcLots);
    const seen = new Set<string>();
    const out: DyeingLot[] = [];
    for (const p of programs) {
      if (!p.lot_no || qcSet.has(p.lot_no) || seen.has(p.lot_no)) continue;
      seen.add(p.lot_no);
      const po = poByUid[p.po_unique_id];
      out.push({ lot_no: p.lot_no, po_unique_id: p.po_unique_id, po_no: po?.po_no ?? null, vendor: po?.vendor_name ?? null, dying_house_name: p.dying_house_name ?? null, total_meters: p.total_meters ?? null });
    }
    return out;
  }, [programs, qcLots, poByUid]);

  const enriched = useMemo<DRow[]>(
    () =>
      followups.map((f) => {
        const po = f.po_unique_id ? poByUid[f.po_unique_id] : undefined;
        return { ...f, po_no: po?.po_no ?? null, vendor: po?.vendor_name ?? null, dying_house: f.dying_house_name ?? null, remaining: f.remaining_meters, overdue: isOverdue(f.next_followup_date, today) };
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
      if (sort.key === "remaining") return ((av as number) - (bv as number)) * dir;
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
    onSuccess: () => toast.success("Follow-up logged"),
    onSettled: () => qc.invalidateQueries({ queryKey: DF_KEY }),
  });

  const renderCell = (r: DRow, k: ColKey) => {
    if (k === "remaining") return <span className="mono">{fmtNum(r.remaining)}</span>;
    if (k === "lot_no") return <span className="mono">{r.lot_no ?? "—"}</span>;
    if (k === "po_no") return <span className="strong mono">{r.po_no ?? "—"}</span>;
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
          <h1>Dyeing Follow Up</h1>
          <p>Lots still at the dyeing house — overdue follow-ups float to the top</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <Icon name="plus" />Log follow-up
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
      </div>

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
                : "Log a follow-up for a lot at the dyeing house to track its remaining metres and next check-in."}
            </p>
            {!hasData && (
              <button className="btn btn-primary" onClick={openNew}>
                <Icon name="plus" />Log follow-up
              </button>
            )}
          </div>
        )}
      </div>

      <DyeingFollowupFormModal
        open={formOpen}
        availableLots={availableLots}
        saving={createM.isPending}
        onClose={() => setFormOpen(false)}
        onSave={(v) => createM.mutate(v)}
      />
    </>
  );
}
