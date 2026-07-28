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
    `program-cuttings` bucket (005). **Applied.** Reload the schema cache after (`NOTIFY pgrst, 'reload schema';`).
  - `009` = **`final_receipts`** table (id, `receipt_id` "FR-{ts}", `lot_no`, `po_unique_id`, `final_qty`,
    `status` CHECK Closed/Partial/On Hold default Closed, `remark`, `received_date`) + lot/po indexes +
    set_updated_at trigger + 007-style RLS (admin-only delete). Records the final good qty per lot,
    closing it. (Prompt 6 called it "008", but 008 was taken — this is 009.) **Applied.**
    ⚠️ 002 section 0 drops `final_receipts cascade` and never recreates it → if 002 is ever re-run after
    009, re-apply 009. Reload the schema cache after.
  - `010` = **`dyeing_followups`** table (id, `followup_id` "DF-{ts}", `lot_no`, `po_unique_id`,
    `dying_house_name` [the "dying" spelling], `remaining_meters`, `next_followup_date`, `remark`) +
    lot/po indexes + trigger + 007-style RLS. **Applied 2026-06-11.** ⚠️ Originally built as a *chase
    log*; 022 revealed it is really the **Stage-6 reissue-dispatch record** — see 022/025.
  - `011` = **`fabric_receipts`** table (id, `receipt_id` "FAB-{ts}{i}{rand}" per-row, `lot_no`,
    `po_unique_id`, `design_no`, `programmed_meters` [snapshot], `received_meters`, `received_date`,
    `remark`) + lot/po indexes + trigger + 007-style RLS. One row per design received back; one submit
    inserts many rows. **Applied 2026-06-11.** (010 + 011 are new names — 002 section 0 doesn't drop them.)
  - `012` = **master-list management**: `active boolean not null default true` on `vendors`/
    `dyeing_houses`/`qualities`, plus a **new `processes` master** (there wasn't one), same shape + RLS
    as the others (authenticated read, admin write). Backs Settings → Master Lists (add/edit/deactivate;
    admin-gated delete). Inactive entries drop out of the form dropdowns but keep existing rows valid.
  - `013` = `warehouse_log.color text` (NULLABLE). Dyed goods derive colour from
    `program_card_designs.color`, but **finished goods** (direct purchase / imported) have no program —
    they are received straight into stock via the PO "Receive into stock" action, and this lets that
    receipt carry a per-line colour instead of showing "—".
  - `014` = `program_cards.color text` (NULLABLE) — the card's top-level **base shade** (e.g. Royal
    Blue), matching the old paper form. (`delivery_days`, `color_cutting_attached`,
    `total_color_cutting` already existed from 002.)
  - `015` = `purchase_orders.checks_method` ('cad' | 'handloom') + `weaving_design` — the **Checks**
    source's R&D route. The route's reference lives in the existing `cad_ref` / `handloom_ref` (007).
    Both NULLABLE, form-enforced.
  - `016` = **reversible, super-admin-only ARCHIVE** of a PO and its whole graph. An `archived boolean
    not null default false` on every screen-listed table (purchase_orders, shipments, program_cards,
    qc_checklist, reissue_return, warehouse_log, final_receipts, dyeing_followups, fabric_receipts),
    **hidden at the RLS layer** — archived rows simply stop being returned by every existing query, so
    **no app code had to change**. One atomic super-admin-gated function flips the flag across the PO
    graph (matched by `po_unique_id` / `lot_no`); a restore flips it back. `program_card_designs` and
    `po_color_variants` need no flag (hiding the parent hides them). Service-role / SECURITY DEFINER
    paths bypass the hide so a super admin can still see and restore.
  - `017` = `sample_approvals` (pre-PO sampling). **Superseded — do not build on it.**
  - `018` = **drops `sample_approvals`** (OPTIONAL, destructive). The Sampling & Approval module was
    removed from the app (commit `f7f0dbb`); **the workflow starts at PO generation**. The app works
    whether or not 018 has been run. `purchase_orders.sampling_status`/`cad_ref`/`handloom_ref` are
    deliberately LEFT in place — harmless PO metadata that several screens still select.
    **Do NOT rebuild a sampling stage.**
  - `019` = `purchase_orders.dying_house_name` — a PO is "a quantity of metres at a rate, from ONE
    vendor, for ONE dyeing house", so the house is captured at the PO, not a stage later on the program
    card. Same "dying" spelling as `program_cards.dying_house_name` on purpose (UI label stays "Dyeing
    house"). NULLABLE: finished-goods POs never reach a dyeing house and keep it NULL; form-required on
    the dyeing sources only.
  - `020` = **`grey_instalments`** (Stage 2). Grey arrives in **instalments**, and one instalment can
    split into **several lots** — previously an instalment and a lot were the same `shipments` row, so a
    3-lot delivery couldn't be recorded as one event. New table: `instalment_id` "GRI-{ts}",
    `po_unique_id`, `received_date`, `sent_quantity`, `remaining_qty`, `next_followup_date`, `remark`;
    `shipments` gains `grey_instalment` (nullable FK). **`shipments` is still one row per LOT** — nothing
    downstream sees instalments, so the dyeing queue / program cards / QC / warehouse are untouched.
    ⚠️ `remaining_qty` is a **SNAPSHOT** of what was outstanding immediately BEFORE the entry — written
    once, **never recomputed on read**.
  - `021` = dyeing follow-up fields on `fabric_receipts` (Stage 3): `color`, `next_followup_date`, and
    `remaining_qty` (again a **write-once SNAPSHOT** of the lot's outstanding metres before the entry).
    Dyed fabric comes back **piecemeal**, so each received line carries the follow-up state, not just a
    quantity. All NULLABLE.
  - `022` = `dyeing_followups.sent_qty` — **Stage 6's defining column**. 010 shipped the stage minus the
    dispatched quantity, which made it read like a chase log; it is a **dispatch record** for metres sent
    back out. That is also why it carries **its own** `dying_house_name`: a reissue often goes to a
    *different* house than the PO named. NULLABLE (pre-022 rows have nothing safe to backfill —
    `remaining_meters` is the outstanding balance, not the dispatched qty).
  - `023` = **incremental QC** (see the QC section below). New `qc_checklist` columns
    `actual_design_no`/`actual_color`/`actual_qty`/`remark`; `overall_status` vocabulary migrated
    Passed→`OKAY & WAITING FOR REMAINING QTY`, Failed→`RETURN & REISSUE` (CHECK re-added); `(lot_no,
    overall_status)` index; and a **replaced `submit_qc_inspection` RPC** that writes **one row per
    disposition** (up to two per design) so the status-filtered sums are well-defined.
  - `024` = **warehouse status vocabulary** (Stage 5): `warehouse_log.remark`, and `status` migrated
    from the meaningless free-text default `'Stored'` to `Waiting For More Qty` | `Final Qty Received`.
    ⚠️ Both are **LOT-level STATE, not a per-row snapshot** — every warehouse row for a lot carries the
    same one and they flip together, so the RPC **re-stamps the whole lot**, not just the rows it just
    inserted (a row written three weeks ago must stop saying "waiting" when today's inspection closes
    the lot). Contrast the `remaining_qty` snapshots in 020/021, which are never recomputed.
  - `025` = **the reissue-cycle discriminator** (Stages 6–9). Stages 7/8/9 are *field-identical* to
    3/4/5 — receive, inspect, store, run again for the rejected metres — so they **share the same
    tables** with a `cycle text` column (`'original'` | `'reissue'`), **never duplicated tables**. Added
    to `fabric_receipts`, `qc_checklist`, `warehouse_log`, `reissue_return` (default `'original'`) and
    `dyeing_followups` (default **`'reissue'`** — that table *is* Stage 6).
    ⚠️ **`cycle` is a PARALLEL DIMENSION, not a phase.** Both tracks run at once on the same lot (in
    production a lot's whole reissue cycle finished in ten minutes while the original lot still had
    750 m awaiting QC a month later). **Every lot-level rollup — `remainingForQC`, received-to-date,
    warehouse status — must be keyed on `(lot, cycle)`.** Keyed on lot alone it mixes the two tracks and
    closes lots early. Stage 8 can itself return `RETURN & REISSUE`, so the loop can repeat; the
    discriminator records *which track* a row belongs to, not how many times round.
  - `026` = **`shipments.delivery_mode`** (`'warehouse'` | `'direct_to_dyer'`, NOT NULL DEFAULT
    `'warehouse'`) — how the grey physically reached the dyeing house. **Path A**: the vendor delivers
    to our dock; rolls + the physical program card are dispatched onward together. **Path B**: the
    vendor drop-ships the raw rolls **straight to the dyeing house**, so the receipt is logged
    *virtually* off their invoice and only the card is couriered (the dyer matches it to the rolls by
    the vendor design number). It lives on the **lot**, not `grey_instalments`, because every
    downstream screen reads lots and never sees instalments (020); one instalment ships one way, so
    the app stamps all its lots alike. The default is a correct backfill, not a placeholder — every
    pre-026 lot did arrive at our dock.
- **Roles:** `super_admin` > `admin` > `operator`. Only a super admin can change roles or
  deactivate users (Settings → Team Management → `/api/team/[id]`); super admin rows are
  immutable from the app. `is_admin()` includes super admins. Deactivated users are bounced
  by `(app)/layout.tsx` → `/api/auth/deactivated` (signs out, login shows a notice).
- **RLS:** authenticated read/insert/update; **admin-only delete**. Profiles: operators read
  only their own row; admins+ read all (the Team list relies on this).
- **Business IDs** are app-generated text: `UID-{ts}` (PO `unique_id`), `GRI-{ts}` (grey instalment),
  `SHID-{ts}` / `SHID-{ts}{i}{rand}` (shipment = **lot**), `PG-{n}` (program — sequential max+1,
  retried on a unique collision), `DF-{ts}` (dyeing dispatch), `FAB-{ts}{i}{rand}` (fabric receipt),
  `QC-{ts}{i}{rand}` (qc `check_id`), `STORE-{ts}{i}{rand}` (warehouse `store_id`),
  `RE-{ts}{i}{rand}` (reissue `reissue_id`), `FR-{ts}` (final receipt). The multi-row ids carry a
  **per-row suffix** because one submit inserts many rows into those `UNIQUE` columns. Lots are born
  on the **shipment** (`lot_no` is set there, not on the PO) and are **typed by the operator**
  (e.g. "Lot 24"), never generated.
- **Snapshot vs. state — get this right.** `grey_instalments.remaining_qty` and
  `fabric_receipts.remaining_qty` are **write-once snapshots** of what was outstanding immediately
  *before* that entry: never recompute them on read. `warehouse_log.status` is the opposite — **lot-level
  state** that the QC RPC re-stamps across the whole lot every time.
- **Rollups are per `(lot, cycle)`** — see migration 025. A rollup keyed on `lot_no` alone silently
  mixes the original and reissue tracks and closes lots early.
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

## Current state (2026-07-28)

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
- **Purchase Orders** (`/purchase-orders`) — **smart adaptive form** driven by a **two-level**
  source picker matching the "Diff PO to generate" chart: **4 sources** (Order PO / Checks /
  Direct purchase / China imported), and **Order PO** then asks for its branch — Grey fabric or
  Client fabric finishing (required once Order PO is picked). ⚠️ **Client fabric is a branch of
  Order PO, not a 5th source** — never render the paths as flat peers. The DB column
  `sourcing_path` still stores the *branch* level (the same 5 values) so grey vs. client-fabric
  stays distinguishable downstream; `SOURCE_OF_PATH`/`sourceOf()` in `lib/po-meta.ts` map a
  stored path back up to its source and `sourcingLabel()` renders "Order PO · Grey fabric".
  Then: shared core + a path-specific panel (sample-approval toggle → `sampling_status`; checks adds cad/handloom refs;
  direct→`direct_subtype`; imported badge), an Internal Quality Name datalist (required), and a
  **colour breakdown** editor (auto A/B/C, live "X of Y m allocated") saved to `po_color_variants`
  via the service-role variants route. Table adds Quality Name + Sourcing + a colour-count chip;
  **optimistic create/edit**; track modal shows metadata + variants + received-vs-ordered;
  admin-only delete with full-fidelity Undo (variants snapshot + replay).
- **Grey House Follow Up** (`/grey-receipts`) — Stage 2. Sent vs. pending per PO, overdue-first
  (planned grey arrival = `order_date + delivery_days`). The manage-shipments modal logs a **grey
  instalment** (migration 020) and **splits it into one or more lots** on the spot — the operator
  **types each `lot_no`** ("Lot 24") line-by-line; lots are born here. `remaining_qty` is snapshotted
  at write time. Over-shipment is allowed (pending goes negative) but warns via toast.
  **Finished-goods POs are excluded** from this screen (`isFinishedGoodsPo`) — they never see grey.
  The receipt also records **which of the two logistical routes** it took (026, `lib/delivery-mode.ts`):
  *To our warehouse* (Path A) or *Direct to dyeing house* (Path B — a **virtual receipt** off the
  vendor's invoice; the fabric never touches our floor, but the lot is just as real and enters the
  dyeing queue immediately). Drop-shipped lots carry a "Direct to dyer" pill on the lot list, the
  dyeing queue, and the dispatch modal. The toggle **resets to warehouse** after each save — a sticky
  drop-ship flag would silently mis-stamp the next ordinary receipt.
- **Dyeing Queue** (`/dyeing-queue`) — one lot-row per shipment, status Pending / Created Program,
  segmented filter. **Program creation lives here** (primary action "New program"), plus admin delete
  and a PO-info popup. Hides a lot only once it is **fully closed** — `fetchClosedQcLotNos`, *not*
  "has any QC row" (QC is incremental; see 023). Planned dyeing-return date counts **working days**
  via `lib/working-days.ts` + the `holidays` master.
- **Program Cards** (`/program-cards`) — ⚠️ **a route, not a nav item** — it was folded into the
  Dyeing Queue (`nav.ts` has no entry for it; the Dyeing Queue blurb says "create & view program
  cards here"). Groups `program_cards` by Program ID + Lot No, enriched with parent PO; row→detail
  popup lists the colour cuttings (`program_card_designs`, per-colour **View cutting** link). The
  New-Program form: lot picker → **pre-fills colour rows from the PO's `po_color_variants`** (colour +
  metres, Total meters defaults to their sum), **per-colour cutting** upload with the **white-swatch
  rule** (a colour named "White" needs no cutting; all others require one), a live meterage indicator,
  auto `PG-{n}`, optimistic create. `design_no` = the auto A/B/C code (feeds QC).
- **Dyeing House Follow Up (Sent)** (`/dyeing-follow-up`) — the **dispatch record**, not a chase log.
  **Both legs live in this one table**, split by `cycle` (025), and the modal has a segmented switch:
  - **"Send for dyeing"** (`cycle='original'`) — the **first** trip out, at **LOT grain**: one lot
    travels with its one physical program card. Population = lots that have a program card with
    metres still to send (`total_meters − Σ sent on this leg`). On a **drop-shipped** lot (026) the
    modal says so: the rolls are already at the dyer, courier the card only.
  - **"Send back reissue"** (`cycle='reissue'`) — QC-rejected metres going back, at **PO grain**:
    one parcel bundles several rejected lots, so the row records **no `lot_no`**, and the house is
    editable because a reissue often goes to a *different* house than the PO named.
  ⚠️ **The grains differ on purpose — don't merge the two pickers.** An earlier revision had the
  "lots with a program card" set feeding the *reissue* picker; that was wrong (such lots have nothing
  to send *back*) and it was correctly removed. It is the right set for the first leg.
  ⚠️ **Any sum over this table must filter by `cycle`.** `dispatchedByPo` counts reissue rows only —
  without the filter a first-trip dispatch cancels QC-rejected metres and the PO silently vanishes
  from the reissue picker. Legacy rows predate `cycle` and default to `'reissue'`; treat missing the
  same way. `sent_qty` is what the return reconciles against; `remaining_meters` is the pre-entry
  snapshot — a different number.
- **QC Inspection** (`/qc-inspection`) — Stage 4, **incremental** (migration 023). 3-step wizard:
  ① pick program + received qty + tick designs, recording the **actual design/colour/qty found**
  (which may differ from the program card) → ② disposition → ③ the four checks, or
  failed-qty/reason/return-&-reissue. The two statuses are verbatim business strings in
  `lib/qc-status.ts`: **`OKAY & WAITING FOR REMAINING QTY`** and **`RETURN & REISSUE`** — never
  Pass/Fail. On submit the RPC writes **one row per disposition** (up to two per design): good metres →
  `qc_checklist` + `warehouse_log`; reissue metres → `qc_checklist` + `reissue_return`; then it
  **re-stamps the whole lot's warehouse status** (024). A lot leaves the Dyeing Queue / Program Cards
  only when **nothing remains for QC** — one lot routinely has several inspection rows over weeks.
- **Reissue & Return** (`/reissue-return`) — every `reissue_return` row enriched with parent PO
  (via `original_po_unique_id`); row→detail popup with two sections (Original PO info; Failure &
  reissue details, Failed Qty = `reissue_qty`). Actions: Assign New Lot No (→ `Reissue Pending`)
  or Mark as Returned (→ `Returned`, clears `new_lot_no`); a Returned row is terminal in the UI.
- **Warehouse** (`/warehouse`) — Stage 5, the live **Ready-Goods ledger**: `warehouse_log` (written by
  QC on a good disposition) grouped one row per lot, joined to the parent PO for the **Quality Name** +
  rate and to `program_cards` for Program ID + dyeing house (warehouse_log has no `program_uid`).
  Status is **lot-level** — `Waiting For More Qty` → `Final Qty Received` (024, `lib/warehouse-status.ts`;
  `lotStatus()` returns final only when *every* row says so). CountUp metric cards, clickable rows →
  detail (general info + Stored-designs table with colour, + Failed/reissued table). Read-only.
  Realtime: `warehouse_log → ["warehouse_all"]` (needs the table in the `supabase_realtime` publication).
- **Fabric Receipts** (`/fabric-receipts`) — Stage 3 (and Stage 7 for the reissue leg, told apart by
  `cycle`). Dyed fabric received back **per design** (migrations 011 + 021). Modal (key `n`/palette):
  picks a lot → loads its `program_card_designs` (default received = programmed metre) → enter received
  per design with a live **received-vs-programmed** indicator (matched/short/over), plus `color`, the
  next follow-up date and the lot-level `remaining_qty` **snapshot**. Dyed fabric comes back
  **piecemeal**, so a lot has many receipt rows over time. One row per design, optimistic multi-row
  insert, realtime, search/sort.
- **Final Receipts** (`/final-receipts`) — records the **final confirmed good qty per lot, closing it**
  (migration 009 `final_receipts`). "Record final receipt" modal (key `n`/palette): picks a QC-passed lot
  (in `warehouse_log`, minus already-closed lots), defaults Final metres to the lot's stored metres, +
  status (Closed/Partial/On Hold)/remark/date. Table (Lot, PO, Quality Name, Final metres, Date, status
  pill) with instant search/sort, **optimistic insert**, realtime (`final_receipts`), smart empty state.
- **Settings** (`/settings`) — **Team Management** (members table name/email/role/status/joined; super
  admins change roles operator↔admin and deactivate/reactivate via `/api/team/[id]`) and **Master
  Lists** (migration 012: Vendors / Quality Names / Dyeing Houses / Processes — add, edit, deactivate;
  admin-gated delete via `/api/masters/[table]/[id]`; inactive entries drop out of form dropdowns).

### The 9-stage process model (`lib/sla.ts`)

The pipeline is numbered, and **Stages 7/8/9 are field-identical to 3/4/5** — the same receive →
inspect → store, run again for the rejected metres. They share tables, discriminated by `cycle`:

| Stage | What | Where | SLA (working days) |
| --- | --- | --- | --- |
| 1 | PO generation | `purchase_orders` (+ `po_color_variants`) | — |
| 2 | Grey sent / lot birth | `grey_instalments` → `shipments` | 1, from PO order date |
| — | Program card | `program_cards` + `program_card_designs` | — |
| 3 | Dyeing receipt | `fabric_receipts` (`cycle='original'`) | 4, from program-card date |
| 4 | QC | `qc_checklist` (`cycle='original'`) | 5, from actual-received date |
| 5 | Warehouse | `warehouse_log` (`cycle='original'`) | 1, from QC actual date |
| 6 | Reissue sent (dispatch) | `dyeing_followups` (`cycle='reissue'`) | 7, from QC reissue date |
| 7 | Reissue receipt | `fabric_receipts` (`cycle='reissue'`) | 7, from dispatch date |
| 8 | Reissue QC | `qc_checklist` (`cycle='reissue'`) | 5, from actual-received date |
| 9 | Reissue warehouse | `warehouse_log` (`cycle='reissue'`) | 1, from reissue QC date |

⚠️ **SLA clocks run in WORKING days** — `lib/working-days.ts`. **The mill works six days: Sunday is
the only weekly non-working day, Saturday counts.** Treating Saturday as a weekend shortens every
planned date by ~a day a week and marks work overdue before it is. The `holidays` master (001) is
also skipped. All arithmetic is UTC `YYYY-MM-DD` so it stays hydration-stable.

**`lib/sla.ts` is wired in as an OVERLAY, on the Dashboard's "SLA standing" panel** — per stage:
how many units are open past target, the worst delay, and how many finished late.
⚠️ **It does not drive any planned date or overdue flag.** Those still come from each record's own
`delivery_days` (what was negotiated for *that* order); the SLA target is the internal standard for
the stage. **Two independent yardsticks — do not merge them.** The derivation is
`deriveDashboard` → `stageStanding()`, keyed per `(lot, cycle)` for stages 3/4/5 vs 7/8/9 so a lot's
reissue track can't make its original track look on time.

ℹ️ Calendar vs working days is **deliberately mixed** and was reviewed 2026-07-28: the **grey**
planned date (`order_date + delivery_days`) stays in **calendar** days because a vendor lead time
("45 days delivery") is quoted that way; the **dyeing return** and **all SLA clocks** run in
**working** days. Don't "fix" the grey path to working days — it moves every planned date later and
silently un-flags overdue rows.

### Shared lib modules worth knowing before you write anything

- `columns.ts` — **single source of truth for the PostgREST column lists.** These strings used to be
  copy-pasted into every Server Component, so a column-adding migration silently missed most of them
  (015's `checks_method`/`weaving_design` never reached first render). **Add new columns here, once.**
  ⚠️ The Dashboard page kept its own private copies until 2026-07-28 and they had gone stale — no
  `cycle`, no QC `actual_*`, no 024 remarks — so every cycle-aware derivation there silently read
  `undefined`. It now imports from here. **Never reintroduce a local column list.**
- `use-grid-nav.ts` — spreadsheet keyboard nav for the repeating data grids (PO colours, program
  designs, fabric-receipt lines): **Enter moves down the column, Shift+Enter up, Tab across**
  (native), and Enter on the last row appends one where the grid grows. ⚠️ Intercepting Enter is
  **required**, not a nicety: these grids sit inside a `<form>`, so without it Enter submits the form
  from a half-filled row.
- `qc-status.ts` / `warehouse-status.ts` / `cycle.ts` — the verbatim business status strings and the
  cycle discriminator. Import the constants; never re-type the literals.
- `working-days.ts` (six-day week) and `sla.ts` (stage targets).
- `optimistic.ts` — the standard optimistic-list helpers (`optimisticPatch`/`optimisticRemove` +
  rollback) used by every mutation.
- `format.ts` (en-IN numbers, `addCalendarDays`), `fuzzy.ts` (command-palette scoring),
  `use-esc-close.ts`, `use-debounced-value.ts`.

✅ **Migration status: 001–026 are ALL applied** (verified against the live DB 2026-07-28 — all 11
expected columns from 019–026 present, `grey_instalments` exists, and `submit_qc_inspection` is the
**025** cycle-aware version). Continue the sequence from **027**. Note when re-verifying: 023, 024 and
025 each `create or replace` that RPC, so probing its body for `'Waiting For More Qty'` does **not**
distinguish 024 from 025 — key off `v_cycle`, which only 025 declares. And remember every
column-adding migration needs
`NOTIFY pgrst, 'reload schema';` afterwards. If a screen errors on a column a migration file defines,
dump `information_schema.columns` and check the live DB before blaming the cache.

**Pending tech debt:** the Tailwind migration (above); and the README is stale (it claims the backend
isn't connected — it is).

## Working norms

- The user reviews migrations by count and runs them manually — when schema changes, write
  the next sequential migration file **and** give them the SQL to paste, don't assume it's applied.
- New screens: reuse `nav.ts` for routing/title/blurb, the `lib/<domain>.ts` data pattern,
  the route-handler pattern for privileged writes, and the design-system styles. Keep `npm run build` green.
