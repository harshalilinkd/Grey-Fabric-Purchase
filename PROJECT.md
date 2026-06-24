# Grey FMS — Project Guide

**Grey Fabric Management System** for **LD Silk Mills**. An internal web app that tracks
the full life of a grey-fabric order — from raising a purchase order with a vendor,
through receiving grey cloth, dyeing, quality control, reissue of rejects, and finally
into warehouse stock.

This document explains **what the system does, how the data flows end-to-end, every
screen, the database, and the architecture.**

---

## 1. What problem it solves

LD Silk Mills buys **grey (undyed) fabric** from vendors, gets it **dyed/printed** at
dyeing houses, **quality-checks** the returns, and stocks the good fabric. Grey FMS
replaces spreadsheets with one connected system so every stage is recorded, linked, and
visible in real time.

The unit that flows through the whole system is the **lot** — a physical batch of fabric.
A lot is *born* when grey cloth is received against a PO, and it travels: received →
programmed for dyeing → at the dyeing house → received back → QC'd → warehoused (or
reissued if it fails).

---

## 2. Tech stack & architecture

| Layer | Choice |
| --- | --- |
| Framework | **Next.js 15 (App Router) + TypeScript** (strict) |
| Backend / DB | **Supabase** (Postgres + Auth + Storage + Realtime) |
| Auth/session | **`@supabase/ssr`** — httpOnly cookie sessions, **middleware-protected routes** |
| Data fetching | **Server Components** load initial data → **Client Components + TanStack Query** for interactivity |
| Privileged writes | **Route handlers** (`src/app/api/...`) — admin/super-admin only actions |
| File uploads | **Supabase Storage** (`program-cuttings` bucket) for program-card colour-cutting PDFs |
| Live updates | **Supabase Realtime** (dashboard, warehouse, lists) |
| Styling | Plain CSS design tokens — clean, professional, Sora font, single cobalt accent (a Tailwind migration is the one remaining tech-debt item) |

**Request lifecycle:** `middleware.ts` refreshes the Supabase session on every request and
redirects unauthenticated users to `/login` (and authenticated users away from `/login`).
The `(app)` route group's layout server-fetches the user + profile and renders the shell;
deactivated users are bounced to `/api/auth/deactivated` (signed out).

**Read vs. write paths:**
- **Reads / normal writes** (insert, update) happen via the browser Supabase client, gated
  by Row-Level Security (any logged-in user can read/add/edit workflow data).
- **Deletes and privileged actions** go through **route handlers** that verify the caller's
  role server-side and return a clear 403 if not allowed (RLS also enforces this as a
  second layer).
- **Creating/deleting login accounts** uses a **service-role admin client**
  (`src/lib/supabase/admin.ts`, server-only) because the anon key cannot manage auth users.

---

## 3. The end-to-end flow (the heart of the system)

```
  Purchase Order ──► Grey House Follow Up ──► Dyeing Queue ──► Program Cards ──┐
   (vendor order)     (log shipments =          (lots awaiting    (dyeing instr.,│
                       LOTS are born)            a program)        colours/PDF)   │
                                                                                  ▼
  Warehouse ◄── Final Receipts ◄── QC Inspection ◄── Fabric Receipts ◄── Dyeing Follow Up
   (good stock)   (close the lot)    (pass→stock /      (dyed cloth         (chase the
                                      fail→reissue)      received back)      dyeing house)
                                          │
                                          └──► Reissue & Return  (failed qty → new lot or returned)
```

**Stage by stage:**

1. **Purchase Order** — A PO is raised against a vendor: vendor, process, quality, order
   date, order/PO numbers, delivery days, **quantity (m)** and **rate (₹/m)**. A **sourcing
   path** (Grey / Client fabric / Checks & weaves / Direct purchase / Imported) adapts a
   small extra panel. On save the app sets `unique_id = "UID-{timestamp}"` and the DB
   auto-computes **`amount = quantity × rate`** (a generated column). The PO is the root
   every later record links back to.

2. **Grey House Follow Up** (`/grey-receipts`) — Per PO, it shows **Sent vs Pending**
   (`Pending = ordered − Σ shipment quantities`) and a **Planned Date** (`order_date +
   delivery_days`). "Manage shipments" logs each delivery from the vendor. **Logging a
   shipment is how a LOT enters the system** — `lot_no` is set here (not on the PO). Each
   shipment gets `shipment_id = "SHID-{timestamp}"`. Over-shipment is allowed (pending can
   go negative) with a non-blocking warning.

