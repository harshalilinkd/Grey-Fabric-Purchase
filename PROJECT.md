# Grey FMS — Project Guide

**Grey Fabric Management System** for **LD Silk Mills**. An internal web app that tracks
the full life of a fabric order — from raising a purchase order with a vendor, through
receiving grey cloth, dyeing, quality control, reissue of rejects, and finally into
warehouse stock.

This document explains **what the system does, how the data flows end-to-end, every
screen, the database, and the architecture.**

*Last updated 2026-07-28 (migrations 001–025).*

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

**Two things about a lot are easy to get wrong, and both are load-bearing:**

1. **A lot is not finished by its first inspection.** QC is *incremental* — a lot is
   inspected in pieces over days or weeks, and only closes when nothing remains.
2. **A lot can be in two tracks at once.** The rejected metres run a whole second loop
   (dispatch → receive → QC → store) *concurrently* with the original metres. In
   production, one lot's entire reissue cycle finished in ten minutes while the same lot
   still had 750 m awaiting its first QC a month later.

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

## 3. Where an order comes from — the 4 sources

Before a PO exists, fabric is sourced one of **four** ways. This mirrors the "Diff PO to
generate" flow chart exactly, and the PO form is a **two-level** picker: choose a source,
and Order PO then asks which of its two routes it came through.

| # | Source | Route / sub-choice | Sampling? |
| --- | --- | --- | --- |
| 1 | **Order PO** | **Grey fabric** — raw grey sample → dyeing house → digital print → *print approved* → raise PO | Yes |
| 1 | **Order PO** | **Client fabric finishing** — the client supplies their own cloth; we give a sample, then print & process it | Yes |
| 2 | **Checks** | **CAD** → direct order · or **Handloom sample** → weaving & design → order / decline | Yes |
| 3 | **Direct purchase** | **New cloth** (ready goods) or **old/used cloth** (Milano) — bought on the spot | None |
| 4 | **China imported** | Container imports (Crispo) — funds wired, PO raised immediately | None |

> ⚠️ **Client fabric is a *branch* of Order PO, not a fifth source.** Never render the
> routes as five flat peers.

**How it's stored.** `purchase_orders.sourcing_path` keeps the *branch* level — `grey`,
`client_fabric`, `checks_weaves`, `direct_purchase`, `imported` — so grey vs. client-fabric
stays distinguishable downstream (it decides whether a PO ever appears on the grey-house
screen). `src/lib/po-meta.ts` owns the mapping between the two levels: `SOURCES` (the 4),
`ORDER_PO_BRANCHES` (the 2), `SOURCE_OF_PATH` / `sourceOf()` to map a stored path back up,
and `sourcingLabel()` to render "Order PO · Grey fabric".

**Finished goods vs. dyed goods.** Direct purchase and imported are **finished goods**:
they skip the grey house and dyeing entirely and are received + QC'd straight into stock
(`isFinishedGoodsPath`). Everything else runs the full dye pipeline. **QC is mandatory on
every path** — only QC-passed metres reach the warehouse.

**Sampling itself is out of scope.** The system starts at PO generation; the pre-PO
sample/approval module was built and then deliberately removed. Do not rebuild it.

---

## 4. The end-to-end flow — 9 stages

```
 STAGE 1        STAGE 2            (program card)      STAGE 3           STAGE 4        STAGE 5
 Purchase  ──►  Grey House    ──►  Dyeing Queue   ──►  Fabric      ──►   QC       ──►   Warehouse
 Order          Follow Up          + Program Card      Receipts          Inspection     (ready goods)
 (vendor         (instalment →      (dyeing instr.,    (dyed cloth       (incremental)
  order)          LOTS are born)     colours, PDF)      back, piecemeal)      │
                                                                              │ RETURN & REISSUE
                                                                              ▼
                          STAGE 9        STAGE 8        STAGE 7           STAGE 6
                          Warehouse ◄──  Reissue   ◄──  Reissue     ◄──   Dyeing House
                          (reissue)      QC             Receipt           Follow Up (Sent)
                                                                          = dispatch out
```

