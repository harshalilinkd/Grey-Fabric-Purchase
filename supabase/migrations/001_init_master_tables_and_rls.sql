-- =============================================================================
-- Grey FMS — Migration 001: master tables, profiles & Row Level Security
--
-- Run this in the Supabase SQL Editor for project cmlsxzveqencatospykg
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.
-- =============================================================================

-- =========================================================================
-- 1. TABLES
-- =========================================================================

-- profiles: one row per Supabase auth user.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  role        text not null default 'operator' check (role in ('admin', 'operator')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'One row per auth user; role ("admin" | "operator") gates admin abilities.';

-- vendors (master list)
create table if not exists public.vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  contact     text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- dyeing_houses (master list)
create table if not exists public.dyeing_houses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  contact     text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- qualities (master list)
create table if not exists public.qualities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- holidays (master list — used to skip non-working days when planning dates)
create table if not exists public.holidays (
  id            uuid primary key default gen_random_uuid(),
  holiday_date  date not null unique,
  label         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- =========================================================================
-- 2. FUNCTIONS
-- =========================================================================

-- Keep updated_at current on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Is the *current* logged-in user an admin?
-- SECURITY DEFINER so it reads profiles WITHOUT triggering profiles' own RLS
-- (otherwise policies that call this would recurse infinitely).
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
      and role = 'admin'
  );
$$;

-- Guard the role column: a logged-in non-admin may never change a role
-- (not even on their own row). Server/SQL-editor contexts (no auth.uid())
-- are allowed through — that's how the first admin is bootstrapped and how
-- privileged service-role route handlers change roles.
create or replace function public.enforce_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and (select auth.uid()) is not null
     and not (select public.is_admin())
  then
    raise exception 'Only admins can change a profile role';
  end if;
  return new;
end;
$$;

-- Auto-create a profile (role = operator) when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    'operator'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- =========================================================================
-- 3. TRIGGERS
-- =========================================================================

-- updated_at maintenance on every table
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists vendors_set_updated_at on public.vendors;
create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

drop trigger if exists dyeing_houses_set_updated_at on public.dyeing_houses;
create trigger dyeing_houses_set_updated_at
  before update on public.dyeing_houses
  for each row execute function public.set_updated_at();

drop trigger if exists qualities_set_updated_at on public.qualities;
create trigger qualities_set_updated_at
  before update on public.qualities
  for each row execute function public.set_updated_at();

drop trigger if exists holidays_set_updated_at on public.holidays;
create trigger holidays_set_updated_at
  before update on public.holidays
  for each row execute function public.set_updated_at();

-- role-change guard on profiles
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.enforce_profile_role_change();

-- auto-profile on signup (trigger lives on auth.users)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- 4. ROW LEVEL SECURITY
-- =========================================================================

alter table public.profiles      enable row level security;
alter table public.vendors       enable row level security;
alter table public.dyeing_houses enable row level security;
alter table public.qualities     enable row level security;
alter table public.holidays      enable row level security;

-- Base table privileges for logged-in users (RLS still decides the rows).
grant select, insert, update, delete on
  public.profiles,
  public.vendors,
  public.dyeing_houses,
  public.qualities,
  public.holidays
to authenticated;

-- ---------- profiles ----------
-- Read: your own row, or anything if you're an admin.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id or (select public.is_admin()));

-- Insert: admins only (normal profiles are created by the signup trigger).
drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check ((select public.is_admin()));

-- Update: your own row, or any row if admin. (The role column is additionally
-- protected by the profiles_protect_role trigger above.)
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id or (select public.is_admin()))
  with check ((select auth.uid()) = id or (select public.is_admin()));

-- Delete: admins only.
drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using ((select public.is_admin()));

-- ---------- master lists ----------
-- Pattern for every master table:
--   * any logged-in user can READ
--   * only admins can INSERT / UPDATE / DELETE

-- vendors
drop policy if exists vendors_read on public.vendors;
create policy vendors_read on public.vendors
  for select to authenticated using (true);
drop policy if exists vendors_admin_write on public.vendors;
create policy vendors_admin_write on public.vendors
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- dyeing_houses
drop policy if exists dyeing_houses_read on public.dyeing_houses;
create policy dyeing_houses_read on public.dyeing_houses
  for select to authenticated using (true);
drop policy if exists dyeing_houses_admin_write on public.dyeing_houses;
create policy dyeing_houses_admin_write on public.dyeing_houses
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- qualities
drop policy if exists qualities_read on public.qualities;
create policy qualities_read on public.qualities
  for select to authenticated using (true);
drop policy if exists qualities_admin_write on public.qualities;
create policy qualities_admin_write on public.qualities
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- holidays
drop policy if exists holidays_read on public.holidays;
create policy holidays_read on public.holidays
  for select to authenticated using (true);
drop policy if exists holidays_admin_write on public.holidays;
create policy holidays_admin_write on public.holidays
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- =========================================================================
-- 5. BOOTSTRAP THE FIRST ADMIN
-- =========================================================================
-- The signup trigger makes everyone an "operator". After you've signed up
-- once in the app, run this ONCE in the SQL Editor (it bypasses RLS here),
-- replacing the email, to make yourself an admin:
--
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
-- =========================================================================
