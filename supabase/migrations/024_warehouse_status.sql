-- =============================================================================
-- Grey FMS — Migration 024: warehouse status vocabulary + remark (Stage 5)
--
-- Run in the Supabase SQL Editor (after 023).
-- Depends on 002 (warehouse_log), 013 (warehouse_log.color), 023 (QC statuses).
--
-- Stage 5 stores the QC-passed metres and tracks the LOT's terminal state:
--   Waiting For More Qty  — the lot is still open (metres remain for QC)
--   Final Qty Received    — the lot is fully accounted for; terminal
--
-- `warehouse_log.status` shipped as a free-text column defaulting to 'Stored', which
-- says nothing about whether the lot is finished. Both statuses are LOT-level: every
-- warehouse row for a lot carries the same one, and they flip together the moment the
-- lot's last metres are accounted for.
--
-- That is why the RPC below re-stamps the WHOLE lot rather than only the rows it just
-- inserted: a row written three weeks ago must stop saying "Waiting For More Qty" when
-- today's inspection closes the lot. This is a STATE, not a snapshot — unlike
-- grey_instalments.remaining_qty / fabric_receipts.remaining_qty, which are written once
-- and never recomputed.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, constraint dropped before re-adding, the
-- backfill only matches the legacy value, create or replace function.
-- =============================================================================

-- =========================================================================
-- 1. remark (Stage 5 records one against the stored metres)
-- =========================================================================
alter table public.warehouse_log add column if not exists remark text;

-- =========================================================================
-- 2. Status vocabulary
--    Backfill in two passes: everything becomes "waiting", then any lot that is
--    already fully accounted for is promoted. A row whose lot has no program card
--    (finished goods, received + QC'd on arrival) has no lot qty to wait for.
-- =========================================================================
alter table public.warehouse_log drop constraint if exists warehouse_log_status_check;

update public.warehouse_log set status = 'Waiting For More Qty' where status = 'Stored';

update public.warehouse_log w
set status = 'Final Qty Received'
where w.status = 'Waiting For More Qty'
  and w.lot_no is not null
  and (
    select coalesce(sum(coalesce(q.passed_qty, 0) + coalesce(q.failed_qty, 0)), 0)
    from public.qc_checklist q where q.lot_no = w.lot_no
  ) >= coalesce(
    (select sum(p.total_meters) from public.program_cards p where p.lot_no = w.lot_no),
    0
  );

-- rows with no lot at all (legacy finished-goods receipts) are terminal on arrival
update public.warehouse_log set status = 'Final Qty Received'
where lot_no is null and status = 'Waiting For More Qty';

alter table public.warehouse_log alter column status set default 'Waiting For More Qty';

alter table public.warehouse_log
  add constraint warehouse_log_status_check
  check (status in ('Waiting For More Qty', 'Final Qty Received'));

create index if not exists idx_warehouse_log_lot_status on public.warehouse_log (lot_no, status);

-- =========================================================================
-- 3. Replace the QC submit RPC so it also maintains the Stage-5 status
--
--    Same payload as 023. Two additions:
--      · the good-metres warehouse row now carries the QC remark
--      · after the design loop, the lot's remaining-for-QC is recomputed and EVERY
--        warehouse row for that lot is stamped with the resulting status
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
        actual_design_no, actual_color, actual_qty, remark
      ) values (
        'QC-' || v_sfx, v_program, v_lot, v_design, current_date,
        v_mq, v_co, v_st, v_fq,
        v_okay, v_good, 0,
        v_a_design, v_a_color, v_a_qty, v_remark
      );
      v_qc := v_qc + 1;

      -- the stored design no. is what was actually found, falling back to the programmed one
      insert into public.warehouse_log (
        store_id, po_unique_id, lot_no, design_no, color, passed_qty, stored_date, status, remark
      ) values (
        'STORE-' || v_sfx, v_po, v_lot, coalesce(v_a_design, v_design), v_a_color,
        v_good, current_date, v_waiting, v_remark
      );
      v_wh := v_wh + 1;
      v_i := v_i + 1;
    end if;

    -- 2) the REISSUED metres — qc_checklist (RETURN & REISSUE) + reissue_return
    if v_failed > 0 then
      v_sfx := v_base || v_i::text || (floor(random() * 1e6))::int::text;
      insert into public.qc_checklist (
        check_id, program_uid, lot_no, design_no, checked_date,
        meter_qty_check, colour_check, strength_check, fabric_quality_check,
        overall_status, passed_qty, failed_qty,
        actual_design_no, actual_color, actual_qty, remark
      ) values (
        'QC-' || v_sfx, v_program, v_lot, v_design, current_date,
        v_mq, v_co, v_st, v_fq,
        v_reissue, 0, v_failed,
        v_a_design, v_a_color, v_a_qty, coalesce(v_remark, v_reason)
      );
      v_qc := v_qc + 1;

      insert into public.reissue_return (
        reissue_id, original_po_unique_id, original_lot_no, original_design_no,
        reissue_date, reissue_qty, reason, status
      ) values (
        'RE-' || v_sfx, v_po, v_lot, v_design, current_date, v_failed, v_reason, v_re_status
      );
      v_re := v_re + 1;
      v_i := v_i + 1;
    end if;
  end loop;

  -- 3) Stage-5 status for the WHOLE lot. Re-read inside the transaction so the rows just
  --    inserted are counted, then stamp every warehouse row for the lot — including ones
  --    written weeks ago, which must stop saying "Waiting For More Qty" once this closes it.
  if v_lot is not null then
    select coalesce(sum(total_meters), 0) into v_lot_qty
      from public.program_cards where lot_no = v_lot;
    select coalesce(sum(coalesce(passed_qty, 0) + coalesce(failed_qty, 0)), 0) into v_accounted
      from public.qc_checklist where lot_no = v_lot;

    v_closed := case when v_lot_qty > 0 then v_accounted >= v_lot_qty else v_accounted > 0 end;

    update public.warehouse_log
      set status = case when v_closed then v_final else v_waiting end
      where lot_no = v_lot;
  end if;

  return jsonb_build_object(
    'qc', v_qc, 'warehouse', v_wh, 'reissue', v_re,
    'lot_closed', coalesce(v_closed, false)
  );
end;
$$;

grant execute on function public.submit_qc_inspection(jsonb) to authenticated;

-- =========================================================================
-- 4. Reload the PostgREST schema cache (REQUIRED — a column was added)
-- =========================================================================
notify pgrst, 'reload schema';

-- =========================================================================
-- Verification
--   select lot_no, status, count(*), sum(passed_qty)
--   from public.warehouse_log group by lot_no, status order by lot_no;
-- =========================================================================