**Stages 7/8/9 are field-identical to 3/4/5.** They are the same screens and the same
tables, run again for the rejected metres, told apart by a **`cycle`** column
(`'original'` | `'reissue'`) — never by duplicated tables. Stage 8 can itself return
`RETURN & REISSUE`, so the loop can run more than once.

### Stage 1 — Purchase Order (`/purchase-orders`)

A PO is *"a quantity of metres at a rate, from **one** vendor, for **one** dyeing house."*

- The operator picks the **source** (§3), then fills the shared core: vendor, process,
  quality, order/PO numbers, order date, delivery days, **quantity (m)** and **rate (₹/m)**.
- **The dyeing house is set here** (migration 019), not a stage later — required on the
  dyeing sources, hidden on finished goods.
- **Quality Name is required at PO time** (Innova, London, Fiber, Urban Linen…). This is
  the anti-"mystery box" forcing function: the fabric is named before it arrives, so
  downstream conversations aren't about an unnamed bale. The Warehouse ledger displays
  this exact name.
- **Selling merchant no** and **vendor design no** are also required.
- **Colour breakdown is required.** Vendors bill in bulk (e.g. 3,200 m under design 3100),
  so the operator untangles it into exact metres per colour (A: 400 m, B: 400 m …) into
  `po_color_variants`. A live indicator shows "X of Y m allocated".
- On save the app sets `unique_id = "UID-{timestamp}"` and the DB computes
  **`amount = quantity × rate`** as a **generated column** — never written by the app, so
  the financial ledger can't drift.
- The PO is the root every later record links back to (by the text `po_unique_id`).

### Stage 2 — Grey House Follow Up (`/grey-receipts`)

Per PO: **Sent vs Pending** (`ordered − Σ sent`) and a **planned grey arrival**
(`order_date + delivery_days`), overdue rows floated to the top.

- Grey arrives in **instalments**, and **one instalment can split into several lots**.
  "Manage shipments" records the instalment (`grey_instalments`, `GRI-{ts}`) and its lot
  lines in one event.
- **This is where a LOT is born.** `lot_no` lives on `shipments`, is set here (never on the
  PO), and is **typed by the operator** ("Lot 24") — it is not system-generated.
- **Over-shipment is allowed** so the loading dock keeps moving (pending goes negative),
  but the UI raises a non-blocking toast warning.
- Finished-goods POs never appear here.

#### The two logistical routes (`delivery_mode`, migration 026)

Grey reaches the dyeing house one of two ways, chosen on the receipt:

| | **Path A — To our warehouse** | **Path B — Direct to dyeing house** |
| --- | --- | --- |
| Physical | Vendor delivers rolls to our dock; we unload and stack them | To save freight, the vendor **drop-ships the raw rolls straight to the dyer** — they never touch our floor |
| In-app | Ordinary receipt | **Virtual receipt**, logged off the vendor's shipping invoice |
| The lot | Born here | Born here too — just as real, and active in the dyeing queue immediately |
| Dispatch | Rolls **and** the physical program card travel out together | **Only the program card** is couriered; the dyer matches it to the drop-shipped rolls by the vendor design number |

Path B lots carry a **"Direct to dyer"** badge on the lot list, the dyeing queue and the
dispatch modal — because there is nothing to pick and pack, and nobody should go hunting
for rolls that were never here. The toggle resets to Path A after every save, so a sticky
flag can't mis-stamp the next ordinary receipt.

### Program card (`/dyeing-queue`, detail at `/program-cards`)

The dyeing instruction for one lot: `program_uid = "PG-{n}"` (sequential), dyeing house,
program date, total metres, delivery days, base colour, and a **per-colour design
breakdown** (`program_card_designs`: design no, colour, metres) pre-filled from the PO's
colour variants.

- Physically, **cuttings** (small squares of the target colour) are pinned to the left of
  the paper card with the requested metres handwritten beside each.
- **White needs no cutting** — an industry shorthand the form enforces: a colour named
  "White" is exempt, every other colour requires an upload.
- The scan/photo goes to **Supabase Storage** (`program-cuttings`), with the public URL on
  the card / design row.
- Creating the program flips the lot from **Pending** to **Created Program** in the queue.

### Stage 3 — Fabric Receipts (`/fabric-receipts`)

Dyed, printed and processed fabric arriving back — **per design**, because dyeing houses
return an order **piecemeal** over days or weeks.

