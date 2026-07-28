-- =============================================================================
-- Grey FMS — Migration 021: dyeing follow-up fields on fabric receipts (Stage 3)
--
-- Run in the Supabase SQL Editor (after 020).
-- Depends on 011 (fabric_receipts).
--
-- WHY: dyed fabric comes back from the dyeing house PIECEMEAL — a lot sits partially
-- received for days or weeks. Each received line therefore has to carry the follow-up
-- state, not just the quantity. `fabric_receipts` already stored the design, the
-- received metres, the remark and `programmed_meters` (the "total should receive"), so
-- this adds the three missing pieces:
--
--   color               — the colour of the design line received (was captured in the
--                         form from the program card, but never persisted)
--   next_followup_date  — when to chase the dyeing house for the balance
--   remaining_qty       — SNAPSHOT of the lot's outstanding metres immediately BEFORE
--                         this entry (lot qty − receivedToDate). Written once, never
--                         recomputed on read — same rule as grey_instalments (020).
--
-- All NULLABLE: existing receipt rows predate these fields and stay valid.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS. RLS is inherited from 011.
-- =============================================================================

alter table public.fabric_receipts add column if not exists color              text;
alter table public.fabric_receipts add column if not exists next_followup_date date;
alter table public.fabric_receipts add column if not exists remaining_qty      numeric;

-- Overdue follow-ups are filtered on this date.
create index if not exists idx_fabric_receipts_followup
  on public.fabric_receipts (next_followup_date);

-- =========================================================================
-- Reload the PostgREST schema cache (REQUIRED — columns were added)
-- =========================================================================
notify pgrst, 'reload schema';

-- =========================================================================
-- Verification
--   select lot_no, design_no, color, received_meters, programmed_meters,
--          remaining_qty, next_followup_date
--   from public.fabric_receipts order by created_at desc limit 20;
-- =========================================================================
