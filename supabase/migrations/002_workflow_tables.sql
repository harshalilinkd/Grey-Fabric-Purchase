-- =============================================================================
-- Grey FMS — Migration 002: workflow tables (matches the real app)
--
-- Run in the Supabase SQL Editor for project cmlsxzveqencatospykg (after 001).
-- Depends on migration 001 for: public.is_admin(), public.set_updated_at().
--
-- RLS on every table: any logged-in user can READ / INSERT / UPDATE;
-- only admins can DELETE.  created_at/updated_at on each (self-maintaining).
--
-- NOTE: This replaces two earlier *discarded* workflow drafts. Section 0 drops
--   any tables those drafts may have created so the schema matches the app
--   exactly. Migration 001 (profiles + master lists: vendors/dyeing_houses/
--   qualities/holidays) is NOT touched. If you never ran those drafts, the
--   DROPs are harmless no-ops. Safe to re-run.
-- =============================================================================

-- ---------- 0. Clean up tables from the earlier discarded drafts ----------
drop table if exists public.program_card_designs cascade;
drop table if exists public.program_cards        cascade;
drop table if exists public.purchase_orders       cascade;
-- also drop the current workflow tables so re-running rebuilds them to the
-- EXACT schema (the live DB had divergent/partial versions). All empty in setup.
drop table if exists public.shipments             cascade;
drop table if exists public.qc_checklist          cascade;
drop table if exists public.reissue_return        cascade;
drop table if exists public.warehouse_log         cascade;
drop table if exists public.dyeing_receipts       cascade;
drop table if exists public.dyeing_followups      cascade;
drop table if exists public.qc_inspections        cascade;
drop table if exists public.reissue_returns       cascade;  -- note: plural (002/003)
drop table if exists public.final_receipts        cascade;
drop table if exists public.warehouse_entries     cascade;
drop table if exists public.dyeing_dispatches     cascade;
drop table if exists public.grey_receipts         cascade;
drop table if exists public.lots                  cascade;
drop sequence if exists public.program_card_uid_seq;

-- =========================================================================
-- 1. TABLES
-- =========================================================================

-- purchase_orders -----------------------------------------------------------
create table if not exists public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  unique_id     text not null unique,            -- app-generated "UID-{timestamp}"
  vendor_name   text,                            -- text for now (master list later)
  process       text,
  quality       text,                            -- text for now
  order_date    date,
  order_no      text,
  po_no         text,
  delivery_days integer,
  quantity      numeric,                         -- meters
  rate          numeric,
  amount        numeric generated always as (quantity * rate) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- shipments (the lot number is created HERE) --------------------------------
