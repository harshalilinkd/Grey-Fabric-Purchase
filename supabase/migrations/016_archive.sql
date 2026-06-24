-- 016_archive.sql
-- Reversible, super-admin-only ARCHIVE for a PO and everything linked to it.
--
-- Design: an `archived` flag on every screen-listed table, hidden at the RLS layer — so
-- archived rows simply stop being returned by EVERY existing query (no app code needs to
-- change). The flag is flipped across the whole PO graph by one atomic, super-admin-gated
-- function, and a restore flips it back. Service-role / SECURITY DEFINER paths bypass the
-- hide so the super admin can still see + restore archived data.
--
-- Linked-by-text tables (po_unique_id / lot_no): shipments, program_cards, qc_checklist,
-- warehouse_log, reissue_return, final_receipts, dyeing_followups, fabric_receipts.
-- (program_card_designs / po_color_variants are only reachable via their parent, so hiding
-- the parent hides them — they need no flag.)

-- 1) archived flag (NULLABLE-safe: NOT NULL DEFAULT false) -------------------------------
alter table public.purchase_orders   add column if not exists archived boolean not null default false;
alter table public.shipments         add column if not exists archived boolean not null default false;
alter table public.program_cards     add column if not exists archived boolean not null default false;
alter table public.qc_checklist      add column if not exists archived boolean not null default false;
alter table public.reissue_return    add column if not exists archived boolean not null default false;
alter table public.warehouse_log     add column if not exists archived boolean not null default false;
alter table public.final_receipts    add column if not exists archived boolean not null default false;
alter table public.dyeing_followups  add column if not exists archived boolean not null default false;
alter table public.fabric_receipts   add column if not exists archived boolean not null default false;

-- 2) hide archived rows from ALL normal (authenticated) reads --------------------------
--    Replaces the `using (true)` select policy with `using (archived = false)`.
do $$
declare t text;
begin
  foreach t in array array[
    'purchase_orders','shipments','program_cards','qc_checklist',
    'reissue_return','warehouse_log','final_receipts','dyeing_followups','fabric_receipts'
  ] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (archived = false)', t);
  end loop;
end $$;

-- 3) link counts for one PO (preview before archive / contents of an archived PO) -------
create or replace function public.po_link_counts(po_uid text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lots text[];
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can do this';
  end if;

  select coalesce(array_agg(lot_no), array[]::text[]) into lots
    from public.shipments where po_unique_id = po_uid and lot_no is not null;

  return jsonb_build_object(
    'shipments',        (select count(*) from public.shipments       where po_unique_id = po_uid),
    'programs',         (select count(*) from public.program_cards   where po_unique_id = po_uid),
    'qc',               (select count(*) from public.qc_checklist    where lot_no = any(lots)),
    'warehouse',        (select count(*) from public.warehouse_log   where po_unique_id = po_uid or lot_no = any(lots)),
    'reissue',          (select count(*) from public.reissue_return  where original_po_unique_id = po_uid or original_lot_no = any(lots)),
    'final_receipts',   (select count(*) from public.final_receipts  where po_unique_id = po_uid or lot_no = any(lots)),
    'dyeing_followups', (select count(*) from public.dyeing_followups where po_unique_id = po_uid or lot_no = any(lots)),
    'fabric_receipts',  (select count(*) from public.fabric_receipts where po_unique_id = po_uid or lot_no = any(lots))
  );
end $$;

-- 4) archive / restore a PO's whole graph, atomically -----------------------------------
create or replace function public.set_po_archived(po_uid text, want_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lots text[];
  n_ship int; n_prog int; n_qc int; n_wh int; n_re int; n_fr int; n_df int; n_fab int; n_po int;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can archive or restore purchase orders';
  end if;

  select coalesce(array_agg(lot_no), array[]::text[]) into lots
    from public.shipments where po_unique_id = po_uid and lot_no is not null;

  update public.shipments       set archived = want_archived where po_unique_id = po_uid;
  get diagnostics n_ship = row_count;
  update public.program_cards    set archived = want_archived where po_unique_id = po_uid;
  get diagnostics n_prog = row_count;
  update public.qc_checklist     set archived = want_archived where lot_no = any(lots);
  get diagnostics n_qc = row_count;
  update public.warehouse_log    set archived = want_archived where po_unique_id = po_uid or lot_no = any(lots);
  get diagnostics n_wh = row_count;
  update public.reissue_return   set archived = want_archived where original_po_unique_id = po_uid or original_lot_no = any(lots);
  get diagnostics n_re = row_count;
  update public.final_receipts   set archived = want_archived where po_unique_id = po_uid or lot_no = any(lots);
  get diagnostics n_fr = row_count;
  update public.dyeing_followups set archived = want_archived where po_unique_id = po_uid or lot_no = any(lots);
  get diagnostics n_df = row_count;
  update public.fabric_receipts  set archived = want_archived where po_unique_id = po_uid or lot_no = any(lots);
  get diagnostics n_fab = row_count;
  update public.purchase_orders  set archived = want_archived where unique_id = po_uid;
  get diagnostics n_po = row_count;

  return jsonb_build_object(
    'po', n_po, 'shipments', n_ship, 'programs', n_prog, 'qc', n_qc,
    'warehouse', n_wh, 'reissue', n_re, 'final_receipts', n_fr,
    'dyeing_followups', n_df, 'fabric_receipts', n_fab
  );
end $$;

-- 5) list archived POs for the restore UI (super-admin sees the hidden rows) -------------
create or replace function public.list_archived_pos()
returns setof public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can view archived purchase orders';
  end if;
  return query
    select * from public.purchase_orders where archived = true order by updated_at desc;
end $$;

-- lock down + grant execute to logged-in users (the functions self-check super admin)
revoke all on function public.po_link_counts(text)            from public, anon;
revoke all on function public.set_po_archived(text, boolean)  from public, anon;
revoke all on function public.list_archived_pos()             from public, anon;
grant execute on function public.po_link_counts(text)           to authenticated;
grant execute on function public.set_po_archived(text, boolean) to authenticated;
grant execute on function public.list_archived_pos()            to authenticated;

-- Reload the PostgREST schema cache so the new columns + functions are visible immediately.
notify pgrst, 'reload schema';
