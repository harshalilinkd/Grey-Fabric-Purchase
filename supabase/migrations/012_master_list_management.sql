-- =============================================================================
-- Grey FMS — Migration 012: master-list management (active flag + processes)
--
-- Run in the Supabase SQL Editor for project cmlsxzveqencatospykg (after 011).
--
-- Settings now has a Master Lists tab to manage Vendors / Quality Names / Dyeing
-- Houses / Processes (add / edit / deactivate; admin-gated delete). This adds:
--   * an `active` flag to the existing masters (so a list entry can be retired
--     without deleting it — inactive entries drop out of the form dropdowns), and
--   * a new `processes` master (there wasn't one), mirroring the others.
-- RLS unchanged in spirit: any authenticated user READS; only admins write.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS / DROP ... IF EXISTS.
-- =============================================================================

alter table public.vendors       add column if not exists active boolean not null default true;
alter table public.dyeing_houses add column if not exists active boolean not null default true;
alter table public.qualities     add column if not exists active boolean not null default true;

-- processes master (new) — same shape + RLS as the other masters (migration 001)
create table if not exists public.processes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists processes_set_updated_at on public.processes;
create trigger processes_set_updated_at
  before update on public.processes
  for each row execute function public.set_updated_at();

alter table public.processes enable row level security;
grant select, insert, update, delete on public.processes to authenticated;

drop policy if exists processes_read on public.processes;
create policy processes_read on public.processes
  for select to authenticated using (true);
drop policy if exists processes_admin_write on public.processes;
create policy processes_admin_write on public.processes
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- After running: NOTIFY pgrst, 'reload schema';  (so the API sees active + processes)
