-- =============================================================================
-- Grey FMS — Migration 020: grey-house instalments (Process Stage 2)
--
-- Run in the Supabase SQL Editor (after 019).
-- Depends on 001 (set_updated_at(), is_admin()) and 002 (shipments).
--
-- WHY: grey fabric arrives from the vendor in INSTALMENTS, and one instalment can be
-- split into SEVERAL physical lots. Until now the app modelled an instalment and a lot
-- as the same thing (one `shipments` row = one lot = one delivery), so a 3-lot delivery
-- could not be recorded as one event, and the follow-up fields had nowhere to live.
--
-- SHAPE (mirrors the spec exactly):
--   grey_instalments  — one row per instalment: sent qty, next follow-up date, remark,
--                       and the remaining-qty SNAPSHOT.
--   shipments         — unchanged: still one row per LOT ("lots are born here"), now
--                       optionally pointing at the instalment that produced it.
-- Keeping lots in `shipments` means every downstream screen (dyeing queue, program
-- cards, QC, warehouse) keeps working on lots exactly as before — nothing downstream
-- has to assume a 1:1 instalment↔lot relationship, because it never sees instalments.
--
-- ⚠️ remaining_qty is a SNAPSHOT of what was outstanding immediately BEFORE the entry.
-- It is written once and never recomputed — the app must not derive it on read.
--
-- FK `on delete set null` (not cascade): deleting an instalment must NOT destroy lots
-- that program cards / QC / warehouse rows already reference — same principle as the
-- deliberately FK-less po_unique_id links in 002.
--
-- Safe to re-run: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- DROP ... IF EXISTS before each trigger/policy.
--
-- NOTE: the name `grey_instalments` is deliberate — migration 002 section 0 drops a
-- table called `grey_receipts`, so re-running 002 would silently delete this one.
-- =============================================================================

-- =========================================================================
-- 1. grey_instalments — one row per delivery instalment against a PO
-- =========================================================================
create table if not exists public.grey_instalments (
  id                 uuid primary key default gen_random_uuid(),
  instalment_id      text not null unique,     -- app-generated "GRI-{timestamp}"
  po_unique_id       text not null,            -- text link to purchase_orders.unique_id
                                               -- (no FK: deleting a PO must NOT remove its history)
  received_date      date,
  sent_quantity      numeric,                  -- the instalment total (= sum of its lots)
  remaining_qty      numeric,                  -- SNAPSHOT: outstanding immediately before this entry
  next_followup_date date,
  remark             text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_grey_instalments_po on public.grey_instalments (po_unique_id);

-- =========================================================================
-- 2. shipments (the LOT record) → the instalment that produced it
--    Nullable: every pre-existing lot predates instalments and stays valid.
-- =========================================================================
alter table public.shipments
  add column if not exists grey_instalment uuid references public.grey_instalments (id) on delete set null;

create index if not exists idx_shipments_grey_instalment on public.shipments (grey_instalment);

-- =========================================================================
-- 3. updated_at trigger (set_updated_at() from migration 001)
-- =========================================================================
drop trigger if exists grey_instalments_set_updated_at on public.grey_instalments;
create trigger grey_instalments_set_updated_at
  before update on public.grey_instalments
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 4. ROW LEVEL SECURITY (read/insert/update = any authenticated; delete = admin)
--    Matches 002 / 007.
-- =========================================================================
alter table public.grey_instalments enable row level security;

grant select, insert, update, delete on public.grey_instalments to authenticated;

drop policy if exists grey_instalments_select       on public.grey_instalments;
drop policy if exists grey_instalments_insert       on public.grey_instalments;
drop policy if exists grey_instalments_update       on public.grey_instalments;
drop policy if exists grey_instalments_delete_admin on public.grey_instalments;

create policy grey_instalments_select on public.grey_instalments
  for select to authenticated using (true);
create policy grey_instalments_insert on public.grey_instalments
  for insert to authenticated with check (true);
create policy grey_instalments_update on public.grey_instalments
  for update to authenticated using (true) with check (true);
create policy grey_instalments_delete_admin on public.grey_instalments
  for delete to authenticated using ((select public.is_admin()));

-- =========================================================================
-- 5. Reload the PostgREST schema cache (REQUIRED — a column was added)
-- =========================================================================
notify pgrst, 'reload schema';

-- =========================================================================
-- Verification
--   select i.instalment_id, i.po_unique_id, i.sent_quantity, i.remaining_qty,
--          i.next_followup_date, count(s.id) as lots
--   from public.grey_instalments i
--   left join public.shipments s on s.grey_instalment = i.id
--   group by i.id order by i.created_at desc limit 20;
-- =========================================================================
