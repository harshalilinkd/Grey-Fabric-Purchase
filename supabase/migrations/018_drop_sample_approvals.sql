-- =============================================================================
-- Grey FMS — Migration 018: drop sample_approvals (Sampling & Approval removed)
--
-- OPTIONAL. Run in the Supabase SQL Editor (after 017) ONLY if you want the
-- now-unused sampling table gone from the database. The app no longer reads or
-- writes `sample_approvals` — the workflow now starts at PO generation, so this
-- table is dormant. Dropping it is DESTRUCTIVE (any sample rows are deleted) and
-- not reversible without a backup. The app works whether or not you run this.
--
-- Note: `purchase_orders.sampling_status` (and cad_ref / handloom_ref) are LEFT
-- in place — they're harmless PO metadata and several screens still select them.
-- =============================================================================

drop table if exists public.sample_approvals cascade;

-- =============================================================================
-- Done. The Sampling & Approval feature is fully removed from the app; this just
-- clears its table. Reload the PostgREST schema cache afterwards:
--   notify pgrst, 'reload schema';
-- =============================================================================
