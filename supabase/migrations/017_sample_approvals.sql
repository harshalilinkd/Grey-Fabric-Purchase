-- =============================================================================
-- Grey FMS — Migration 017: sample_approvals (pre-PO sampling / approval step)
--
-- Run in the Supabase SQL Editor (after 016). I apply migrations manually by count.
--
-- A pre-PO sample/approval record. The sampling & approval workflow happens BEFORE
-- the PO is raised (confirmed against the authoritative purchase flow charts): a sample
-- is taken & approved, then a PO is generated from the approved sample. Applies only to
-- the sampled sources: grey, client_fabric, checks_weaves (CAD / Handloom route).
--
-- `approval_id` is app-generated ("SA-{ts}{rand}"). vendor_name / quality_name are TEXT
-- (the master-list names, like purchase_orders). `po_unique_id` links the PO raised from
-- an approved sample. (No `archived` column — samples are not part of the PO-archive graph.)
--
-- Idempotent: IF NOT EXISTS + DROP ... IF EXISTS before each trigger/policy.
-- set_updated_at() and is_admin() already exist (migration 001) — not redefined here.
-- =============================================================================

create table if not exists public.sample_approvals (
  id                  uuid primary key default gen_random_uuid(),
  approval_id         text not null unique,            -- "SA-{ts}{rand}"
  sourcing_path       text check (sourcing_path in ('grey','client_fabric','checks_weaves')),
  checks_method       text check (checks_method in ('cad','handloom')),
  vendor_name         text,
  quality_name        text,
  vendor_design_no    text,
  selling_merchant_no text,
  cad_ref             text,
  handloom_ref        text,
  sample_date         date,
  remark              text,
  status              text not null default 'Pending'
                      check (status in ('Pending','Approved','Rejected')),
  approved_date       date,
  po_unique_id        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_sample_approvals_status  on public.sample_approvals (status);
create index if not exists idx_sample_approvals_vendor  on public.sample_approvals (vendor_name);
create index if not exists idx_sample_approvals_po      on public.sample_approvals (po_unique_id);

drop trigger if exists sample_approvals_set_updated_at on public.sample_approvals;
create trigger sample_approvals_set_updated_at
  before update on public.sample_approvals
  for each row execute function public.set_updated_at();

alter table public.sample_approvals enable row level security;

grant select, insert, update, delete on public.sample_approvals to authenticated;

drop policy if exists sample_approvals_select       on public.sample_approvals;
drop policy if exists sample_approvals_insert       on public.sample_approvals;
drop policy if exists sample_approvals_update       on public.sample_approvals;
drop policy if exists sample_approvals_delete_admin on public.sample_approvals;

create policy sample_approvals_select on public.sample_approvals
  for select to authenticated using (true);
create policy sample_approvals_insert on public.sample_approvals
  for insert to authenticated with check (true);
create policy sample_approvals_update on public.sample_approvals
  for update to authenticated using (true) with check (true);
create policy sample_approvals_delete_admin on public.sample_approvals
  for delete to authenticated using ((select public.is_admin()));

-- Reload the PostgREST schema cache so inserts/updates don't fail on a stale cache.
notify pgrst, 'reload schema';
