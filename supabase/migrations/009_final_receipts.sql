-- =============================================================================
-- Grey FMS — Migration 009: final_receipts (close a lot with its final good qty)
--
-- Run in the Supabase SQL Editor for project cmlsxzveqencatospykg (after 007 + 008).
--
-- NOTE: Prompt 6 called this "008", but 008 is already the Program Cards `cutting_url`
-- migration — this is the next number in the sequence, 009.
--
-- Records the final confirmed good quantity per lot after all QC / reissue cycles,
-- closing the lot. `lot_no` + `po_unique_id` are TEXT references (matching warehouse_log /
-- reissue_return / program_cards — the prompt's "lot" / "purchase_order"). Same RLS as the
-- other workflow tables: authenticated read/insert/update, admin-only delete.
--
-- Idempotent: IF NOT EXISTS + DROP ... IF EXISTS before each trigger/policy.
--
-- ⚠️ WARNING: migration 002 section 0 includes `drop table if exists final_receipts
-- cascade` (a draft-era name) and never recreates it. If 002 is EVER re-run for drift
-- recovery AFTER this migration, final_receipts + all its data are dropped — re-apply
-- 009 afterward (and accept the data loss). Don't modify 002; just remember this.
-- =============================================================================

create table if not exists public.final_receipts (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    text not null unique,            -- app-generated "FR-{timestamp}"
  lot_no        text,
  po_unique_id  text,
  final_qty     numeric,                         -- final confirmed good metres
  status        text not null default 'Closed'
                  check (status in ('Closed', 'Partial', 'On Hold')),
  remark        text,
  received_date date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_final_receipts_lot on public.final_receipts (lot_no);
create index if not exists idx_final_receipts_po  on public.final_receipts (po_unique_id);

-- updated_at trigger (set_updated_at() from migration 001)
drop trigger if exists final_receipts_set_updated_at on public.final_receipts;
create trigger final_receipts_set_updated_at
  before update on public.final_receipts
  for each row execute function public.set_updated_at();

-- ROW LEVEL SECURITY (read/insert/update = any authenticated; delete = admin)
alter table public.final_receipts enable row level security;

grant select, insert, update, delete on public.final_receipts to authenticated;

drop policy if exists final_receipts_select       on public.final_receipts;
drop policy if exists final_receipts_insert       on public.final_receipts;
drop policy if exists final_receipts_update       on public.final_receipts;
drop policy if exists final_receipts_delete_admin on public.final_receipts;

create policy final_receipts_select on public.final_receipts
  for select to authenticated using (true);
create policy final_receipts_insert on public.final_receipts
  for insert to authenticated with check (true);
create policy final_receipts_update on public.final_receipts
  for update to authenticated using (true) with check (true);
create policy final_receipts_delete_admin on public.final_receipts
  for delete to authenticated using ((select public.is_admin()));

-- After running: NOTIFY pgrst, 'reload schema';  (so the API sees the new table)
