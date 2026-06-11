-- =============================================================================
-- Grey FMS — Migration 007: purchase-order sourcing paths, quality metadata,
--                           and the colour-variant split (po_color_variants)
--
-- Run in the Supabase SQL Editor for project cmlsxzveqencatospykg (after 006).
-- Depends on 001 (public.set_updated_at(), public.is_admin()) and 002 (purchase_orders).
--
-- Adds the metadata an operator records at PO creation (before fabric arrives) and a
-- child table for splitting a vendor's bulk into colour variants (A/B/C/D + metres).
--
-- NULLABILITY: the new metadata columns are added NULLABLE on purpose —
--   (1) purchase_orders already has rows, so NOT NULL without a default would fail; and
--   (2) the current createPurchaseOrder() doesn't set them yet, so NOT NULL would break
--       inserts until the smart PO form (next prompt) populates them.
-- "Required" (quality_name / selling_merchant_no / vendor_design_no) is enforced by the
-- form. Once legacy POs are backfilled, a later migration can add NOT NULL.
--
-- RLS on the new child table: authenticated read/insert/update; admin-only delete
-- (matches 002). `amount` on purchase_orders stays a generated column — untouched.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS (inline CHECKs ride along, skipped on re-run),
-- CREATE TABLE/INDEX IF NOT EXISTS, DROP ... IF EXISTS before each trigger/policy.
-- =============================================================================

-- =========================================================================
-- 1. purchase_orders — new sourcing + quality columns
--    (nullable; CHECK passes on NULL so existing rows are unaffected)
-- =========================================================================

-- the 5 sourcing paths that converge on one PO
alter table public.purchase_orders
  add column if not exists sourcing_path text
  check (sourcing_path in ('grey', 'client_fabric', 'checks_weaves', 'direct_purchase', 'imported'));

-- internal quality name (Innova / London / Fiber / Urban Linen) — form-required
alter table public.purchase_orders add column if not exists quality_name        text;
-- selling merchant no — form-required
alter table public.purchase_orders add column if not exists selling_merchant_no text;
-- vendor design no (e.g. 3100) — form-required
alter table public.purchase_orders add column if not exists vendor_design_no    text;

-- sampling/sample-approval state (path-dependent in the form)
alter table public.purchase_orders
  add column if not exists sampling_status text
  check (sampling_status in ('approved', 'not_required', 'pending'));

-- checks/weaves path only
alter table public.purchase_orders add column if not exists cad_ref      text;
alter table public.purchase_orders add column if not exists handloom_ref text;

-- direct-purchase path only
alter table public.purchase_orders
  add column if not exists direct_subtype text
  check (direct_subtype in ('new_cloth', 'old_milano'));

-- =========================================================================
-- 2. po_color_variants — the colour split (many per PO)
--    FK ON DELETE CASCADE: variants are part of the PO and are born with it, so
--    they go when the PO goes (unlike shipments/programs, which outlive the PO).
-- =========================================================================
create table if not exists public.po_color_variants (
  id             uuid primary key default gen_random_uuid(),
  purchase_order uuid not null references public.purchase_orders (id) on delete cascade,
  code           text,        -- 'A' / 'B' / 'C' / 'D' …
  color_name     text,
  meters         numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_pcv_purchase_order on public.po_color_variants (purchase_order);

-- =========================================================================
-- 3. updated_at trigger (set_updated_at() from migration 001)
-- =========================================================================
drop trigger if exists po_color_variants_set_updated_at on public.po_color_variants;
create trigger po_color_variants_set_updated_at
  before update on public.po_color_variants
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 4. ROW LEVEL SECURITY (read/insert/update = any authenticated; delete = admin)
-- =========================================================================
alter table public.po_color_variants enable row level security;

grant select, insert, update, delete on public.po_color_variants to authenticated;

drop policy if exists po_color_variants_select       on public.po_color_variants;
drop policy if exists po_color_variants_insert       on public.po_color_variants;
drop policy if exists po_color_variants_update       on public.po_color_variants;
drop policy if exists po_color_variants_delete_admin on public.po_color_variants;

create policy po_color_variants_select on public.po_color_variants
  for select to authenticated using (true);
create policy po_color_variants_insert on public.po_color_variants
  for insert to authenticated with check (true);
create policy po_color_variants_update on public.po_color_variants
  for update to authenticated using (true) with check (true);
create policy po_color_variants_delete_admin on public.po_color_variants
  for delete to authenticated using ((select public.is_admin()));

-- =========================================================================
-- Done. See the verification queries provided with this migration.
-- =========================================================================
