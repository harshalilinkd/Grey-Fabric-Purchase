-- =============================================================================
-- Grey FMS — Migration 004: team department field
--
-- Run in the Supabase SQL Editor for project cmlsxzveqencatospykg (after 003).
-- Adds an optional department to profiles for team grouping + dynamic search
-- on the Settings → Team Management screen.
--
-- RLS from 001/003 already lets super admins update profiles; the role/active
-- guard trigger doesn't touch `department`, so super admins can set it freely.
-- Safe to re-run.
-- =============================================================================

alter table public.profiles add column if not exists department text;
