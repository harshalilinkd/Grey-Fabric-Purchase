-- =============================================================================
-- Grey FMS — Migration 025: the reissue cycle discriminator (Stages 6–9)
--
-- Run in the Supabase SQL Editor (after 024).
-- Depends on 011 (fabric_receipts), 002 (qc_checklist, warehouse_log, reissue_return),
-- 010/022 (dyeing_followups), 023/024 (the QC RPC).
--
-- Stages 7/8/9 are FIELD-IDENTICAL to 3/4/5 — receive, inspect, store — run again for
-- the rejected metres only. So they share the same tables with a `cycle` discriminator,
-- never duplicated tables.
--
-- ⚠️ `cycle` is a PARALLEL DIMENSION, not a phase. The reissue loop runs concurrently
-- with the original track ON THE SAME LOT: in production, a lot's entire reissue cycle
-- (6→9) completed in ten minutes while the original lot still had 750 m awaiting QC a
-- month later. Nothing may collapse a lot's state into one enum, and every lot-level
-- rollup (remainingForQC, received-to-date, warehouse status) must be computed PER
-- (lot, cycle) — not per lot.
--
-- Stage 8 can itself return RETURN & REISSUE, so the loop can run more than once. The
-- discriminator therefore records WHICH TRACK a row belongs to, not how many times round.
--
-- DEFAULTS: 'original' everywhere except dyeing_followups, which IS Stage 6 (the reissue
-- dispatch) — every row it holds today is a reissue dispatch, so it defaults to 'reissue'.
-- If Pipeline C's "Sent for Dyeing From LD Silk" is built later it lands in this same
-- table with cycle = 'original'.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, constraints dropped before re-adding.
-- =============================================================================

-- =========================================================================
-- 1. The discriminator on every shared table
-- =========================================================================
alter table public.fabric_receipts  add column if not exists cycle text not null default 'original';
alter table public.qc_checklist     add column if not exists cycle text not null default 'original';
alter table public.warehouse_log    add column if not exists cycle text not null default 'original';
alter table public.reissue_return   add column if not exists cycle text not null default 'original';
-- Stage 6 lives here; everything already in it is a reissue dispatch.
alter table public.dyeing_followups add column if not exists cycle text not null default 'reissue';

update public.dyeing_followups set cycle = 'reissue' where cycle is null or cycle = 'original';

alter table public.fabric_receipts  drop constraint if exists fabric_receipts_cycle_check;
alter table public.qc_checklist     drop constraint if exists qc_checklist_cycle_check;
alter table public.warehouse_log    drop constraint if exists warehouse_log_cycle_check;
alter table public.reissue_return   drop constraint if exists reissue_return_cycle_check;
alter table public.dyeing_followups drop constraint if exists dyeing_followups_cycle_check;

alter table public.fabric_receipts  add constraint fabric_receipts_cycle_check  check (cycle in ('original', 'reissue'));
alter table public.qc_checklist     add constraint qc_checklist_cycle_check     check (cycle in ('original', 'reissue'));
alter table public.warehouse_log    add constraint warehouse_log_cycle_check    check (cycle in ('original', 'reissue'));
alter table public.reissue_return   add constraint reissue_return_cycle_check   check (cycle in ('original', 'reissue'));
alter table public.dyeing_followups add constraint dyeing_followups_cycle_check check (cycle in ('original', 'reissue'));

-- every lot-level rollup is now per (lot, cycle)
create index if not exists idx_fabric_receipts_lot_cycle on public.fabric_receipts (lot_no, cycle);
create index if not exists idx_qc_checklist_lot_cycle    on public.qc_checklist (lot_no, cycle);
create index if not exists idx_warehouse_log_lot_cycle   on public.warehouse_log (lot_no, cycle);

