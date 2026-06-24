"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { usePagePrimaryAction, usePageSearchInput } from "@/components/experience/CommandProvider";
import { ProgramCardFormModal, type AvailableLot } from "./ProgramCardFormModal";
import { ProgramCardDetailModal } from "./ProgramCardDetailModal";
import { createProgramCard, fetchProgramCards } from "@/lib/program-cards";
import { fetchPurchaseOrders } from "@/lib/purchase-orders";
import { fetchActiveMasterNames } from "@/lib/masters";
import { fetchAllShipments } from "@/lib/shipments";
import { fetchQcCheckedLotNos } from "@/lib/dyeing-queue";
import { optimisticList } from "@/lib/optimistic";
import { fmtNum, round2 } from "@/lib/format";
import type { ProgramCard, ProgramCardFormValues, PurchaseOrder, Shipment } from "@/lib/types";

const PC_KEY = ["program_cards"] as const;
const LOTS_KEY = ["program_card_lots"] as const;

/** Build an optimistic temp program-card row from the form values. */
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

/** Next "PG-{n}" predicted from the loaded cards (the real id is finalised on insert). */
function predictNextProgramId(cards: ProgramCard[]): string {
  let max = 0;
  for (const c of cards) {
    const m = /^PG-(\d+)$/.exec(c.program_uid ?? "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PG-${max + 1}`;
}

export function ProgramCardsClient({
  initialProgramCards,
  initialPos,
  initialShipments,
  initialQcLots,
}: {
  initialProgramCards: ProgramCard[];
  initialPos: PurchaseOrder[];
  initialShipments: Shipment[];
  initialQcLots: string[];
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: cards = [], isFetching } = useQuery({
    queryKey: ["program_cards"],
    queryFn: fetchProgramCards,
    initialData: initialProgramCards,
  });
  const { data: pos = [] } = useQuery({
    queryKey: ["purchase_orders"],
    queryFn: fetchPurchaseOrders,
    initialData: initialPos,
  });
  const { data: shipments = [] } = useQuery({
    queryKey: ["shipments_all"],
    queryFn: fetchAllShipments,
    initialData: initialShipments,
  });
  const { data: qcLots = [] } = useQuery({
    queryKey: ["qc_lots"],
    queryFn: fetchQcCheckedLotNos,
    initialData: initialQcLots,
  });
  const { data: dyeingHouseNames = [] } = useQuery({ queryKey: ["masters-active", "dyeing_houses"], queryFn: () => fetchActiveMasterNames("dyeing_houses") });

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<ProgramCard | null>(null);
  // The detail modal owns its own Esc-to-close (see ProgramCardDetailModal).

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  usePagePrimaryAction("New program", useCallback(() => setFormOpen(true), []));

  const poByUid = useMemo(() => {
    const m: Record<string, PurchaseOrder> = {};
    for (const p of pos) m[p.unique_id] = p;
    return m;
  }, [pos]);

  const qcSet = useMemo(() => new Set(qcLots), [qcLots]);

  // Group program-card rows by Program ID + Lot No (one group = one card; program_uid
  // is unique so this is 1:1), THEN hide any whose lot has been QC'd — matching the app.
  const groups = useMemo(() => {
    const byKey = new Map<string, ProgramCard>();
    for (const c of cards) {
      const key = `${c.program_uid}__${c.lot_no ?? ""}`;
      if (!byKey.has(key)) byKey.set(key, c);
    }
    return [...byKey.values()].filter((c) => !(c.lot_no && qcSet.has(c.lot_no)));
  }, [cards, qcSet]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((c) => {
      const po = poByUid[c.po_unique_id];
      return [c.program_uid, c.lot_no, c.dying_house_name, po?.po_no, po?.vendor_name].some((f) =>
        (f ?? "").toLowerCase().includes(q),
      );
    });
  }, [groups, search, poByUid]);

  // Lots that have a shipment but no program card yet (dedup by lot_no).
  const availableLots = useMemo<AvailableLot[]>(() => {
    const used = new Set(cards.map((c) => c.lot_no).filter((x): x is string => !!x));
    const seen = new Set<string>();
    const out: AvailableLot[] = [];
    for (const s of shipments) {
      if (!s.lot_no || used.has(s.lot_no) || seen.has(s.lot_no)) continue;
      seen.add(s.lot_no);
      const po = poByUid[s.po_unique_id];
      out.push({ lot_no: s.lot_no, po_unique_id: s.po_unique_id, po_id: po?.id ?? null, po_no: po?.po_no ?? null, vendor: po?.vendor_name ?? null });
    }
    return out;
  }, [cards, shipments, poByUid]);

  const nextProgramId = useMemo(() => predictNextProgramId(cards), [cards]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: PC_KEY });
    qc.invalidateQueries({ queryKey: LOTS_KEY }); // keeps the Dyeing Queue in sync
  };

  const createM = useMutation({
    mutationFn: (v: ProgramCardFormValues) => createProgramCard(v),
    onMutate: async (v: ProgramCardFormValues) => {
      setFormOpen(false);
      await qc.cancelQueries({ queryKey: PC_KEY });
      const temp = optimisticCard(v, nextProgramId);
      return { rollback: optimisticList<ProgramCard>(qc, PC_KEY, (cur) => [temp, ...cur]) };
    },
    onError: (e: Error, _v, ctx) => {
      // roll back the temp row; then refetch — a failure can still mean the card committed
      // and only its cuttings failed, so the real card should surface (no duplicate on retry).
      ctx?.rollback();
      toast.error(e.message);
    },
    onSuccess: () => toast.success("Program card created"),
    onSettled: () => invalidate(),
  });

  const detailPo = detail ? poByUid[detail.po_unique_id] : undefined;
  const hasData = groups.length > 0;

  return (
    <>
      <div className="page-head row">
        <div>
          <h1>Program Cards</h1>
          <p>
            {groups.length} active program{groups.length === 1 ? "" : "s"} · QC&apos;d lots are hidden
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
          <Icon name="plus" />New program
        </button>
      </div>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            placeholder="Search program, lot, PO, vendor, dyeing house…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {isFetching && <span className="fetching">Updating…</span>}
      </div>

      <div className="table-wrap">
        {rows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>PO No</th>
                  <th>Vendor</th>
                  <th>Program ID</th>
                  <th>Lot No</th>
                  <th>Dyeing House</th>
                  <th className="num">Total Meters</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const po = poByUid[c.po_unique_id];
                  return (
                    <tr
                      key={c.id}
                      className="clickable"
                      onClick={() => setDetail(c)}
                    >
                      <td><span className="mono">{po?.po_no ?? "—"}</span></td>
                      <td>{po?.vendor_name ?? "—"}</td>
                      <td><span className="strong mono">{c.program_uid}</span></td>
                      <td><span className="mono">{c.lot_no ?? "—"}</span></td>
                      <td>{c.dying_house_name ?? "—"}</td>
                      <td className="num mono">{fmtNum(c.total_meters)}</td>
                      <td className="col-actions">
                        <button
                          className="act"
                          onClick={(e) => { e.stopPropagation(); setDetail(c); }}
                        >
                          <Icon name="info" size={15} />Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="ph-icon"><Icon name="card" size={26} /></div>
            <h3>{hasData ? "No matching programs" : "No program cards yet"}</h3>
            <p>
              {hasData
                ? "Try a different search."
                : cards.length
                  ? "Every program's lot has been quality-checked — they move on from here."
                  : "Create a program card to set the dyeing instructions for a lot."}
            </p>
            {!hasData && cards.length === 0 && (
              <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
                <Icon name="plus" />New program
              </button>
            )}
          </div>
        )}
      </div>

      <ProgramCardFormModal
        open={formOpen}
        availableLots={availableLots}
        nextProgramId={nextProgramId}
        saving={createM.isPending}
        dyeingHouseSuggestions={dyeingHouseNames}
        onClose={() => setFormOpen(false)}
        onSave={(v) => createM.mutate(v)}
      />

      {detail && (
        <ProgramCardDetailModal card={detail} po={detailPo} onClose={() => setDetail(null)} />
      )}
    </>
  );
}