3. **Dyeing Queue** (`/dyeing-queue`) — Derived live: **every shipment is one lot row**.
   Status is **"Program Created"** if its `lot_no` appears in `program_cards`, else
   **"Pending Program"**. Once a lot is quality-checked (its `lot_no` is in `qc_checklist`)
   it **disappears** from this queue.

4. **Program Cards** (`/program-cards`) — A dyeing program for a lot: `program_uid =
   "PG-{n}"` (sequential), dyeing house, total meters, delivery days, and a **per-colour
   design breakdown** (`program_card_designs`: design no, colour, meter). This is where a
   lot's **colours are split** (moved here from the PO). Each colour can have a **cutting
   PDF/photo** uploaded to Supabase Storage (white swatches need no cutting). Creating a
   program flips the lot to "Program Created" in the Dyeing Queue.

5. **Dyeing Follow Up** (`/dyeing-follow-up`) — A log of follow-ups for lots sitting at the
   dyeing house (`dyeing_followups`): remaining meters, next follow-up date, remark.
   **Overdue** follow-ups (next date ≤ today) are flagged and floated to the top.

6. **Fabric Receipts** (`/fabric-receipts`) — Records dyed fabric **received back per
   design** (`fabric_receipts`): programmed vs received meters, with short/over flagging.
   One submission inserts a row per design.

7. **QC Inspection** (`/qc-inspection`) — A wizard: pick a program + received qty, tick the
   designs to inspect, mark **Pass/Fail**, run the four checks (meter qty, colour, strength,
   fabric quality). On submit, **per design**: always a `qc_checklist` row; a **warehouse**
   row when passed qty > 0; a **reissue** row on fail. Each `check_id = "QC-{ts}{rand}"`.
   It prefers an **atomic RPC** (`submit_qc_inspection`) so all the writes happen in one
   transaction. Submitting **removes the lot from the Dyeing Queue and Program Cards.**

8. **Reissue & Return** (`/reissue-return`) — Failed fabric (`reissue_return`,
   `reissue_id = "RE-{ts}{rand}"`): a super/admin can **Assign a new lot** (status →
   *Reissue Pending*, the cloth re-enters dyeing as a fresh lot) or **Mark as Returned**
   (status → *Returned*, terminal).

9. **Final Receipts** (`/final-receipts`) — Records the **final confirmed good quantity per
   lot, closing it** (`final_receipts`, `receipt_id = "FR-{ts}"`): final meters + status
   (Closed / Partial / On Hold).

10. **Warehouse** (`/warehouse`) — The **ready-goods ledger** of QC-passed fabric
    (`warehouse_log`, `store_id = "STORE-{ts}"`), grouped one row per lot, joined back to
    its PO (quality, rate) and program. Read-only; updates live via Realtime as QC passes.

11. **Dashboard** (`/`) — A **live command center** derived from all of the above: clickable
    KPI cards (open POs + ₹ on order, grey received this month, lots in dyeing, pending QC,
    warehouse stock, reissue pending), a **lot-stage funnel**, **follow-ups due**, and a
    **live activity feed**.

12. **Settings** (`/settings`) — **Team Management**, **Master Lists**, and **Profile**
    (see §5–6).

---

## 4. Screen reference

