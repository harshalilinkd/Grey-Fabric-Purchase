-- =============================================================================
-- Grey FMS — Migration 003: team management (super admin, email, activation)
--
-- Run this in the Supabase SQL Editor for project cmlsxzveqencatospykg
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Adds:
--   * a "super_admin" role above admin — manages users from Settings → Team
--   * profiles.email   (copied from auth.users; needed to show the team list)
--   * profiles.active  (false = user is blocked from the app)
--   * is_super_admin() helper; is_admin() now includes super admins
--   * a tightened guard (BEFORE INSERT OR UPDATE): ONLY super admins may change
--     role/active/email; super admin rows are fully immutable from the app; nobody
--     can self-promote or insert a privileged (admin/super_admin) profile from the app
--   * bootstraps harshali.linkd@gmail.com as the super admin
--
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.
-- =============================================================================

-- =========================================================================
-- 1. COLUMNS + ROLE CONSTRAINT
-- =========================================================================

alter table public.profiles add column if not exists email  text;
alter table public.profiles add column if not exists active boolean not null default true;

-- widen the role check to include super_admin
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('super_admin', 'admin', 'operator'));

-- backfill emails for existing users
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and (p.email is null or p.email <> u.email);

-- =========================================================================
-- 2. FUNCTIONS
-- =========================================================================

-- is_admin() now also true for super admins (they can do everything admins can).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in ('admin', 'super_admin')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'super_admin'
  );
$$;

-- Tightened guard on profiles (BEFORE INSERT OR UPDATE):
--   * SQL-editor / service-role contexts (no auth.uid()) pass — bootstrap + the
--     privileged /api/team route handlers, which run on the service role
--   * INSERT: an app user may never mint a privileged profile (signup inserts 'operator')
--   * UPDATE: super admin rows are fully immutable from the app (no lock-out, no coup)
--   * only a super admin may change role, active, or the displayed email
--   * nobody can promote anyone to super_admin from the app
create or replace function public.enforce_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- no JWT = SQL editor / service role → bootstrap + privileged route handlers
  if (select auth.uid()) is null then
    return new;
  end if;

  -- INSERT: only a super admin may create a non-operator profile (signup uses 'operator')
  if tg_op = 'INSERT' then
    if new.role <> 'operator' and not (select public.is_super_admin()) then
      raise exception 'Only a super admin can create privileged accounts';
    end if;
    if new.role = 'super_admin' then
      raise exception 'Promoting to super admin must be done in the SQL editor';
    end if;
    return new;
  end if;

  -- UPDATE: a super admin row cannot be touched from the app at all
  if old.role = 'super_admin' then
    raise exception 'Super admin accounts cannot be modified';
  end if;

  -- only a super admin may change the sensitive columns (role, active, email)
  if new.role is distinct from old.role
     or new.active is distinct from old.active
     or new.email is distinct from old.email then
    if not (select public.is_super_admin()) then
      raise exception 'Only a super admin can change roles, access or email';
    end if;
    if new.role = 'super_admin' then
      raise exception 'Promoting to super admin must be done in the SQL editor';
    end if;
  end if;

  return new;
end;
$$;

-- signup trigger now also records the email
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    new.email,
    'operator'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- on_auth_user_created (001, on auth.users) still points at handle_new_user() —
-- replacing the function is enough. But the role guard must now also fire on INSERT,
-- so re-create profiles_protect_role for BEFORE INSERT OR UPDATE (001 made it UPDATE-only).
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before insert or update on public.profiles
  for each row execute function public.enforce_profile_role_change();

-- =========================================================================
-- 3. BOOTSTRAP THE SUPER ADMIN
-- =========================================================================

update public.profiles
set role = 'super_admin'
where id = (select id from auth.users where email = 'harshali.linkd@gmail.com');

-- =========================================================================
-- Done. Verify with:
--   select email, role, active from public.profiles order by created_at;
-- =========================================================================
