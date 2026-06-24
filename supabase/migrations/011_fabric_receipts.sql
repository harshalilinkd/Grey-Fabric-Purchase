-- =============================================================================
-- Grey FMS — Migration 011: fabric_receipts (dyed fabric received back per design)
--
-- Run in the Supabase SQL Editor for project cmlsxzveqencatospykg (after 010).
--
-- One row per design received back from the dyeing house. `programmed_meters` is a
-- snapshot of the program_card_designs metre (so the received-vs-programmed history is
-- self-contained even if the program card later changes). One submit inserts many rows
-- (one per design), so `receipt_id` carries a per-row suffix ("FAB-{ts}{i}{rand}"), like
-- the QC / warehouse / reissue ids. `lot_no` + `po_unique_id` are TEXT references.
--
-- ⚠️ 002 section 0 does NOT drop this table (new name), so a 002 re-run leaves it.
-- Idempotent: IF NOT EXISTS + DROP ... IF EXISTS before each trigger/policy.
-- =============================================================================

create table if not exists public.fabric_receipts (
  id                uuid primary key default gen_random_uuid(),
  receipt_id        text not null unique,            -- app-generated "FAB-{ts}{i}{rand}"
  lot_no            text,
  po_unique_id      text,
  design_no         text,
  programmed_meters numeric,                          -- snapshot of the programmed metre
  received_meters   numeric,
  received_date     date,
  remark            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_fabric_receipts_lot on public.fabric_receipts (lot_no);
create index if not exists idx_fabric_receipts_po  on public.fabric_receipts (po_unique_id);

drop trigger if exists fabric_receipts_set_updated_at on public.fabric_receipts;
create trigger fabric_receipts_set_updated_at
  before update on public.fabric_receipts
  for each row execute function public.set_updated_at();

alter table public.fabric_receipts enable row level security;

grant select, insert, update, delete on public.fabric_receipts to authenticated;

drop policy if exists fabric_receipts_select       on public.fabric_receipts;
drop policy if exists fabric_receipts_insert       on public.fabric_receipts;
drop policy if exists fabric_receipts_update       on public.fabric_receipts;
drop policy if exists fabric_receipts_delete_admin on public.fabric_receipts;

create policy fabric_receipts_select on public.fabric_receipts
  for select to authenticated using (true);
create policy fabric_receipts_insert on public.fabric_receipts
  for insert to authenticated with check (true);
create policy fabric_receipts_update on public.fabric_receipts
  for update to authenticated using (true) with check (true);
create policy fabric_receipts_delete_admin on public.fabric_receipts
  for delete to authenticated using ((select public.is_admin()));

-- After running: NOTIFY pgrst, 'reload schema';
