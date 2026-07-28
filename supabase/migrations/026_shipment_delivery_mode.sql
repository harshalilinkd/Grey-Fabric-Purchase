-- =============================================================================
-- Grey FMS — Migration 026: how the grey physically reached the dyeing house
--
-- Run in the Supabase SQL Editor (after 025).
-- Depends on 002 (shipments) and 020 (grey_instalments → shipments.grey_instalment).
--
-- WHY: grey reaches the dyeing house by one of TWO logistical routes, and the app could
-- only express the first:
--
--   'warehouse'       PATH A — the vendor delivers the rolls to our dock. We unload,
--                     stack them, and later dispatch BOTH the rolls and the physical
--                     Program Card to the dyeing house.
--
--   'direct_to_dyer'  PATH B — to save freight, the vendor ships the raw rolls STRAIGHT
--                     to the dyeing house. The fabric never touches our floor, so the
--                     receipt is logged VIRTUALLY off the vendor's invoice. The lot is
--                     just as real: it is born here and is immediately active in the
--                     dyeing queue. Only the Program Card is couriered out; the dyer
--                     matches it to the drop-shipped rolls by the vendor design number.
--
-- WHERE IT LIVES: on `shipments` (the LOT), not `grey_instalments`. Every downstream
-- screen — dyeing queue, program cards, QC, warehouse — reads lots and never sees
-- instalments (see 020), so putting the mode on the lot is what makes it visible where
-- the decision actually matters. One instalment ships one way, so the app stamps every
-- lot it creates with the same value; the column is not duplicated on the instalment.
--
-- NOT NULL DEFAULT 'warehouse': every pre-026 lot arrived at our dock, so the default is
-- the correct backfill, not a placeholder — no UPDATE pass is needed.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, constraint dropped before re-adding.
-- RLS is inherited from the table (migration 002).
-- =============================================================================

alter table public.shipments
  add column if not exists delivery_mode text not null default 'warehouse';

alter table public.shipments drop constraint if exists shipments_delivery_mode_check;
alter table public.shipments
  add constraint shipments_delivery_mode_check
  check (delivery_mode in ('warehouse', 'direct_to_dyer'));

-- The dyeing queue badges drop-shipped lots, so this is a filtered read.
create index if not exists idx_shipments_delivery_mode
  on public.shipments (delivery_mode);

-- =========================================================================
-- Reload the PostgREST schema cache (REQUIRED — a column was added)
-- =========================================================================
notify pgrst, 'reload schema';

-- =========================================================================
-- Verification — the split of lots by how they arrived:
--   select delivery_mode, count(*), sum(sent_quantity)
--   from public.shipments group by delivery_mode;
-- =========================================================================
