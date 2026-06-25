"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type LiveStatus = "connecting" | "live" | "offline";

const LiveContext = createContext<LiveStatus>("connecting");

/**
 * Map each core table to the query keys that depend on it. A Realtime change on a
 * table invalidates those keys (prefix match), so lists/counts/dashboard update live
 * across users. NOTE: Realtime must be enabled per-table in the Supabase dashboard
 * (Database → Replication / `supabase_realtime` publication) for events to flow; the
 * socket connects regardless and the indicator reflects that.
 */
const TABLE_KEYS: Record<string, readonly unknown[][]> = {
  purchase_orders: [["purchase_orders"]],
  shipments: [["shipments_all"], ["po-shipments"]],
  program_cards: [["program_cards"], ["program_card_lots"], ["po-programs"]],
  program_card_designs: [["program-card-designs"]],
  qc_checklist: [["qc_inspections"], ["qc_lots"]],
  reissue_return: [["reissue_return"]],
  warehouse_log: [["warehouse_all"]],
  final_receipts: [["final_receipts"]],
  dyeing_followups: [["dyeing_followups"]],
  fabric_receipts: [["fabric_receipts"]],
  profiles: [["team"]],
};

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => {
    // Postgres emits one event per row; a bulk write (e.g. a multi-design QC submit) fans out
    // many events. Coalesce them: collect changed tables and flush a single dedup'd round of
    // invalidations on a short debounce, so one user action = one refetch per affected key.
    const pending = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      flushTimer = undefined;
      const tables = Array.from(pending);
      pending.clear();
      const done = new Set<string>();
      for (const table of tables) {
        for (const key of TABLE_KEYS[table] ?? []) {
          const id = JSON.stringify(key);
          if (done.has(id)) continue;
          done.add(id);
          queryClient.invalidateQueries({ queryKey: key });
        }
      }
    };

    const channel = supabase
      .channel("grey-fms-db")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
        if (!TABLE_KEYS[payload.table]) return;
        pending.add(payload.table);
        if (flushTimer === undefined) flushTimer = setTimeout(flush, 200);
      })
      .subscribe((s) => {
        setStatus(s === "SUBSCRIBED" ? "live" : s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED" ? "offline" : "connecting");
      });

    return () => {
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient]);

  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>;
}

export function useLiveStatus(): LiveStatus {
  return useContext(LiveContext);
}
