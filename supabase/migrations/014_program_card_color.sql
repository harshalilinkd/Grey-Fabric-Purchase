-- 014_program_card_color.sql
-- Adds a top-level base "Color" (overall shade, e.g. Royal Blue) to the program card,
-- matching the old system's program-card form. NULLABLE so existing rows are unaffected.
--
-- (delivery_days, color_cutting_attached and total_color_cutting already exist from
-- migration 002 — this only adds the missing base colour.) RLS is inherited (migration 002).

alter table public.program_cards
  add column if not exists color text;

-- Reload the PostgREST schema cache so inserts/selects see the new column immediately.
notify pgrst, 'reload schema';
