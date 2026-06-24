-- =============================================================================
-- Grey FMS — Migration 010: dyeing_followups (track lots at the dyeing house)
--
-- Run in the Supabase SQL Editor for project cmlsxzveqencatospykg (after 009).
--
-- A log of follow-ups for lots currently at the dyeing house: remaining metres still
-- to come back, the next follow-up date (used to flag OVERDUE entries client-side), a
-- remark, and the dyeing house. `lot_no` + `po_unique_id` are TEXT references (matching
-- the other workflow tables). Note the column spelling `dying_house_name` ("dying", not
-- "dyeing") — intentional, to match program_cards. Same RLS as the other tables.
--
-- ⚠️ 002 section 0 does NOT drop this table (it's a new name), so a 002 re-run leaves it.
-- Idempotent: IF NOT EXISTS + DROP ... IF EXISTS before each trigger/policy.
-- =============================================================================

create table if not exists public.dyeing_followups (
  id                 uuid primary key default gen_random_uuid(),
  followup_id        text not null unique,           -- app-generated "DF-{timestamp}"
  lot_no             text,
  po_unique_id       text,
  dying_house_name   text,                            -- "dying" spelling, matches program_cards
  remaining_meters   numeric,
  next_followup_date date,
  remark             text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_dyeing_followups_lot on public.dyeing_followups (lot_no);
create index if not exists idx_dyeing_followups_po  on public.dyeing_followups (po_unique_id);

drop trigger if exists dyeing_followups_set_updated_at on public.dyeing_followups;
create trigger dyeing_followups_set_updated_at
  before update on public.dyeing_followups
  for each row execute function public.set_updated_at();

alter table public.dyeing_followups enable row level security;

grant select, insert, update, delete on public.dyeing_followups to authenticated;

drop policy if exists dyeing_followups_select       on public.dyeing_followups;
drop policy if exists dyeing_followups_insert       on public.dyeing_followups;
drop policy if exists dyeing_followups_update       on public.dyeing_followups;
drop policy if exists dyeing_followups_delete_admin on public.dyeing_followups;

create policy dyeing_followups_select on public.dyeing_followups
  for select to authenticated using (true);
create policy dyeing_followups_insert on public.dyeing_followups
  for insert to authenticated with check (true);
create policy dyeing_followups_update on public.dyeing_followups
  for update to authenticated using (true) with check (true);
create policy dyeing_followups_delete_admin on public.dyeing_followups
  for delete to authenticated using ((select public.is_admin()));

-- After running: NOTIFY pgrst, 'reload schema';
