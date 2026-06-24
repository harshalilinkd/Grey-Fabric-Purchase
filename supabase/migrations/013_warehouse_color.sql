-- 013_warehouse_color.sql
-- Adds an optional colour to warehouse_log.
--
-- Dyed goods derive their colour from the program card (program_card_designs.color),
-- but directly-purchased / imported "ready goods" have no program — they're received
-- straight into stock via the PO "Receive into stock" action. This column lets that
-- receipt record a per-line colour so the Warehouse detail shows real data instead of "—".
-- NULLABLE, so every existing row (and all QC-pass rows, which keep deriving colour from
-- the program) is unaffected. RLS is inherited from the table (migration 002).

alter table public.warehouse_log
  add column if not exists color text;

-- Reload the PostgREST schema cache so inserts/selects see the new column immediately.
notify pgrst, 'reload schema';
