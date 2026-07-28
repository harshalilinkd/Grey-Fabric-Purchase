-- =============================================================================
-- Grey FMS — Migration 022: dyeing_followups.sent_qty (Stage 6's defining column)
--
-- Run in the Supabase SQL Editor (after 021).
-- Depends on 010 (dyeing_followups).
--
-- WHY: `dyeing_followups` is Stage 6 of the source workflow — the record of SENDING
-- rejected metres back out to a dyeing house — built without its defining column.
-- Stage 6 is: UNIQUE ID · Timestamp · ORDER NO. · PO NO · Remaining Qty · SENT QTY ·
-- NEXT FOLLOWUP DATE · REMARK · Dyeing House Name. Migration 010 shipped that list
-- minus SENT QTY, and stripped of the dispatched quantity the remaining columns read
-- like a chase log ("lot, dyeing house, metres outstanding, chase date, remark") —
-- which is how the screen came to be labelled and used.
--
-- It is a dispatch record. That is also why it carries its own dyeing house: a reissue
-- often goes to a DIFFERENT house than the PO named.
--
-- Without this column every reissue dispatch is stored with no quantity dispatched, so
-- the reissue cycle cannot be reconciled against what comes back at Stage 7.
--
-- NULLABLE: rows written before this migration have no sent quantity to backfill, and
-- there is no safe value to invent — `remaining_meters` is the outstanding balance, not
-- the amount dispatched. The form requires it going forward; historic rows read "—".
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.
--
-- FORWARD NOTE: if Pipeline C is built, its "Sent for Dyeing From LD Silk" leg is the
-- same shape minus the dyeing house — a `cycle` value on THIS table, not a new one.
-- =============================================================================

alter table public.dyeing_followups
  add column if not exists sent_qty numeric;

-- =========================================================================
-- Reload the PostgREST schema cache (REQUIRED — a column was added)
-- =========================================================================
notify pgrst, 'reload schema';

-- =========================================================================
-- Verification
--   select followup_id, lot_no, dying_house_name, sent_qty, remaining_meters,
--          next_followup_date from public.dyeing_followups order by created_at desc limit 20;
-- =========================================================================
