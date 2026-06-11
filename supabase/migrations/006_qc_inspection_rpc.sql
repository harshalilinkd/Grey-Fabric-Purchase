-- =============================================================================
-- Grey FMS — Migration 006: atomic QC-inspection submit (RPC)
--
-- Run in the Supabase SQL Editor for project cmlsxzveqencatospykg (after 005).
--
-- The QC wizard writes up to three tables per design (qc_checklist, and
-- conditionally warehouse_log + reissue_return). supabase-js has no client-side
-- transaction, so doing this as separate inserts can leave a partial state if one
-- fails mid-way (the lot gets hidden by its qc_checklist row, but the passed
-- fabric / reissue never gets recorded). This function performs ALL the writes in
-- ONE transaction so they commit or roll back together.
--
-- The app calls this via supabase.rpc('submit_qc_inspection', { payload }) and
-- falls back to sequential inserts if this function isn't installed — so QC keeps
-- working before this migration is applied; applying it just makes submit atomic.
--
-- SECURITY INVOKER: runs as the calling user, so the existing RLS insert policies
-- (any authenticated user) still apply. Safe to re-run (create or replace).
-- =============================================================================

create or replace function public.submit_qc_inspection(payload jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_result   text    := payload ->> 'result';
  v_received numeric := coalesce((payload ->> 'received_qty')::numeric, 0);
  -- clamp failed into [0, received] so passed_qty can never go negative
  v_failed   numeric := case when v_result = 'Failed'
                          then least(greatest(coalesce((payload ->> 'failed_qty')::numeric, 0), 0), v_received)
                          else 0 end;
  v_passed   numeric := round(v_received - v_failed, 2);
  v_status   text    := case when coalesce((payload ->> 'return_and_reissue')::boolean, false)
                          then 'Reissue Pending' else 'Returned' end;
  v_program  text    := payload ->> 'program_uid';
  v_lot      text    := payload ->> 'lot_no';
  v_po       text    := payload ->> 'po_unique_id';
  v_reason   text    := nullif(btrim(coalesce(payload ->> 'reason', '')), '');
  v_mq boolean := coalesce((payload ->> 'meter_qty_check')::boolean, false);
  v_co boolean := coalesce((payload ->> 'colour_check')::boolean, false);
  v_st boolean := coalesce((payload ->> 'strength_check')::boolean, false);
  v_fq boolean := coalesce((payload ->> 'fabric_quality_check')::boolean, false);
  v_design text;
  v_i   int := 0;
  v_qc  int := 0;
  v_wh  int := 0;
  v_re  int := 0;
  -- shared submit timestamp; a per-row index + random keeps the unique IDs distinct
  v_base text := (floor(extract(epoch from clock_timestamp()) * 1000))::bigint::text;
begin
  if v_result not in ('Passed', 'Failed') then
    raise exception 'Invalid QC result: %', v_result;
  end if;

  for v_design in
    select jsonb_array_elements_text(coalesce(payload -> 'design_nos', '[]'::jsonb))
  loop
    -- 1) qc_checklist — always
    insert into public.qc_checklist (
      check_id, program_uid, lot_no, design_no, checked_date,
      meter_qty_check, colour_check, strength_check, fabric_quality_check,
      overall_status, passed_qty, failed_qty
    ) values (
      'QC-' || v_base || v_i::text || (floor(random() * 1e6))::int::text,
      v_program, v_lot, v_design, current_date,
      v_mq, v_co, v_st, v_fq,
      v_result, v_passed, v_failed
    );
    v_qc := v_qc + 1;

    -- 2) warehouse_log — only when something passed
    if v_passed > 0 then
      insert into public.warehouse_log (
        store_id, po_unique_id, lot_no, design_no, passed_qty, stored_date, status
      ) values (
        'STORE-' || v_base || v_i::text || (floor(random() * 1e6))::int::text,
        v_po, v_lot, v_design, v_passed, current_date, 'Stored'
      );
      v_wh := v_wh + 1;
    end if;

    -- 3) reissue_return — only on a Fail with a failed quantity
    if v_result = 'Failed' and v_failed > 0 then
      insert into public.reissue_return (
        reissue_id, original_po_unique_id, original_lot_no, original_design_no,
        reissue_date, reissue_qty, reason, status
      ) values (
        'RE-' || v_base || v_i::text || (floor(random() * 1e6))::int::text,
        v_po, v_lot, v_design, current_date, v_failed, v_reason, v_status
      );
      v_re := v_re + 1;
    end if;

    v_i := v_i + 1;
  end loop;

  return jsonb_build_object('qc', v_qc, 'warehouse', v_wh, 'reissue', v_re);
end;
$$;

grant execute on function public.submit_qc_inspection(jsonb) to authenticated;