Each row carries the design, colour, `programmed_meters` ("should receive"), the metres
actually received, a **`remaining_qty` snapshot** of the lot's outstanding balance
immediately before the entry, and the next follow-up date. A live indicator flags each
line matched / short / over.

### Stage 4 — QC Inspection (`/qc-inspection`)

A 3-step wizard against a returned program card. **It is not a binary pass/fail.**

- Step 1 picks the program, the received qty and the designs to inspect, recording **what
  was actually found** — `actual_design_no`, `actual_color`, `actual_qty` — which can
  differ from what the program card said.
- Step 2 picks the disposition. The two statuses are the business's own words:
  **`OKAY & WAITING FOR REMAINING QTY`** and **`RETURN & REISSUE`**. The first name is
  load-bearing: the metres are good **and** the lot is still open.
- Step 3 runs the four checks (meter qty, colour, strength, fabric quality), or captures
  failed qty / reason / return-&-reissue.
- On submit an **atomic RPC** (`submit_qc_inspection`) writes **one row per disposition** —
  up to two per design: good metres → `qc_checklist` + `warehouse_log`; reissue metres →
  `qc_checklist` + `reissue_return`. It then **re-stamps the whole lot's warehouse status**.
- A lot leaves the Dyeing Queue and Program Cards **only when it is fully closed**
  (`fetchClosedQcLotNos`) — a partially inspected lot stays in the queue.

### Stage 5 — Warehouse (`/warehouse`)

The **ready-goods ledger** of QC-passed fabric (`warehouse_log`, `STORE-{ts}{rand}`),
grouped one row per lot and joined back to its PO (Quality Name, rate) and program.

Status is **lot-level, not per-row**: `Waiting For More Qty` → `Final Qty Received`
(terminal). Every row for a lot carries the same value and they flip together the moment
the lot's last metres are accounted for. Read-only; updates live via Realtime.

### Dispatch to the dyeing house (`/dyeing-follow-up`)

**Both trips out live in this one screen**, split by `cycle`. A segmented switch at the top
of the modal picks the leg, and the log labels every row.

| | **Send for dyeing** (`original`) | **Send back reissue** (`reissue`, Stage 6) |
| --- | --- | --- |
| What | The **first** trip out, after the program card exists | QC-rejected metres going back for repair |
| Grain | **Per LOT** — one lot travels with its one physical card | **Per PO** — one parcel bundles rejected metres from several lots, so no `lot_no` is recorded |
| Outstanding | `program card total − Σ already sent on this leg` | `Σ QC-rejected across its lots − Σ already dispatched` |
| Dyeing house | Defaults to the program card's | Editable — a reissue often goes to a *different* house than the PO named |