create table if not exists public.shipments (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   text not null unique,            -- "SHID-{timestamp}"
  po_unique_id  text not null,                   -- text link to purchase_orders.unique_id
                                                 -- (no FK: deleting a PO must NOT remove its shipments)
  shipment_date date,
  sent_quantity numeric,
  lot_no        text,                            -- lots are born here
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- program_cards -------------------------------------------------------------
create table if not exists public.program_cards (
  id                     uuid primary key default gen_random_uuid(),
  program_uid            text not null unique,    -- "PG-{n}"
  lot_no                 text,
  po_unique_id           text not null,           -- text link to purchase_orders.unique_id
                                                  -- (no FK: deleting a PO must NOT remove its programs)
  program_date           date,
  dying_house_name       text,                    -- spelling kept to match the app
  total_meters           numeric,
  color_cutting_attached boolean not null default false,  -- yes/no
  total_color_cutting    integer,
  delivery_days          integer,
  pdf_url                text,                    -- Supabase Storage path/URL
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- program_card_designs (many per program_card) -----------------------------
create table if not exists public.program_card_designs (
  id           uuid primary key default gen_random_uuid(),
  program_card uuid not null references public.program_cards (id) on delete cascade,
  design_no    text,
  color        text,
  meter        numeric,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- qc_checklist (text references — snapshots, not FKs) -----------------------
create table if not exists public.qc_checklist (
  id                   uuid primary key default gen_random_uuid(),
  check_id             text not null unique,      -- "QC-{timestamp}{random}"
  program_uid          text,
  lot_no               text,
  design_no            text,
  checked_date         date,
  meter_qty_check      boolean not null default false,  -- yes/no
  colour_check         boolean not null default false,
  strength_check       boolean not null default false,
  fabric_quality_check boolean not null default false,
  overall_status       text check (overall_status in ('Passed', 'Failed')),
  passed_qty           numeric,
  failed_qty           numeric,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- reissue_return (text references) ------------------------------------------
create table if not exists public.reissue_return (
  id                   uuid primary key default gen_random_uuid(),
  reissue_id           text not null unique,      -- "RE-{timestamp}{random}"
  original_po_unique_id text,
  original_lot_no      text,
  original_design_no   text,
  reissue_date         date,
  reissue_qty          numeric,
  reason               text,
  new_lot_no           text,                      -- blank until assigned
  status               text not null default 'Pending Assignment'
                         check (status in ('Reissue Pending', 'Returned', 'Pending Assignment')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- warehouse_log (text references) -------------------------------------------
create table if not exists public.warehouse_log (
  id            uuid primary key default gen_random_uuid(),
  store_id      text not null unique,             -- "STORE-{timestamp}"
  po_unique_id  text,
  lot_no        text,
  design_no     text,
  passed_qty    numeric,
  stored_date   date,
  status        text not null default 'Stored',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- =========================================================================
-- 2. INDEXES on link / reference columns
-- =========================================================================
create index if not exists idx_po_po_no                  on public.purchase_orders (po_no);
create index if not exists idx_shipments_po              on public.shipments (po_unique_id);
create index if not exists idx_shipments_lot             on public.shipments (lot_no);
create index if not exists idx_program_cards_po          on public.program_cards (po_unique_id);
create index if not exists idx_program_cards_lot         on public.program_cards (lot_no);
create index if not exists idx_pcd_program_card          on public.program_card_designs (program_card);
create index if not exists idx_qc_program_uid            on public.qc_checklist (program_uid);
create index if not exists idx_qc_lot                    on public.qc_checklist (lot_no);
create index if not exists idx_qc_design                 on public.qc_checklist (design_no);
create index if not exists idx_reissue_po                on public.reissue_return (original_po_unique_id);
create index if not exists idx_reissue_lot               on public.reissue_return (original_lot_no);
create index if not exists idx_warehouse_po              on public.warehouse_log (po_unique_id);
create index if not exists idx_warehouse_lot             on public.warehouse_log (lot_no);

-- =========================================================================
-- 3. updated_at TRIGGERS (set_updated_at() from migration 001)
-- =========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'purchase_orders','shipments','program_cards','program_card_designs',
    'qc_checklist','reissue_return','warehouse_log'
  ] loop
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$s', t);
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- =========================================================================
-- 4. ROW LEVEL SECURITY
--    read / insert / update = any authenticated user; delete = admins only
-- =========================================================================
alter table public.purchase_orders      enable row level security;
alter table public.shipments            enable row level security;
alter table public.program_cards        enable row level security;
alter table public.program_card_designs enable row level security;
alter table public.qc_checklist         enable row level security;
alter table public.reissue_return       enable row level security;
alter table public.warehouse_log        enable row level security;

grant select, insert, update, delete on
  public.purchase_orders, public.shipments, public.program_cards,
  public.program_card_designs, public.qc_checklist, public.reissue_return,
  public.warehouse_log
to authenticated;

-- per table: select/insert/update = true; delete = is_admin()
do $$
declare t text;
begin
  foreach t in array array[
    'purchase_orders','shipments','program_cards','program_card_designs',
    'qc_checklist','reissue_return','warehouse_log'
  ] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete_admin on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (true)', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (true)', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (true) with check (true)', t);
    execute format('create policy %1$s_delete_admin on public.%1$s for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;
