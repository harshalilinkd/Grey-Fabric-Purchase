-- =============================================================================
-- Grey FMS — Migration 005: program-card PDF colour-cutting storage
--
-- Run in the Supabase SQL Editor for project cmlsxzveqencatospykg (after 004).
--
-- Creates the public Storage bucket the Program Cards screen uploads PDF colour
-- cuttings to, and the access policies on storage.objects:
--   • read   = public  (a public bucket serves cuttings via a stable getPublicUrl)
--   • insert = any authenticated user (operators create programs)
--   • delete = admins only (mirrors the delete-only-admin rule on the data tables)
--
-- Safe to re-run (on conflict / drop policy if exists). Alternatively the bucket
-- can be created via Dashboard → Storage → New bucket ("program-cuttings", public).
-- =============================================================================

-- 1. The bucket (public so saved PDF links keep working without signing).
insert into storage.buckets (id, name, public)
values ('program-cuttings', 'program-cuttings', true)
on conflict (id) do update set public = excluded.public;

-- 2. Policies on storage.objects, scoped to this bucket.
drop policy if exists "program_cuttings_read"   on storage.objects;
drop policy if exists "program_cuttings_insert" on storage.objects;
drop policy if exists "program_cuttings_delete" on storage.objects;

create policy "program_cuttings_read"
  on storage.objects for select
  to public
  using (bucket_id = 'program-cuttings');

create policy "program_cuttings_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'program-cuttings');

create policy "program_cuttings_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'program-cuttings' and (select public.is_admin()));
