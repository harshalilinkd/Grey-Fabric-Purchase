-- =============================================================================
-- Grey FMS — Migration 023: incremental QC (Stage 4)
--
-- Run in the Supabase SQL Editor (after 022).
-- Depends on 002 (qc_checklist) and 006 (submit_qc_inspection).
--
-- THREE CHANGES, all from Stage 4's shape:
--
-- 1. STATUS VOCABULARY. `overall_status` was Passed/Failed. The business statuses are
--    'OKAY & WAITING FOR REMAINING QTY' and 'RETURN & REISSUE'. The first name is load-
--    bearing: it says the metres are good AND that the lot is still open, which is the
--    whole point — QC is incremental, one lot has several rows over weeks, and the lot
--    closes only when nothing remains for QC.
--
-- 2. THE "ACTUAL" FIELDS. Each inspection row records what was actually FOUND —
--    `actual_design_no`, `actual_color`, `actual_qty` — which can differ from what the
--    program card said should be there. Plus `remark` (previously the operator's note
--    only survived on the reissue row, so a note on good metres was lost).
--
-- 3. ONE ROW = ONE DISPOSITION. The old RPC wrote a single row per design carrying BOTH
--    passed_qty and failed_qty. Stage 4 says each row carries a good qty OR a reissue
--    qty and branches one way, so the replacement below writes up to two rows per design
--    — one per disposition. This is what makes the status-filtered sums well-defined:
--       goodQty    = Σ passed_qty where status = 'OKAY & WAITING FOR REMAINING QTY'
--       reissueQty = Σ failed_qty where status = 'RETURN & REISSUE'
--
-- BACKFILL: existing rows map Passed → OKAY & WAITING FOR REMAINING QTY and
-- Failed → RETURN & REISSUE. That matches how they were written (the old writer set
-- 'Failed' whenever failed_qty > 0). Historic rows keep both quantity columns populated;
-- the sums above still read them correctly because each maps to one status.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, constraint dropped before re-adding,
-- backfill is idempotent (it only matches the old values), create or replace function.
-- =============================================================================

-- =========================================================================
-- 1. The "actual" observation + remark
-- =========================================================================
alter table public.qc_checklist add column if not exists actual_design_no text;
alter table public.qc_checklist add column if not exists actual_color     text;
alter table public.qc_checklist add column if not exists actual_qty       numeric;
alter table public.qc_checklist add column if not exists remark           text;

-- =========================================================================
-- 2. Status vocabulary — drop the old CHECK, migrate values, re-add
--    (order matters: the new values would violate the old constraint)
-- =========================================================================
alter table public.qc_checklist drop constraint if exists qc_checklist_overall_status_check;

update public.qc_checklist set overall_status = 'OKAY & WAITING FOR REMAINING QTY'
  where overall_status = 'Passed';
update public.qc_checklist set overall_status = 'RETURN & REISSUE'
  where overall_status = 'Failed';

alter table public.qc_checklist
  add constraint qc_checklist_overall_status_check
  check (overall_status in ('OKAY & WAITING FOR REMAINING QTY', 'RETURN & REISSUE'));

-- lot-level rollups (remainingForQC) read these together
create index if not exists idx_qc_checklist_lot_status on public.qc_checklist (lot_no, overall_status);

-- =========================================================================
-- 3. Replace the atomic submit RPC
--
--    Payload (changed): `designs` is now an array of objects so each row can carry the
--    actual design/colour/qty found:
--      { program_uid, lot_no, po_unique_id, received_qty, result, failed_qty, reason,
--        remark, return_and_reissue, meter_qty_check, colour_check, strength_check,
--        fabric_quality_check,
--        designs: [{ design_no, actual_design_no, actual_color, actual_qty }] }
--
--    Still SECURITY INVOKER — RLS applies as before.
-- =========================================================================
create or replace function public.submit_qc_inspection(payload jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_okay     constant text := 'OKAY & WAITING FOR REMAINING QTY';
  v_reissue  constant text := 'RETURN & REISSUE';
  v_result   text    := payload ->> 'result';
  v_received numeric := coalesce((payload ->> 'received_qty')::numeric, 0);
  -- clamp failed into [0, received] so the good qty can never go negative
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

    -- 1) the GOOD metres — one row, status OKAY & WAITING FOR REMAINING QTY
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

      insert into public.warehouse_log (
        store_id, po_unique_id, lot_no, design_no, color, passed_qty, stored_date, status
      ) values (
        'STORE-' || v_sfx, v_po, v_lot, v_design, v_a_color, v_good, current_date, 'Stored'
      );
      v_wh := v_wh + 1;
      v_i := v_i + 1;
    end if;

    -- 2) the REISSUED metres — one row, status RETURN & REISSUE
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

  return jsonb_build_object('qc', v_qc, 'warehouse', v_wh, 'reissue', v_re);
end;
$$;

grant execute on function public.submit_qc_inspection(jsonb) to authenticated;

-- =========================================================================
-- 4. Reload the PostgREST schema cache (REQUIRED — columns were added)
-- =========================================================================
notify pgrst, 'reload schema';

-- =========================================================================
-- Verification — remaining for QC per lot (should hit 0 when a lot is closed)
--   select p.lot_no, p.total_meters,
--          coalesce(sum(q.passed_qty), 0) as good,
--          coalesce(sum(q.failed_qty), 0) as reissued,
--          p.total_meters - coalesce(sum(q.passed_qty + q.failed_qty), 0) as remaining_for_qc
--   from public.program_cards p
--   left join public.qc_checklist q on q.lot_no = p.lot_no
--   group by p.lot_no, p.total_meters order by remaining_for_qc desc;
-- =========================================================================