Both capture **`sent_qty`** (the figure the return is reconciled against — a dispatch
without it can't be closed out), the pre-entry outstanding snapshot, the next follow-up
date and a remark.

> ⚠️ **The two grains are deliberate — don't merge the pickers**, and **filter every sum
> over this table by `cycle`**. Without the filter a first-trip dispatch cancels out
> QC-rejected metres and the PO silently disappears from the reissue picker.

### Stages 7–9 — the reissue loop

Reissue receipt, reissue QC and reissue warehousing reuse `fabric_receipts`,
`qc_checklist` and `warehouse_log` with `cycle = 'reissue'`. **Every lot-level rollup must
be computed per `(lot, cycle)`** — keyed on the lot alone it mixes the two tracks and
closes lots early.

### Supporting screens

- **Reissue & Return** (`/reissue-return`) — every failed quantity (`reissue_return`,
  `RE-{ts}{rand}`) enriched with its parent PO. An admin can **Assign a new lot no**
  (→ *Reissue Pending*) or **Mark as Returned** (→ *Returned*, terminal).
- **Final Receipts** (`/final-receipts`) — records the **final confirmed good quantity per
  lot, closing it** (`FR-{ts}`): final metres + status (Closed / Partial / On Hold).
- **Dashboard** (`/`) — a live command center derived from all of the above: clickable KPI
  cards (open POs + ₹ on order, grey received this month, lots in dyeing, pending QC,
  warehouse stock, reissue pending), a **lot-stage funnel**, **follow-ups due**, and a
  **live activity feed**. Every formula mirrors its source screen so the numbers reconcile.
- **Settings** (`/settings`) — Team Management, Master Lists, Profile (see §6–7).

---

## 5. SLA clocks — and the six-day week

Each stage has a target in **working days** (`src/lib/sla.ts`):

| Stage | Target | Clock starts |
| --- | --- | --- |
| 2 Grey sent | 1 day | PO order date |
| 3 Dyeing receipt | 4 days | Program card date |
| 4 QC | 5 days | Dyeing actual-received date |
| 5 Warehouse | 1 day | QC actual date |
| 6 Reissue sent | 7 days | QC reissue date |
| 7 Reissue receipt | 7 days | Reissue dispatch date |
| 8 Reissue QC | 5 days | Reissue actual-received date |
| 9 Reissue warehouse | 1 day | Reissue QC date |

> ⚠️ **The mill works six days. Sunday is the only weekly non-working day — Saturday
> counts.** All date maths goes through `src/lib/working-days.ts`, which also skips the
> `holidays` master list. Calendar-day arithmetic would shorten every planned date by
> roughly a day a week and flag work overdue before it actually is.

`timeDelay()` leaves the field **blank** when a stage isn't late, so a populated cell
always means a real delay.

These targets surface on the Dashboard's **SLA standing** panel — per stage: how many units
are open past target, the worst delay in working days, and how many finished late.

> ⚠️ **The SLA is an overlay, not the planned date.** Every planned date and overdue flag in
> the app still comes from that record's own `delivery_days` — what was negotiated for that
> particular order. The SLA target is the internal standard for the stage. They are two
> independent yardsticks and are deliberately not merged.
>
> Relatedly, calendar vs working days is mixed **on purpose**: the grey arrival date uses
> **calendar** days (a vendor quotes "45 days delivery" that way), while the dyeing return
> and every SLA clock use **working** days.

---

## 6. Data model

All business tables carry self-maintaining `created_at` / `updated_at`, an `archived` flag
(§8), and have **Row-Level Security** enabled.

**Identity & admin**
- `profiles` — one row per Supabase auth user. `role` (super_admin / admin / operator),
  `email`, `active`, `department`. Auto-created on signup by a trigger.

**Master lists** (dropdown sources; read by all, written by admins; each has an `active` flag)
- `vendors`, `dyeing_houses`, `qualities`, `processes`.
- `holidays` — non-working days, used by the working-day maths.

**Procurement**
- `purchase_orders` — `unique_id` ("UID-…"), vendor_name, process, quality, dates,
  delivery_days, quantity, rate, **`amount` (generated = quantity × rate)**,
  `dying_house_name`, and the sourcing metadata: `sourcing_path`, `quality_name`,
  `selling_merchant_no`, `vendor_design_no`, `sampling_status`, `cad_ref`, `handloom_ref`,
  `direct_subtype`, `checks_method`, `weaving_design`.
- `po_color_variants` — the required per-colour split of the PO's bulk (code, colour, metres).
- `grey_instalments` — one row per grey delivery instalment: `instalment_id` ("GRI-…"),
  sent qty, next follow-up date, remark, **`remaining_qty` snapshot**.
- `shipments` — **one row per LOT**: `shipment_id` ("SHID-…"), `po_unique_id`,
  shipment_date, sent_quantity, **`lot_no` (lots are born here)**, optional `grey_instalment`.

**Dyeing**
- `program_cards` — `program_uid` ("PG-n"), lot_no, po_unique_id, program_date,
  `dying_house_name` *(note: "dying", matched to the real schema)*, total_meters, color,
  color_cutting_attached, total_color_cutting, delivery_days, pdf_url.
- `program_card_designs` — many per card: design_no, color, meter, cutting_url.
- `dyeing_followups` — **Stage 6 dispatch**: `followup_id` ("DF-…"), po_unique_id,
  `dying_house_name`, **`sent_qty`**, remaining_meters, next_followup_date, remark,
  `cycle` (defaults `'reissue'`).
- `fabric_receipts` — dyed fabric back, per design: `receipt_id` ("FAB-…"), lot_no,
  design_no, color, programmed_meters, received_meters, **`remaining_qty` snapshot**,
  next_followup_date, received_date, remark, `cycle`.

**Quality & stock**
- `qc_checklist` — `check_id` ("QC-…"), program_uid, lot_no, design_no, the four yes/no
  checks, `overall_status` (**`OKAY & WAITING FOR REMAINING QTY`** | **`RETURN & REISSUE`**),
  passed_qty, failed_qty, `actual_design_no`, `actual_color`, `actual_qty`, remark, `cycle`.
- `reissue_return` — `reissue_id` ("RE-…"), original PO/lot/design, reissue_qty, reason,
  new_lot_no, status (Pending Assignment / Reissue Pending / Returned), `cycle`.
- `warehouse_log` — `store_id` ("STORE-…"), po_unique_id, lot_no, design_no, color,
  passed_qty, stored_date, remark, `status` (**`Waiting For More Qty`** | **`Final Qty
  Received`**), `cycle`.
- `final_receipts` — `receipt_id` ("FR-…"), lot_no, po_unique_id, final_qty, status, date.

**Links are by value, not always foreign keys.** PO↔shipment / PO↔program use the text
`po_unique_id`; QC, reissue, and warehouse rows store **snapshot** `lot_no` / `design_no`
strings. This intentionally mirrors the real business: **deleting a PO does not delete its
shipments or programs.**

**Storage:** the `program-cuttings` public bucket holds colour-cutting PDFs/photos; the
public URL is saved on `program_card_designs.cutting_url` / `program_cards.pdf_url`.

**RPC:** `submit_qc_inspection(payload jsonb)` performs all the QC writes atomically in one
transaction — the per-disposition `qc_checklist` rows, the `warehouse_log` rows, the
`reissue_return` rows, and the lot-wide warehouse-status re-stamp.

### Snapshot vs. state — the one modelling rule to keep straight

| Column | Kind | Rule |
| --- | --- | --- |
| `grey_instalments.remaining_qty` | **Snapshot** | What was outstanding immediately *before* this entry. Written once, **never recomputed on read.** |
| `fabric_receipts.remaining_qty` | **Snapshot** | Same. |
| `warehouse_log.status` | **State** | Lot-level. The RPC **re-stamps every row of the lot**, because a row written three weeks ago must stop saying "waiting" when today's inspection closes the lot. |

---

## 7. Roles & security

**Hierarchy:** `super_admin` > `admin` > `operator`.

| Action | Who |
| --- | --- |
| Read / add / edit workflow data (POs, shipments, programs, QC, …) | any logged-in user |
| **Delete** workflow data | **admins** (+ super admins) — via route handlers |
| Read master lists | any logged-in user |
| Add / edit / delete master lists | **admins** |
| Archive / restore a PO and its graph | **super admins only** |
| Manage team (add/edit/delete users, roles, activate/deactivate) | **super admins only** |

- RLS enforces "authenticated read/insert/update, admin-only delete" on workflow tables.
  **Direct client-side deletes are disabled** — every deletion goes through a route handler
  that checks `profiles.role` server-side and returns a real 403 instead of a silent
  0-row delete.
- The `enforce_profile_role_change` trigger guarantees only a super admin can change a
  role/active flag, super-admin rows can't be touched from the app, and nobody can
  self-promote to super admin.
- Deactivating a user signs them out and blocks the app until reactivated.

**Route handlers:** `/api/purchase-orders/[id]` (delete), `/api/purchase-orders/[id]/variants`
(service-role replace-all of the colour split), `/api/shipments/[id]`,
`/api/program-cards/[id]`, `/api/masters/[table]/[id]`, `/api/team` + `/api/team/[id]`,
`/api/auth/deactivated`.

---

## 8. Archive (migration 016)

A **reversible, super-admin-only** archive of a PO *and everything linked to it*. It is an
`archived` flag on every screen-listed table, **hidden at the RLS layer** — archived rows
simply stop being returned by every existing query, so no screen code had to change. One
atomic function flips the flag across the whole PO graph; a restore flips it back.
Service-role paths bypass the hide so a super admin can still see and restore.

---

## 9. Conventions worth knowing

- **Business IDs are app-generated text:** `UID-{ts}` (PO), `GRI-{ts}` (grey instalment),
  `SHID-{ts}` (shipment/lot), `PG-{n}` (program, sequential), `DF-{ts}` (dispatch),
  `FAB-/QC-/STORE-/RE-{ts}{i}{rand}` (the random suffix lets one submit insert many rows
  into `UNIQUE` id columns), `FR-{ts}` (final receipt).
- **`amount` is a generated column** (quantity × rate) — never write it; it's read-only.
- **Lots are born on the shipment**, not the PO, and their numbers are **typed by hand**.
- **Column lists live in `src/lib/columns.ts`.** They used to be copy-pasted into every
  Server Component, so a column-adding migration silently missed most of them. Add new
  columns there, once.
- **Status strings are constants**, spelled exactly as the business writes them:
  `src/lib/qc-status.ts`, `src/lib/warehouse-status.ts`, `src/lib/cycle.ts`. Import them;
  never retype the literals.
- **Spelling is intentional:** `dying_house_name` ("dying"), and `program_card_designs.color`
  (US) vs `qc_checklist.colour_check` (UK) are mixed to match the real schema. When unsure,
  grep the migration.
- After any column-adding migration, **reload the PostgREST schema cache**
  (`NOTIFY pgrst, 'reload schema';`) or inserts can briefly fail with
  "Could not find the '…' column in the schema cache".

---

## 10. Migrations (run in order, manually in the Supabase SQL Editor)

Named with a zero-padded counter (audited by count, **not** timestamps).

| # | File | Adds |
| --- | --- | --- |
| 001 | `init_master_tables_and_rls` | profiles, vendors, dyeing_houses, qualities, holidays, RLS, `is_admin()`, signup trigger |
| 002 | `workflow_tables` | purchase_orders, shipments, program_cards, program_card_designs, qc_checklist, reissue_return, warehouse_log |
| 003 | `team_management` | super_admin role, profiles.email/active, `is_super_admin()`, role-change guard |
| 004 | `team_department` | profiles.department |
| 005 | `program_cuttings_storage` | `program-cuttings` Storage bucket + policies |
| 006 | `qc_inspection_rpc` | `submit_qc_inspection()` atomic RPC |
| 007 | `purchase_order_sourcing` | PO sourcing path + quality metadata + `po_color_variants` |
| 008 | `program_design_cutting` | `program_card_designs.cutting_url` |
| 009 | `final_receipts` | final_receipts table |
| 010 | `dyeing_followups` | dyeing_followups table |
| 011 | `fabric_receipts` | fabric_receipts table |
| 012 | `master_list_management` | `active` flag on masters + new `processes` master |
| 013 | `warehouse_color` | `warehouse_log.color` (finished goods have no program to derive it from) |
| 014 | `program_card_color` | `program_cards.color` (base shade) |
| 015 | `po_checks_method` | `checks_method` (cad/handloom) + `weaving_design` on the PO |
| 016 | `archive` | reversible super-admin archive of a PO's whole graph, hidden via RLS |
| 017 | `sample_approvals` | *(superseded — pre-PO sampling)* |
| 018 | `drop_sample_approvals` | **optional**, destructive — drops the dormant sampling table |
| 019 | `po_dyeing_house` | `purchase_orders.dying_house_name` — one PO → one dyeing house |
| 020 | `grey_instalments` | `grey_instalments` table + `shipments.grey_instalment` (one instalment → many lots) |
| 021 | `fabric_receipt_followup` | `fabric_receipts.color` / `next_followup_date` / `remaining_qty` |
| 022 | `dyeing_followup_sent_qty` | `dyeing_followups.sent_qty` — Stage 6's defining column |
| 023 | `qc_incremental` | QC status vocabulary, the "actual" observation fields, one-row-per-disposition RPC |
| 024 | `warehouse_status` | `Waiting For More Qty` / `Final Qty Received` + `warehouse_log.remark` |
| 025 | `reissue_cycle` | the `cycle` discriminator on the five shared tables (Stages 6–9) |
| 026 | `shipment_delivery_mode` | `shipments.delivery_mode` — Path A (to our dock) vs Path B (drop-shipped to the dyer) |

**Status: 001–026 are all applied** (verified against the live database on 2026-07-28).
The next migration is **027**. Migrations are applied by hand in the SQL Editor and audited
by count, so always continue the sequence and never renumber an existing file.

---

## 11. Local setup

```bash
npm install
npm run dev      # http://localhost:3000  (development; recompiles per route)
npm run build    # production build (must stay green — typecheck runs here)
npm run start    # serve the production build (much faster than dev)
npx tsc --noEmit # typecheck only — safe while the dev server is running
```

> ⚠️ **Never run `npm run build` while the dev server is running.** They share `.next/`, so
> the build clobbers the dev server's chunk graph: pages still render but every client
> chunk 404s, React never hydrates, and every button silently dies. Stop the dev server,
> delete `.next/`, then build.

**Environment (`.env.local`, gitignored):**

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...        # browser-safe (RLS protects data)
SUPABASE_SERVICE_KEY=sb_secret_...                      # server-only; user create/delete
```

**First-run:** run the migrations in order in the SQL Editor → disable "Confirm email" in
Supabase Auth (internal tool) → create the first user via Dashboard → Authentication →
Add user (auto-confirm) → promote to super admin:

```sql
update public.profiles set role = 'super_admin'
where id = (select id from auth.users where email = 'you@example.com');
```

> ⚠ Never create auth users with raw `insert into auth.users` — it leaves token columns
> NULL and breaks sign-in ("Database error querying schema"). Use the Dashboard "Add user".

---

## 12. Screen reference

| Nav group | Screen | Route | Purpose |
| --- | --- | --- | --- |
| — | Dashboard | `/` | Live KPIs, funnel, follow-ups, activity |
| Procurement | Purchase Orders | `/purchase-orders` | Create/track POs (4-source adaptive form) |
| Procurement | Grey House Follow Up | `/grey-receipts` | Sent vs pending per PO; log instalments → lots |
| Dyeing | Dyeing Queue | `/dyeing-queue` | Lots pending/created program; **create program cards here** |
| Dyeing | Dyeing House Follow Up (Sent) | `/dyeing-follow-up` | Stage 6 — dispatch rejected metres back out |
| Dyeing | Fabric Receipts | `/fabric-receipts` | Dyed fabric received back per design |
| Quality & Stock | QC Inspection | `/qc-inspection` | Incremental QC → warehouse and/or reissue |
| Quality & Stock | Reissue & Return | `/reissue-return` | Reissue failed lots / mark returned |
| Quality & Stock | Final Receipts | `/final-receipts` | Final good qty; close the lot |
| Quality & Stock | Warehouse | `/warehouse` | QC-passed stock ledger |
| Admin | Settings | `/settings` | Team, master lists, profile |

`/program-cards` exists as a route (detail + list) but is **not** in the sidebar — program
creation was folded into the Dyeing Queue. `src/lib/nav.ts` is the single source of truth
for the sidebar; pages read their own title/blurb from it.

---

## 13. Project structure

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
    experience/RealtimeProvider.tsx  # Supabase Realtime → query-key invalidation
    ui/                              # Icon, Toast, CountUp, shared widgets
    <domain>/                        # per-screen client components + modals
  lib/
    supabase/{client,server,middleware,admin}.ts   # browser / server / mw / service-role
    nav.ts                           # single source of truth for the sidebar
    columns.ts                       # single source of truth for PostgREST column lists
    types.ts                         # shared row/form types
    po-meta.ts                       # the 4 sources, Order-PO branches, flow strings
    qc-status.ts / warehouse-status.ts / cycle.ts   # verbatim business status constants
    working-days.ts / sla.ts         # six-day-week date maths + stage SLA targets
    optimistic.ts                    # optimistic-list helpers + rollback
    format.ts / fuzzy.ts             # en-IN formatting, command-palette scoring
    <domain>.ts                      # typed fetch*/create*/update* per screen
  styles/{tokens,shell,components}.css            # design tokens + component styles
supabase/migrations/                 # 001 … 025 (run in order, by hand)
```

---

*Internal tool for LD Silk Mills. Built with Next.js + Supabase. The unit that flows through
everything is the **lot**: born at grey receipt, programmed for dyeing, inspected
incrementally, and finally warehoused — with its rejected metres running the same loop
again in parallel.*