-- =========================================================================
-- 2. Replace the QC submit RPC — cycle-aware (serves Stage 4 AND Stage 8)
--
--    Payload adds `cycle` ('original' | 'reissue'), defaulting to 'original'.
--    Everything it writes is stamped with that cycle, and the two lot-level rollups
--    are scoped to it:
--      · lot qty      — original: the program card's total metres
--                       reissue : the metres received back on the reissue leg (Stage 7)
--      · accounted    — Σ (good + reissue) for THIS lot AND THIS cycle
--    so closing the reissue loop never closes the original lot, or vice versa.
-- =========================================================================
create or replace function public.submit_qc_inspection(payload jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_okay     constant text := 'OKAY & WAITING FOR REMAINING QTY';
  v_reissue  constant text := 'RETURN & REISSUE';
  v_waiting  constant text := 'Waiting For More Qty';
  v_final    constant text := 'Final Qty Received';
  v_cycle    text    := coalesce(nullif(payload ->> 'cycle', ''), 'original');
  v_result   text    := payload ->> 'result';
  v_received numeric := coalesce((payload ->> 'received_qty')::numeric, 0);
  v_failed   numeric := case when v_result = v_reissue
                          then least(greatest(coalesce((payload ->> 'failed_qty')::numeric, 0), 0), v_received)
                          else 0 end;
  v_good     numeric := round(v_received - v_failed, 2);
  v_re_status text   := case when coalesce((payload ->> 'return_and_reissue')::boolean, false)
                          then 'Reissue Pending' else 'Returned' end;
  v_program  text    := payload ->> 'program_uid';
  v_lot      text    := payload ->> 'lot_no';
  v_po       text    := payload ->> 'po_unique_id';
  v_reason   text    := nullif(btrim(coalesce(payload ->> 'reason', '')), '');
  v_remark   text    := nullif(btrim(coalesce(payload ->> 'remark', '')), '');
  v_mq boolean := coalesce((payload ->> 'meter_qty_check')::boolean, false);
  v_co boolean := coalesce((payload ->> 'colour_check')::boolean, false);
  v_st boolean := coalesce((payload ->> 'strength_check')::boolean, false);
  v_fq boolean := coalesce((payload ->> 'fabric_quality_check')::boolean, false);
  v_d        jsonb;
  v_design   text;
  v_a_design text;
  v_a_color  text;
  v_a_qty    numeric;
  v_i   int := 0;
  v_qc  int := 0;
  v_wh  int := 0;
  v_re  int := 0;
  v_lot_qty   numeric := 0;
  v_accounted numeric := 0;
  v_closed    boolean := false;
  v_base text := (floor(extract(epoch from clock_timestamp()) * 1000))::bigint::text;
  v_sfx  text;
begin
  if v_result not in (v_okay, v_reissue) then
    raise exception 'Invalid QC status: %', v_result;
  end if;
  if v_cycle not in ('original', 'reissue') then
    raise exception 'Invalid cycle: %', v_cycle;
  end if;

  for v_d in select jsonb_array_elements(coalesce(payload -> 'designs', '[]'::jsonb))
  loop
    v_design   := v_d ->> 'design_no';
    v_a_design := nullif(btrim(coalesce(v_d ->> 'actual_design_no', '')), '');
    v_a_color  := nullif(btrim(coalesce(v_d ->> 'actual_color', '')), '');
    v_a_qty    := nullif(v_d ->> 'actual_qty', '')::numeric;

    -- 1) the GOOD metres — qc_checklist (OKAY …) + the warehouse row
    if v_good > 0 then
      v_sfx := v_base || v_i::text || (floor(random() * 1e6))::int::text;
      insert into public.qc_checklist (
        check_id, program_uid, lot_no, design_no, checked_date,
        meter_qty_check, colour_check, strength_check, fabric_quality_check,
        overall_status, passed_qty, failed_qty,
        actual_design_no, actual_color, actual_qty, remark, cycle
      ) values (
        'QC-' || v_sfx, v_program, v_lot, v_design, current_date,
        v_mq, v_co, v_st, v_fq,
        v_okay, v_good, 0,
        v_a_design, v_a_color, v_a_qty, v_remark, v_cycle
      );
      v_qc := v_qc + 1;

      insert into public.warehouse_log (
        store_id, po_unique_id, lot_no, design_no, color, passed_qty, stored_date, status, remark, cycle
      ) values (
        'STORE-' || v_sfx, v_po, v_lot, coalesce(v_a_design, v_design), v_a_color,
        v_good, current_date, v_waiting, v_remark, v_cycle
      );
      v_wh := v_wh + 1;
      v_i := v_i + 1;
    end if;

    -- 2) the REISSUED metres — qc_checklist (RETURN & REISSUE) + reissue_return.
    --    A Stage-8 rejection writes another reissue_return row, which is how the loop
    --    runs more than once.
    if v_failed > 0 then
      v_sfx := v_base || v_i::text || (floor(random() * 1e6))::int::text;
      insert into public.qc_checklist (
        check_id, program_uid, lot_no, design_no, checked_date,
        meter_qty_check, colour_check, strength_check, fabric_quality_check,
        overall_status, passed_qty, failed_qty,
        actual_design_no, actual_color, actual_qty, remark, cycle
      ) values (
        'QC-' || v_sfx, v_program, v_lot, v_design, current_date,
        v_mq, v_co, v_st, v_fq,
        v_reissue, 0, v_failed,
        v_a_design, v_a_color, v_a_qty, coalesce(v_remark, v_reason), v_cycle
      );
      v_qc := v_qc + 1;

      insert into public.reissue_return (
        reissue_id, original_po_unique_id, original_lot_no, original_design_no,
        reissue_date, reissue_qty, reason, status, cycle
      ) values (
        'RE-' || v_sfx, v_po, v_lot, v_design, current_date, v_failed, v_reason, v_re_status, v_cycle
      );
      v_re := v_re + 1;
      v_i := v_i + 1;
    end if;
  end loop;

  -- 3) Stage-5/9 status for this lot ON THIS CYCLE ONLY.
  if v_lot is not null then
    if v_cycle = 'reissue' then
      -- the reissue leg's own target: what came back at Stage 7
      select coalesce(sum(received_meters), 0) into v_lot_qty
        from public.fabric_receipts where lot_no = v_lot and cycle = 'reissue';
    else
      select coalesce(sum(total_meters), 0) into v_lot_qty
        from public.program_cards where lot_no = v_lot;
    end if;

    select coalesce(sum(coalesce(passed_qty, 0) + coalesce(failed_qty, 0)), 0) into v_accounted
      from public.qc_checklist where lot_no = v_lot and cycle = v_cycle;

    v_closed := case when v_lot_qty > 0 then v_accounted >= v_lot_qty else v_accounted > 0 end;

    update public.warehouse_log
      set status = case when v_closed then v_final else v_waiting end
      where lot_no = v_lot and cycle = v_cycle;
  end if;

  return jsonb_build_object(
    'qc', v_qc, 'warehouse', v_wh, 'reissue', v_re,
    'cycle', v_cycle, 'lot_closed', coalesce(v_closed, false)
  );
end;
$$;

grant execute on function public.submit_qc_inspection(jsonb) to authenticated;

-- =========================================================================
-- 3. Reload the PostgREST schema cache (REQUIRED — columns were added)
-- =========================================================================
notify pgrst, 'reload schema';

-- =========================================================================
-- Verification — the two tracks side by side for one lot
--   select cycle, overall_status, sum(passed_qty) good, sum(failed_qty) reissued
--   from public.qc_checklist where lot_no = 'AB01' group by cycle, overall_status;
-- =========================================================================