| Nav group | Screen | Route | Purpose |
| --- | --- | --- | --- |
| Overview | Dashboard | `/` | Live KPIs, funnel, follow-ups, activity |
| Procurement | Purchase Orders | `/purchase-orders` | Create/track POs (adaptive sourcing path) |
| Procurement | Grey House Follow Up | `/grey-receipts` | Sent vs pending per PO; log shipments (creates lots) |
| Dyeing | Dyeing Queue | `/dyeing-queue` | Lots pending/created program (hides QC'd) |
| Dyeing | Program Cards | `/program-cards` | Dyeing programs, design colours, cutting PDFs |
| Dyeing | Dyeing Follow Up | `/dyeing-follow-up` | Chase dyeing houses; overdue flagging |
| Dyeing | Fabric Receipts | `/fabric-receipts` | Dyed fabric received back per design |
| Quality & Stock | QC Inspection | `/qc-inspection` | Pass/fail wizard → warehouse or reissue |
| Quality & Stock | Reissue & Return | `/reissue-return` | Reissue failed lots / mark returned |
| Quality & Stock | Final Receipts | `/final-receipts` | Final good qty; close the lot |
| Quality & Stock | Warehouse | `/warehouse` | QC-passed stock ledger |
| Admin | Settings | `/settings` | Team, master lists, profile |

---

## 5. Data model

All business tables carry self-maintaining `created_at` / `updated_at` and have **Row-Level
Security** enabled.

**Identity & admin**
- `profiles` — one row per Supabase auth user. `role` (super_admin / admin / operator),
  `email`, `active`, `department`. Auto-created on signup by a trigger.

**Master lists** (dropdown sources; read by all, written by admins)
- `vendors`, `dyeing_houses`, `qualities`, `processes` — each with an `active` flag.
- `holidays` — non-working days (for planned-date math).

**Procurement**
- `purchase_orders` — `unique_id` ("UID-…"), vendor_name, process, quality, dates,
  delivery_days, quantity, rate, **`amount` (generated = quantity × rate)**, plus sourcing
  metadata (sourcing_path, sampling, etc.).
- `po_color_variants` — optional colour split per PO (admin-only delete).
- `shipments` — `shipment_id` ("SHID-…"), `po_unique_id` → PO, shipment_date, sent_quantity,
  **`lot_no` (lots are born here)**.

**Dyeing**
- `program_cards` — `program_uid` ("PG-n"), lot_no, po_unique_id, program_date,
  `dying_house_name` *(note: "dying", matched to the real schema)*, total_meters,
  color_cutting_attached, delivery_days, pdf_url.
- `program_card_designs` — many per card: design_no, color, meter, cutting_url.
- `dyeing_followups` — follow-up log: lot_no, remaining meters, next_followup_date.
- `fabric_receipts` — dyed fabric received back, per design: programmed vs received meters.

**Quality & stock**
- `qc_checklist` — `check_id` ("QC-…"), program_uid, lot_no, design_no, the four yes/no
  checks, `overall_status` (Passed/Failed), passed_qty, failed_qty.
- `reissue_return` — `reissue_id` ("RE-…"), original PO/lot/design, reissue_qty, reason,
  new_lot_no, status (Pending Assignment / Reissue Pending / Returned).
- `final_receipts` — `receipt_id` ("FR-…"), lot_no, po_unique_id, final_qty, status, date.
- `warehouse_log` — `store_id` ("STORE-…"), po_unique_id, lot_no, design_no, passed_qty,
  stored_date, status (default "Stored").

**Links are by value, not always foreign keys.** PO↔shipment / PO↔program use the text
`po_unique_id`; QC, reissue, and warehouse rows store **snapshot** `lot_no` / `design_no`
strings. This intentionally mirrors the real app: **deleting a PO does not delete its
shipments or programs.**

**Storage:** the `program-cuttings` public bucket holds colour-cutting PDFs/photos; the
public URL is saved on `program_card_designs.cutting_url` / `program_cards.pdf_url`.

**RPC:** `submit_qc_inspection(payload jsonb)` performs the QC writes (qc_checklist +
conditional warehouse_log + reissue_return) atomically in one transaction.

---

## 6. Roles & security

**Hierarchy:** `super_admin` > `admin` > `operator`.

| Action | Who |
| --- | --- |
| Read / add / edit workflow data (POs, shipments, programs, QC, …) | any logged-in user |
| **Delete** workflow data | **admins** (+ super admins) — via route handlers |
| Read master lists | any logged-in user |
| Add / edit / delete master lists | **admins** |
| Manage team (add/edit/delete users, roles, activate/deactivate) | **super admins only** |

- RLS enforces "authenticated read/insert/update, admin-only delete" on workflow tables.
- The `enforce_profile_role_change` trigger guarantees only a super admin can change a
  role/active flag, super-admin rows can't be touched from the app, and nobody can
  self-promote to super admin.
- Deactivating a user signs them out and blocks the app until reactivated.

---

## 7. Conventions worth knowing

- **Business IDs are app-generated text:** `UID-{ts}` (PO), `SHID-{ts}` (shipment),
  `PG-{n}` (program, sequential), `QC-/STORE-/RE-{ts}{random}` (the random suffix lets one
  QC submit insert many rows into `UNIQUE` id columns), `FR-/DF-/FAB-…` (final/dyeing-
  followup/fabric receipts).
- **`amount` is a generated column** (quantity × rate) — never write it; it's read-only.
- **Lots are born on the shipment**, not the PO. `lot_no` lives on `shipments`.
- **Spelling is intentional:** `dying_house_name` ("dying"), and `program_card_designs.color`
  (US) vs `qc_checklist.colour_check` (UK) are mixed to match the real schema. When unsure,
  grep the migration.
- After any column-adding migration, **reload the PostgREST schema cache**
  (`NOTIFY pgrst, 'reload schema';`) or inserts can briefly fail with
  "Could not find the '…' column in the schema cache".

---

## 8. Migrations (run in order, manually in the Supabase SQL Editor)

Named with a zero-padded counter (audited by count, **not** timestamps):

| # | File | Adds |
| --- | --- | --- |
| 001 | `init_master_tables_and_rls` | profiles, vendors, dyeing_houses, qualities, holidays, RLS, `is_admin()`, signup trigger |
| 002 | `workflow_tables` | purchase_orders, shipments, program_cards, program_card_designs, qc_checklist, reissue_return, warehouse_log |
| 003 | `team_management` | super_admin role, profiles.email/active, `is_super_admin()`, role-change guard |
| 004 | `team_department` | profiles.department |
| 005 | `program_cuttings_storage` | `program-cuttings` Storage bucket + policies |
| 006 | `qc_inspection_rpc` | `submit_qc_inspection()` atomic RPC |
| 007 | `purchase_order_sourcing` | PO sourcing path + metadata + `po_color_variants` |
| 008 | `program_design_cutting` | program_card_designs.cutting_url |
| 009 | `final_receipts` | final_receipts table |
| 010 | `dyeing_followups` | dyeing_followups table |
| 011 | `fabric_receipts` | fabric_receipts table |
| 012 | `master_list_management` | `active` flag on masters + `processes` table |

---

## 9. Local setup

```bash
npm install
npm run dev      # http://localhost:3000  (development; recompiles per route)
npm run build    # production build (must stay green — typecheck runs here)
npm run start    # serve the production build (much faster than dev)
```

**Environment (`.env.local`, gitignored):**

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...        # browser-safe (RLS protects data)
SUPABASE_SERVICE_KEY=sb_secret_...                      # server-only; user create/delete
```

**First-run:** run migrations 001–012 in the SQL Editor → disable "Confirm email" in
Supabase Auth (internal tool) → create the first user via Dashboard → Authentication →
Add user (auto-confirm) → promote to super admin:

```sql
update public.profiles set role = 'super_admin'
where id = (select id from auth.users where email = 'you@example.com');
```

> ⚠ Never create auth users with raw `insert into auth.users` — it leaves token columns
> NULL and breaks sign-in ("Database error querying schema"). Use the Dashboard "Add user".

---

## 10. Project structure

```
src/
  middleware.ts                      # session refresh + route protection
  app/
    layout.tsx                       # fonts, theme bootstrap, providers
    login/page.tsx                   # standalone email/password login
    (app)/                           # route group for all authed screens
      layout.tsx                     # server-fetch user/profile → AppShell
      page.tsx                       # Dashboard
      <screen>/page.tsx              # one page per nav item (Server Component fetch)
    api/<domain>/...                 # privileged route handlers (deletes, team, masters)
  components/
    shell/                           # AppShell, Sidebar, TopBar
    providers/Providers.tsx          # TanStack Query + ToastProvider
    theme/ThemeProvider.tsx          # light/dark
    ui/                              # Icon, Toast, shared widgets
    <domain>/                        # per-screen client components + modals
  lib/
    supabase/{client,server,middleware,admin}.ts   # browser / server / mw / service-role
    nav.ts                           # single source of truth for the sidebar
    types.ts                         # shared row/form types
    format.ts                        # en-IN number/date formatting, date math
    <domain>.ts                      # typed fetch*/create*/update* per screen
  styles/{tokens,shell,components}.css            # design tokens + component styles
supabase/migrations/                 # 001 … 012 (run in order, by hand)
```

---

*Internal tool for LD Silk Mills. Built with Next.js + Supabase. The unit that flows through
everything is the **lot**: born at grey receipt, programmed for dyeing, inspected, and
finally warehoused or reissued.*
