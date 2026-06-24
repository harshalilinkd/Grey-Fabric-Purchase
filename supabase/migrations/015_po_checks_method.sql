-- 015_po_checks_method.sql
-- Checks & weaves R&D metadata on the PO (matches the "Checks" branch of the PO R&D flow):
--   • checks_method  — which route the order came through: 'cad' or 'handloom'
--   • weaving_design — the weaving & design note (handloom route only)
-- The route's reference is stored in the existing cad_ref / handloom_ref columns (migration
-- 007). Both NULLABLE; required-ness is form-enforced (so live rows + other paths don't break).

alter table public.purchase_orders
  add column if not exists checks_method text,
  add column if not exists weaving_design text;

-- Reload the PostgREST schema cache so inserts/selects see the new columns immediately.
notify pgrst, 'reload schema';
