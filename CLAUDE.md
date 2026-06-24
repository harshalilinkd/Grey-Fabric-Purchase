# CLAUDE.md

Guidance for working in this repo. Read before building anything UI- or data-related.

**Grey FMS** — internal grey-fabric management system for **LD Silk Mills** (user: Harshali).
It tracks the pipeline: purchase orders → grey receipts/shipments → dyeing → QC → warehouse.

## Commands

```bash
npm run dev     # dev server on http://localhost:3000
npm run build   # production build (must stay green — typecheck runs here)
npm run start   # serve the production build
npm run lint    # Next.js ESLint
```

There is no test suite. "Verify" = `npm run build` passes. Live data flows can't be
verified from here (no test session; see the MCP caveat below).

⚠️ **Never run `npm run build` while the user's dev server is running.** Both share
`.next/`; the build clobbers the dev server's chunk graph, so pages still SSR but all
client JS 404s — React never hydrates and every button silently dies (bitten 2026-06-10).
Check port 3000 first; if the dev server is up, ask or stop it before building, and
restart it (after deleting `.next/`) afterward.

## Locked stack — do not re-litigate

Confirmed with the user; treat as fixed for every task:

- **Next.js 15 (App Router) + TypeScript** (strict). Path alias `@/*` → `./src/*`.
- **Supabase** via **`@supabase/ssr`** for auth/session (httpOnly cookies), with
  **middleware protecting all logged-in routes**. Chosen over a Vite SPA for
  server-gated auth + zero-config Vercel deploy. Don't propose switching frameworks.
- **Server Components load initial data; Client Components + TanStack Query** for
  anything interactive.
- **Route handlers** (`src/app/api/...`) for admin-only / privileged actions.
- Supabase **Storage** for program-card PDF colour-cutting uploads — **built**: public bucket
  `program-cuttings` (migration 005), uploaded from the Program Cards form, public URL saved to
  `program_cards.pdf_url`.

⚠️ **Styling reality vs. intent.** The stack is *meant* to use **Tailwind** (wired to the
design-system CSS variable tokens). It currently does **not** — styling is **plain CSS** in
`src/styles/{tokens,shell,components}.css` and there is no Tailwind dependency or config.
A Tailwind migration (same tokens, identical look) is **pending and not yet done**. Until
it happens, **add styles as plain CSS using the existing token variables** — match the
current files; don't introduce Tailwind half-way unless the task is explicitly that migration.

## Architecture

```
src/
  middleware.ts                    # refreshes Supabase session, redirects unauthed→/login, authed-on-/login→/
  app/
    layout.tsx                     # root: next/font (Sora as --font-sans), pre-paint theme/sidebar script, ThemeProvider + Providers
    login/page.tsx                 # standalone (email/password + sign-up toggle) — NOT in the (app) group
    (app)/                         # route group for all authed screens
      layout.tsx                   # server-fetches user + profile → AppShell
      page.tsx                     # Dashboard (still demo/hardcoded data)
      <screen>/page.tsx            # one page per nav item
    api/<domain>/[id]/route.ts     # privileged route handlers (admin-only deletes)
  components/
    shell/                         # AppShell (responsive chrome + mobile drawer), Sidebar, TopBar
    theme/ThemeProvider.tsx        # light/dark, persisted to localStorage `grey-fms-theme`
    providers/Providers.tsx        # TanStack Query + ToastProvider
    ui/                            # Icon (named SVGs), CountUp, Toast, PagePlaceholder
    <domain>/                      # per-screen client components + modals
  lib/
    nav.ts                         # SINGLE SOURCE OF TRUTH for sidebar nav + NAV_BY_PATH (pages read their own title/blurb from here)
    types.ts                       # shared domain types
    format.ts                      # number formatting, addCalendarDays, etc.
    supabase/{client,server,middleware}.ts   # browser / server / middleware clients
    <domain>.ts                    # typed data functions per screen (see pattern below)
  styles/{tokens,shell,components}.css       # selvedge tokens + styles (plain CSS)
supabase/migrations/               # 001_, 002_ … (see Database)
```

### Data-layer pattern (follow it for new screens)

