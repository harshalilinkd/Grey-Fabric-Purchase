-- =============================================================================
-- Grey FMS — Migration 008: per-colour cutting attachment on program designs
--
-- Run in the Supabase SQL Editor for project cmlsxzveqencatospykg (after 007).
--
-- The Program Cards form now records a cutting photo/PDF PER COLOUR (not one PDF per
-- program), with the white-swatch rule (White colours need no cutting). This adds the
-- per-row URL column. The cutting files still live in the `program-cuttings` bucket
-- (migration 005); this just stores each row's public URL.
--
-- Nullable on purpose: White rows (and any legacy rows) carry no cutting.
-- Safe to re-run (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

alter table public.program_card_designs add column if not exists cutting_url text;

-- After running: NOTIFY pgrst, 'reload schema';  (so the API sees the new column)
