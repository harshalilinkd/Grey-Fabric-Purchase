-- =============================================================================
-- Grey FMS — Migration 019: the dyeing house belongs to the PO (Process Stage 1)
--
-- Run in the Supabase SQL Editor (after 018).
-- Depends on 002 (purchase_orders, program_cards).
--
-- WHY: Stage 1 of the process spec defines a PO as "a quantity of metres at a rate,
-- from ONE vendor, for ONE dyeing house". Until now the dyeing house was first
-- captured a stage later, on the program card (program_cards.dying_house_name), so
-- a PO carried no dyeing house at all. This adds it at its real point of capture.
--
-- SPELLING: `dying_house_name` (not "dyeing") — deliberately matching the existing
-- program_cards.dying_house_name column so both ends of the pipeline agree. The UI
-- label stays "Dyeing house", which is what staff read.
--
-- NULLABLE on purpose: purchase_orders already has rows, and finished-goods POs
-- (direct purchase / imported) never go to a dyeing house, so they keep it NULL.
-- "Required" is enforced by the form, on the dyeing paths only (grey / client
-- fabric / checks & weaves) — same convention as the 007 metadata columns.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS; the backfill only touches NULL rows.
-- =============================================================================

-- =========================================================================
-- 1. purchase_orders — the dyeing house this order is destined for
-- =========================================================================
alter table public.purchase_orders
  add column if not exists dying_house_name text;

-- =========================================================================
-- 2. Backfill legacy POs from their earliest program card
--    Existing POs predate this column but their lots already went somewhere;
--    the first program card for the PO is the authoritative answer. Only fills
--    NULLs, so re-running never overwrites a value entered in the app.
-- =========================================================================
update public.purchase_orders po
set dying_house_name = pc.dying_house_name
from (
  select distinct on (po_unique_id) po_unique_id, dying_house_name
  from public.program_cards
  where dying_house_name is not null
    and po_unique_id is not null
  order by po_unique_id, program_date asc nulls last, created_at asc
) pc
where pc.po_unique_id = po.unique_id
  and po.dying_house_name is null;

-- =========================================================================
-- 3. Reload the PostgREST schema cache (REQUIRED after adding a column —
--    otherwise PO inserts fail with "Could not find the '<col>' column …")
-- =========================================================================
notify pgrst, 'reload schema';

-- =========================================================================
-- Verification
--   select unique_id, po_no, vendor_name, dying_house_name, sourcing_path
--   from public.purchase_orders order by created_at desc limit 20;
-- =========================================================================