- Each screen has a `src/lib/<domain>.ts` exporting typed `fetch*/create*/update*`
  functions that use the **browser** client (`@/lib/supabase/client`) and throw on error.
- A Server Component fetches initial data, then hands off to a `<Domain>Client`
  Client Component that uses **TanStack Query** (stable query keys, e.g. `shipments_all`).
- **Deletes (and any admin-only action) go through a route handler**, never a direct
  client delete: the handler checks `profiles.role === 'admin'` and returns a clear 403,
  then deletes. RLS also enforces this — the role check just yields a real error instead
  of a silent 0-row delete. See `src/app/api/purchase-orders/[id]/route.ts` as the template.

### Theme / sidebar mechanics

Theme = `html.light` / `html.dark`. Desktop collapse = `html.sb-collapsed` (CSS-driven,
persisted to `grey-fms-sidebar`, only `@media (min-width:901px)`). Mobile (≤900px) =
`.sidebar.mobile-open` drawer + `.sb-backdrop`, React state in `AppShell`. The root
`<html>` uses `suppressHydrationWarning` because the pre-paint inline script mutates its class.

## Database

Backend is the Supabase project for Grey FMS (URL + anon key in `.env.local` and in
memory). Env vars (both browser-safe): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- **Migrations** live in `supabase/migrations/`, named with a **zero-padded sequential
  counter** (`001_`, `002_`, …) — **NOT timestamps**. The user audits by count and applies
  them **manually in the Supabase SQL Editor**. Always continue the sequence.
  - `001` = profiles + master tables + RLS + helpers (`is_admin()`, `set_updated_at()`, signup trigger). Applied.
  - `002` = authoritative 7-table workflow schema (purchase_orders, shipments, program_cards,
    program_card_designs, qc_checklist, reissue_return, warehouse_log). Treat the migration file as
    the schema source of truth. **(Re-)applied 2026-06-11.** ⚠️ **Schema-drift incident:** the live DB
    had an *earlier draft* applied as "002" (different names everywhere — `vendor`/`lot`/`purchase_order`/
    `dyeing_house`/`meters`, no `unique_id`, a `program_card_uid_seq`, and the repo-named tables
    shipments/qc_checklist/reissue_return/warehouse_log didn't exist), so every screen failed at
    runtime (PO insert: "Could not find the 'unique_id' column…"). Fixed by re-running this
    authoritative 002 (its section 0 self-cleans the draft) then 007. **Lesson: the repo migration
    files are the source of truth — if the app errors on a "missing" column that the file defines,
    dump `information_schema.columns` and confirm the live DB actually matches before chasing caches.**
  - `003` = team management: adds `super_admin` role + `profiles.email`/`profiles.active`,
    `is_super_admin()`, tightened guard (BEFORE INSERT OR UPDATE: super-admin rows immutable from the
    app, role/active/email super-admin-only, no privileged INSERT), bootstraps
    harshali.linkd@gmail.com as super admin. **Applied 2026-06-11** (hardened beyond the original spec).
  - `004` = `profiles.department` (Settings → Team grouping/search). **Applied 2026-06-11.**
  - `005` = `program-cuttings` public Storage bucket + RLS (public read, authenticated insert,
    admin delete) for the Program Cards PDF colour-cutting uploads. **Applied (user ran it 2026-06-11).**
  - `006` = `submit_qc_inspection(payload jsonb)` RPC — performs the QC writes (qc_checklist +
    conditional warehouse_log + reissue_return) in ONE transaction. `SECURITY INVOKER` (RLS still
    applies). **Applied 2026-06-12** — QC submit is now atomic. (The data layer still falls back to
    sequential client inserts if the function is ever absent; that fallback writes the side-effect
    rows first and the lot-hiding qc_checklist row last, so a mid-failure stays retryable.)
  - `007` = PO sourcing + quality metadata + colour split. Adds to `purchase_orders` (all NULLABLE,
    CHECK on the enums): `sourcing_path` (grey/client_fabric/checks_weaves/direct_purchase/imported),
    `quality_name`, `selling_merchant_no`, `vendor_design_no` (the three form-**required**),
    `sampling_status` (approved/not_required/pending), `cad_ref`, `handloom_ref`, `direct_subtype`
    (new_cloth/old_milano). New child table **`po_color_variants`** (id, `purchase_order` FK→PO
    **ON DELETE CASCADE**, code, color_name, meters) + FK index + 002-style RLS (admin-only delete).
    Required-ness is **form-enforced** (DB nullable so live rows + the pre-form insert don't break).
    ⚠️ Variant **delete is admin-only** — so PO-edit variant removal goes via a **service-role route
    handler** `PUT /api/purchase-orders/[id]/variants` that **replace-all**s the variant set (auth +
    deactivated-user check, then admin client to satisfy the admin-only DELETE; capped at 50 rows).
    The data layer's `syncVariants` calls it from both create + update. **Applied 2026-06-11** (re-run
    after 002 during the drift fix). Reload the PostgREST schema cache after applying.
  - `008` = `program_card_designs.cutting_url text` (NULLABLE) — per-colour cutting photo/PDF for the
    Program Cards white-swatch rule (White colours need no cutting). Files still go to the
    `program-cuttings` bucket (005). **Pending — user runs it** (the new form fails on save without it:
    "Could not find the 'cutting_url' column…"). Reload the schema cache after (`NOTIFY pgrst, 'reload schema';`).
  - `009` = **`final_receipts`** table (id, `receipt_id` "FR-{ts}", `lot_no`, `po_unique_id`, `final_qty`,
    `status` CHECK Closed/Partial/On Hold default Closed, `remark`, `received_date`) + lot/po indexes +
    set_updated_at trigger + 007-style RLS (admin-only delete). Records the final good qty per lot,
    closing it. (Prompt 6 called it "008", but 008 was taken — this is 009.) **Pending — user runs it.**
    ⚠️ 002 section 0 drops `final_receipts cascade` and never recreates it → if 002 is ever re-run after
    009, re-apply 009. Reload the schema cache after.
  - `010` = **`dyeing_followups`** table (id, `followup_id` "DF-{ts}", `lot_no`, `po_unique_id`,
    `dying_house_name` [the "dying" spelling], `remaining_meters`, `next_followup_date`, `remark`) +
    lot/po indexes + trigger + 007-style RLS. Log of follow-ups for lots at the dyeing house; overdue
    (`next_followup_date <= today`) flagged client-side. **Applied 2026-06-11.**
  - `011` = **`fabric_receipts`** table (id, `receipt_id` "FAB-{ts}{i}{rand}" per-row, `lot_no`,
    `po_unique_id`, `design_no`, `programmed_meters` [snapshot], `received_meters`, `received_date`,
    `remark`) + lot/po indexes + trigger + 007-style RLS. One row per design received back; one submit
    inserts many rows. **Applied 2026-06-11.** (010 + 011 are new names — 002 section 0 doesn't drop them.)
- **Roles:** `super_admin` > `admin` > `operator`. Only a super admin can change roles or
  deactivate users (Settings → Team Management → `/api/team/[id]`); super admin rows are
  immutable from the app. `is_admin()` includes super admins. Deactivated users are bounced
  by `(app)/layout.tsx` → `/api/auth/deactivated` (signs out, login shows a notice).
- **RLS:** authenticated read/insert/update; **admin-only delete**. Profiles: operators read
  only their own row; admins+ read all (the Team list relies on this).
- **Business IDs** are app-generated text: `UID-${Date.now()}` (PO `unique_id`),
  `SHID-${Date.now()}` (shipment), `PG-{n}` (program — sequential max+1, retried on a unique
  collision), `QC-{ts}{i}{rand}` (qc `check_id`), `STORE-{ts}{i}{rand}` (warehouse `store_id`),
  `RE-{ts}{i}{rand}` (reissue `reissue_id`). The QC/STORE/RE ids carry a **per-row suffix** because
  one QC submit inserts many rows into those `UNIQUE` columns. Lots are born on the **shipment**
  (`lot_no` is set there, not on the PO).
- **`purchase_orders.amount` is a generated column** (quantity × rate) — never write it;
  omit it from insert/update payloads and display it rounded via `lib/format.ts`.
- **Watch column spellings** (intentional, matched to the real schema): `dying_house_name`
  (note "dying", not "dyeing"); and the colour split — `program_card_designs.color` (US) vs
  `qc_checklist.colour_check` (UK), mixed on purpose. When in doubt, grep the migration.

⚠️ **Reload the PostgREST schema cache after any column-adding migration.** Supabase's API
caches the table schema; right after an `ALTER TABLE ... ADD COLUMN`, inserts/updates can fail
with `Could not find the '<col>' column of '<table>' in the schema cache` (it names the *first*
payload column, not necessarily the new one — the column is really there). Fix: run
`NOTIFY pgrst, 'reload schema';` in the SQL Editor (or Dashboard → Settings → General → Restart
project, or wait ~60s). Tell the user to do this as the last step of every such migration. Hit
2026-06-11 right after applying 007.

⚠️ **Supabase MCP cannot reach this project.** The connector in this session is authed to a
*different* org and returns "permission denied" for the Grey FMS project. Do **not** run
`apply_migration`/`execute_sql` against it (and never against the unrelated SCOTv1/linkdscot
projects). **Hand the user SQL to paste into the dashboard SQL Editor instead.**

⚠️ **Never create auth users via raw `insert into auth.users`** — it leaves token columns
NULL and breaks sign-in with "Database error querying schema." Create users via
**Dashboard → Authentication → Add user (auto-confirm)**.

## Design system — clean & professional (mandatory on every screen)

FINAL as of 2026-06-10, after the user rejected two themed looks the same day (the indigo/teal
"selvedge" elevated style and the warm-greige "Dyehouse" style). **Do not drift decorative
again**: no gradients, no background textures, no themed metaphors. Implemented spec =
`src/styles/{tokens,shell,components}.css`; match the existing screens.

- **Font: Sora ONLY** — body, all headings, display text, and figures. Loaded via next/font
  as `--font-sans`. `.mono` = `font-variant-numeric: tabular-nums` (still Sora — JetBrains
  Mono is gone). Use `<CountUp>` for animated `en-IN`-formatted numbers.
- **Foundation (light):** page bg `--bg #F7F7F8`; cards are pure white `--card` and MUST
  visibly separate from the page — 1px `--border #E6E6E9` **plus** shadow `--sh`. Never let
  cards blend. Text: `--fg #18181B` primary, `--fg-2 #3F3F46` secondary, `--muted #71717A`
  labels only (≥4.5:1 everywhere). **Dark:** bg `#0A0A0B`, cards `#161618`, text `#FAFAFA`.
- **One accent — cobalt `--accent #2563EB`** (dark `#3B82F6`), used sparingly: active nav
  (soft fill + 2.5px left bar), primary button, focus rings, key numbers. No gradient washes.
  Status tokens: `--ok` `--warn` `--bad` `--info` + `-bg` tints; destructive uses `--bad`.
- **Radii/spacing:** 14px cards & modals, 10px buttons/inputs, 7px pills/small actions;
  4/8 spacing system, generous whitespace. **Content spans the full width** between the
  sidebar and window edge — no max-width cap, just 32px side padding (16px mobile).
- **Required patterns:**
  - Status-count rows are **segmented controls** (`.seg`): rounded `--card-2` track, active
    segment = white card + `--sh-sm`, counts in `.cnt` badges (accent on the active one).
    Never plain floating text. The Dyeing Queue's seg also filters (All/Pending/Created).
  - **Empty tables hide their column headers**: components conditionally render `<table>` vs
    `.empty` (60px icon tile in `--accent-soft` + bold h3 + one muted line). Never strand
    headers above an empty void.
  - Tables: white card, uppercase `--muted` headers on a faint `--inset` row, 13px rows,
    `--card-2` row hover. Status = small **dot+label pills** (`pill info|success|warning|danger|brand|plain`).
  - **Clickable rows** (Program Cards, Reissue & Return): keep table semantics — do NOT put
    `role="button"` on `<tr>` (it hides the cells from screen readers). The row `onClick` is a
    mouse convenience; the keyboard path is a real focusable control inside the row (an `.act`
    "Details" button, or a `.cell-btn` wrapping the status pill — both ≥40/44px), and
    `tr.clickable:focus-within` lights the row.
  - **Multi-step flows** (QC Inspection): a `.modal` wizard with a `.wizard-steps` indicator;
    gate "Next" on per-step validity; each step owns loading/empty/error states.
- **Motion: subtle only** — fade-up on load (`rise`), count-up numbers, skeleton shimmer;
  everything disabled under `prefers-reduced-motion`. No floats/halos/shimmer sweeps.
- **A11y:** visible accent `:focus-visible` rings, ≥40px controls (44px on `pointer: coarse`),
  loading/empty/error states everywhere, toasts on every mutation, confirm dialogs on deletes.
- **Every color is a semantic CSS variable** — never hardcode hex/rgb in components. Light
  (default) + dark ship via the top-bar toggle, persisted and applied before paint.

## Current state (2026-06)

**Live (server fetch + TanStack Query):**
- **Dashboard** (`/`) — **live command center** (`src/lib/dashboard.ts` `deriveDashboard` = pure
  derivations over the raw rows; Server Component parallel-fetches 8 sources → `DashboardClient` reuses
  the **existing per-domain query keys** so it inherits realtime with no `RealtimeProvider` change).
  6 clickable CountUp KPI cards (each a `<Link>` + a "Go to" palette command): Open POs (= grey not
  fully received) + ₹ on-order, Grey received this UTC month (m + lots), Lots in dyeing (+ pending
  program), Pending QC, Warehouse stock (m + designs), Reissue pending — **each formula mirrors its
  source screen** so the numbers reconcile. **Lot-stage funnel** (animated `grow` bars + CountUp;
  cumulative distinct-lot sets received→programmed→in-dyeing→received-back→warehoused). **Follow-ups
  due** (overdue `dyeing_followups` + POs past expected grey date `order_date + delivery_days` with grey
  pending; overdue-first, one-click jump). **Live activity** (newest across shipments/programs/qc/
  warehouse by `created_at`; genuinely-new rows slide in via a seen-ids ref). `today` = UTC
  `toISOString().slice(0,10)` (hydration-safe, matches the dyeing screen). Added `--accent-bg` token.
- **Purchase Orders** (`/purchase-orders`) — **smart adaptive form** driven by a sourcing-path
  pill row (grey/client_fabric/checks_weaves/direct_purchase/imported): shared core + a path-
  specific panel (sample-approval toggle → `sampling_status`; checks adds cad/handloom refs;
  direct→`direct_subtype`; imported badge), an Internal Quality Name datalist (required), and a
  **colour breakdown** editor (auto A/B/C, live "X of Y m allocated") saved to `po_color_variants`
  via the service-role variants route. Table adds Quality Name + Sourcing + a colour-count chip;
  **optimistic create/edit**; track modal shows metadata + variants + received-vs-ordered;
  admin-only delete with full-fidelity Undo (variants snapshot + replay).
- **Grey House Follow Up** (`/grey-receipts`) — sent vs. pending per PO; manage-shipments
  modal logs shipments (which create lots). Over-shipment is allowed but warns via toast.
- **Dyeing Queue** (`/dyeing-queue`) — read-only; derives one lot-row per shipment, status
  Pending/Created Program; hides lots already in `qc_checklist`.
- **Program Cards** (`/program-cards`) — groups `program_cards` by Program ID + Lot No,
  enriched with parent PO; row→detail popup lists the colour cuttings (`program_card_designs`,
  with a per-colour **View cutting** link); **hides lots already in `qc_checklist`**. Smarter
  New-Program form: lot picker → **pre-fills colour rows from the PO's `po_color_variants`**
  (colour + metres, defaults Total meters to their sum), **per-colour cutting** upload with the
  **white-swatch rule** (a colour named "White" needs no cutting; all others require one), a live
  meterage indicator, auto `PG-{n}`, optimistic create. `design_no` = the auto A/B/C code (feeds
  QC). **Needs migration 008** (`cutting_url`).
- **QC Inspection** (`/qc-inspection`) — "Start QC" 3-step wizard (pick program + received qty
  + tick designs → Pass/Fail → four checks, or failed-qty/reason/return-&-reissue). On submit,
  **per selected design**: a `qc_checklist` row always, a `warehouse_log` row when
  `passed_qty > 0`, a `reissue_return` row on Fail with `failed_qty > 0`. Prefers the atomic
  RPC (migration 006), falls back to sequential inserts. Past-inspections table. Submitting
  invalidates `["qc_lots"]`, so **the lot leaves the Dyeing Queue + Program Cards**.
- **Reissue & Return** (`/reissue-return`) — every `reissue_return` row enriched with parent PO
  (via `original_po_unique_id`); row→detail popup with two sections (Original PO info; Failure &
  reissue details, Failed Qty = `reissue_qty`). Actions: Assign New Lot No (→ `Reissue Pending`)
  or Mark as Returned (→ `Returned`, clears `new_lot_no`); a Returned row is terminal in the UI.
- **Warehouse** (`/warehouse`) — live **Ready-Goods ledger**: `warehouse_log` (written by QC on
  pass) grouped one row per lot, joined to the parent PO for the **Quality Name** + rate and to
  `program_cards` for Program ID + dyeing house (warehouse_log has no `program_uid`). 3 CountUp
  metric cards (stored metres, stored-design count, reissue-pending). Clickable rows → detail
  (general info + Stored-designs table with colour from `program_card_designs`, + Failed/reissued
  table). Read-only. Realtime: `warehouse_log → ["warehouse_all"]` so QC passes appear live
  (needs the table in the `supabase_realtime` publication).
- **Dyeing Follow Up** (`/dyeing-follow-up`) — log of follow-ups for lots still at the dyeing house
  (migration 010 `dyeing_followups`). "Log follow-up" modal (key `n`/palette): picks a lot (has a
  program, not yet QC'd), pre-fills dyeing house + remaining metres, sets next date + remark. **Overdue**
  (`next_followup_date <= today`) gets a danger pill, an overdue-count metric card, and **floats to the
  top** (primary sort key, chosen column sorts within groups). Optimistic insert, realtime, search/sort.
- **Fabric Receipts** (`/fabric-receipts`) — dyed fabric received back **per design** (migration 011
  `fabric_receipts`). "Record fabric receipt" modal (key `n`/palette): picks a lot → loads its
  `program_card_designs` (seeded once/program, default received = programmed metre) → enter received per
  design with a live **received-vs-programmed** indicator (matched/short/over). One row per design (short
  ones flagged), optimistic multi-row insert, realtime, search/sort.
- **Final Receipts** (`/final-receipts`) — records the **final confirmed good qty per lot, closing it**
  (migration 009 `final_receipts`). "Record final receipt" modal (key `n`/palette): picks a QC-passed lot
  (in `warehouse_log`, minus already-closed lots), defaults Final metres to the lot's stored metres, +
  status (Closed/Partial/On Hold)/remark/date. Table (Lot, PO, Quality Name, Final metres, Date, status
  pill) with instant search/sort, **optimistic insert**, realtime (`final_receipts`), smart empty state.
- **Settings** (`/settings`) — Team Management: members table (name/email/role/status/joined);
  super admins change roles (operator↔admin) and deactivate/reactivate via `/api/team/[id]`.
  Degrades gracefully until migration 003 is applied (no email/controls shown).

⚠️ **Reality check (2026-06-11):** these screens are coded correctly against the repo schema, but
until 2026-06-11 the **live DB was a drifted draft** (see the 002 migration note), so none of them
actually worked end-to-end against the real backend. After re-applying the authoritative 002 + 007,
the DB finally matches the code — so treat "live" as "code-complete + schema now aligned," and
re-verify each screen against real data as you touch it. Migrations **001–011 all applied** (incl. 006).

**Everything in the nav is now built — including the live Dashboard.** The remaining work is the
pending tech debt below. **All 11 migrations + 006 are applied and Realtime replication is enabled
(2026-06-12)** — the app is feature-complete and fully wired to the live backend.

**Pending tech debt:** the Tailwind migration (above); and the README is stale (it claims the backend
isn't connected — it is).

## Working norms

- The user reviews migrations by count and runs them manually — when schema changes, write
  the next sequential migration file **and** give them the SQL to paste, don't assume it's applied.
- New screens: reuse `nav.ts` for routing/title/blurb, the `lib/<domain>.ts` data pattern,
  the route-handler pattern for privileged writes, and the design-system styles. Keep `npm run build` green.
