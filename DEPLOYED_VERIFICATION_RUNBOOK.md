# ReliefGrid — Supabase Migration and Deployed Verification Runbook

**Covers:** Phase A (triage), Phase 2 (needs and partial fulfilment), Phase 3 (capacity truth), Phase 4 (portal trust) and Phase 5 (guardrails) — five phases, six migration files, one database.

**Written for:** whoever runs it next. Part 0 assumes you have not worked on these phases and do not know the history — it gives you the state of the database today, the exact order to run things, what each file does, and what "correct" looks like after each step. Sections 1–45 are the detailed per-phase reference behind it.

**Purpose:** verify Phases A, 2, 3, 4 and 5 against the deployed Public Portal, Coordinator Dashboard, Render API and Supabase database. No local server or local frontend is needed.

**Scope:** this runbook starts from a deployed stack whose database has **not yet been migrated**, and it is written to be run in one sitting: one backup, six files, one deploy, then the checks. Part 0 is the spine — the order, what each file does, and what to verify after it. Sections 1–45 hold the per-phase detail behind it. It replaces the earlier Phase A–only document.

**Not a substitute for:** the local checks in `server/tests/` (`npm run test:allocation` covers the allocation contract against any disposable PostgreSQL; `npm run test:phase3`, `npm run test:phase4` and `npm run test:phase5` cover the later phases). Those prove the database and API contract; this runbook proves the deployed wiring, permissions and UI behaviour.

---

## 0. Start here — where the database stands, and the order to fix it

**Read this part first, then run it top to bottom.** Sections 1–45 below hold the detail for each phase; Part 0 is the spine: current state, the order, one section per migration file, what to verify after each, what breaks if something is skipped, and what to do when a symptom appears.

### 0.1 Where Supabase actually stands today

**No migration has been applied to the hosted Supabase database.** Phase A, Phase 2 and Phase 3 are merged to `main` and deployed; Phase 4 and Phase 5 are still in review. The database is still on the original `schema.sql` baseline, so **the deployed stack is currently ahead of its database** — and until the last two phases merge, the deployed code is also behind what this runbook describes.

That single fact explains every current oddity. Expect to see these until the migrations land — none of them is a code bug:

| What you see now | What it is |
| --- | --- |
| `503` with "The database is missing a required migration. Apply database/migrations in order, then retry." on `GET /api/aid-requests/queue`, `GET /api/supplies/inventory`, `GET /api/supplies/allocations` | Those routes read columns, tables and views that migrations 2, 3 and 4 create. The API answers `503` on purpose rather than a generic `500` — see `describeDatabaseError` in `server/lib/databaseErrors.js`. |
| Check-in answers `500` `"Check-in failed"` | Phase 3's check-in route compares the function's result to the string `'ok'`. On an unmigrated database `checkin_to_shelter()` still returns `BOOLEAN`, which never equals `'ok'`, so every check-in falls through to the generic error. Full explanation in section 21. |
| The Coordinator Dashboard's **People sheltered** and **Open spaces** cards read `0` while real people are checked in | Phase 3's board filters its totals on `is_active`, which the unmigrated `Shelter_Live_Status` view does not have — so every shelter is excluded from the totals. Rows in the table still render. Section 21. |
| The portal's **Which disaster is this related to?** lists all 15 seeded disasters back to 1990 | Every `Disaster_Events` row still has `end_date = NULL`, and `GET /api/events` filters on it. This is stale data, not a filter bug — step 0.6.3 fixes it. |
| The portal shows every shelter, including closed ones | `is_active` is missing from the unmigrated view. The portal deliberately degrades to showing everything rather than hiding everything. |

Two more things you will see today are **code, not database**, and both are fixed by the Phase 5 build — there is nothing to run for them:

- **A page refresh signs the coordinator out.** The dashboard kept its token only in memory. Phase 5 restores the session from the stored token on load, re-reading the role from the database (#76).
- **Any signed-in account can check people in anywhere.** Check-in, check-out, shelter edits and allocation were authenticated but not authorised. Phase 5 makes them staff-only and limits a coordinator to the shelters assigned to them (#77, #78).

Two consequences worth stating plainly:

1. **Do not spend time debugging these.** Apply the migrations, then re-check.
2. **Until then, the deployed behaviour is misleading, not merely incomplete.** The capacity cards reading `0` and check-in silently failing are worse than an outage because they look like real numbers. Treat the app as untrustworthy until section 0.4's list is complete.

### 0.2 Access you need before starting

| Access | Used for |
| --- | --- |
| Supabase project → SQL Editor, and the ability to take a backup | Every step below |
| Render → service `reliefgrid-api` → Environment and Events | Step 0.4.2 (does the API point at *this* project?) and confirming deploys |
| Vercel → `relief-grid-publicportal` and `relief-grid-coordinator-dashboard` | Confirming builds and `VITE_API_URL` |
| A staff login with role `Admin` or `ShelterCoordinator` | The coordinator checks (A1–A7, P1–P11, C1–C16, T1–T12, G1–G16) |
| A **second** staff account, plus a `Volunteer` account | Phase 5's role and ownership checks (G2–G6). A coordinator may only act on their own shelters, so a second coordinator is how the refusal is proven — one account cannot demonstrate it alone |
| Render → **Environment**, only if you intend to set `CORS_ORIGINS` | Optional. Leaving it unset is a supported configuration (section 37) |
| This repository | The six migration files, and the cleanup queries |

A `Volunteer` login is useful too, for the permission checks that expect `403` and blanked contact details — and after Phase 5 it becomes the account that proves check-in and allocation are staff-only.

**Never paste `DATABASE_URL`, `JWT_SECRET`, a password, a bcrypt hash or a token into chat, a screenshot, an issue or a commit.** See section 3.

### 0.3 How to run SQL in the Supabase editor without making things worse

- **One file per query.** The Supabase editor is not `psql -v ON_ERROR_STOP=1`: it does not stop the file at the first failing statement, and if you paste two files into one query and the second fails, the first has already been applied. You then have a half-applied pair to reason about, which is the state this runbook spends the most effort avoiding.
- **"Success. No rows returned." is the correct result for a DDL file.** It does not mean nothing happened.
- **Read the `NOTICE`s.** Migrations 4, 5 and 6 raise them (the count of `Shelters.status` values normalised to `inactive`, and the count of `Volunteer_Tasks.status` values normalised to `pending`). They are informational, but they tell you what changed beyond the DDL. A block that normalises nothing prints no `NOTICE` at all, so silence is a pass, not a missing step.
- **Verify after every file** with that migration's query in 0.5, before starting the next one.
- **If a file reports an error, stop.** Do not run the next file over a half-migrated schema. Read the error, and if it is not something you can explain, restore the backup (section 13) and start that file again.
- **Take the backup before anything else** (step 0.4.1). There are no down migrations (section 13); the backup is the rollback.

### 0.4 The order — do not reorder, and do not skip the verification rows

| # | Action | Where | Expected result |
| --- | --- | --- | --- |
| 1 | Take a backup | Supabase → Database → Backups | A restorable snapshot exists |
| 2 | Confirm the API points at *this* Supabase project | Render → `reliefgrid-api` → Environment (section 5) | Host matches the project reference |
| 3 | Run the one-shot probe | SQL Editor, query in 0.5.0 | Six `false`s today |
| 4 | Fill `Supply_Categories` if it is empty | Section 6 | 4 rows |
| 5 | Apply migration **1** (or skip it — it is redundant, 0.5.1) | 0.5.1 | Success |
| 6 | Apply migration **2** | 0.5.2 | Success — **run once** |
| 7 | Apply migration **3** | 0.5.3 | Success; backfill check returns `0` |
| 8 | Apply migration **4** | 0.5.4 | Success; check-in returns a reason |
| 9 | Apply migration **5** | 0.5.5 | Success; the function returns 9 columns |
| 10 | Apply migration **6** | 0.5.6 | Success; the capacity log gains an actor, both capacity functions gain a third parameter |
| 11 | Close the historical disaster events | Section 33, repeated in 0.6.3 | `open_events` = `2` |
| 12 | Confirm the deployed code is current | Render Events + both Vercel projects (section 9) | New commit `Live` / `Ready` |
| 13 | Phase A functional checks **A1–A7** | Section 10 | All pass |
| 14 | Phase 2 functional checks **P1–P11** | Section 11 | All pass |
| 15 | Phase 3 functional checks **C1–C16** | Section 22 | All pass |
| 16 | Phase 4 functional checks **T1–T12** | Section 32 | All pass |
| 17 | Phase 5 functional checks **G1–G16** | Section 42 | All pass |
| 18 | Cleanup | Sections 12, 23, 33, 43 | Synthetic rows gone, stock restored, capacity-log rows accounted for |

**Three dependencies to know about before you plan the day:**

- **Phase 4's checks (T1–T12) need Phase 4's code deployed.** That means the Phase 4 pull request merged and the Public Portal rebuilt from `main`. Against the current deployment you will not see the new phone-field behaviour, the event selector, the closed-shelter filter or the corrected space labels, no matter what the database says. Phases A, 2 and 3 are already on `main`.
- **Phase 3's checks (C1–C16) need the Coordinator Dashboard build from `main`**, which already contains Phase 3.
- **Phase 5's checks (G1–G16) need the Phase 5 code deployed** — the API and the Coordinator Dashboard. G7–G11 are browser-console or `curl` checks that need nothing from the database at all, which makes them the quickest proof that the build landed; G12–G16 are the five that read or write the new schema.

**Phase 5 also changes two Phase 3 checks.** Once the Phase 5 API is live, a `Volunteer` can no longer check people in, and a coordinator may only act on their own shelters — section 22's C1 and C12 say so explicitly, and section 42's G2–G6 are what assert the new rule. If you run the Phase 3 checks before Phase 5 merges, expect the older, looser behaviour; that is why 0.4 puts the deploy before the checks.

Steps 5–10 are what makes the app work again; steps 13–17 are what proves it. If you only have time for part of this, do 1–11.

### 0.5 One section per migration file

#### 0.5.0 The one-shot probe (step 3)

Read-only. This tells you which of the six migrations are already applied and whether the two data prerequisites are met. Every function check is written so it cannot error on a database where the object does not exist yet.

```sql
SELECT
  -- 1: the shortage view gained supply_id
  COALESCE((SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'critical_supply_shortage'
               AND column_name = 'supply_id') = 1, false)                    AS m1_shortage_supply_id,

  -- 2: Phase A triage columns on Aid_Requests
  COALESCE((SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'aid_requests'
               AND column_name = 'reviewed_priority') = 1, false)            AS m2_triage_columns,

  -- 3: Phase 2 needs table plus the allocation-to-need link
  COALESCE(to_regclass('public.request_needs') IS NOT NULL
     AND (SELECT count(*) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'allocations'
             AND column_name = 'need_id') = 1, false)                       AS m3_request_needs,

  -- 4: Phase 3 — the view flag and check-in returning a reason, not a boolean.
  --    Matched by name, not by argument list: migration 6 replaces the
  --    two-argument function with a three-argument one whose third parameter
  --    has a default, so a to_regprocedure() lookup for (int,int) stops
  --    resolving once Phase 5 has landed.
  COALESCE((SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'shelter_live_status'
               AND column_name = 'is_active') = 1, false)                    AS m4_view_is_active,
  COALESCE((SELECT bool_or(pg_get_function_result(p.oid) = 'character varying')
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'checkin_to_shelter'), false) AS m4_checkin_returns_reason,

  -- 5: Phase 4 — the nearest-shelter function's nine-column shape
  COALESCE((SELECT pg_get_function_result(p.oid) LIKE '%has_space%'
              FROM pg_proc p
             WHERE p.oid = to_regprocedure('find_nearest_shelters(numeric,numeric,int,int)')), false) AS m5_nearest_has_space,

  -- 6: Phase 5 — the capacity log's actor, the actor-taking functions, and the
  --    coordinator on the live-status view
  COALESCE((SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'shelter_capacity_log'
               AND column_name IN ('changed_by','change_type')) = 2, false) AS m6_capacity_log_actor,
  COALESCE((SELECT bool_or(pg_get_function_arguments(p.oid) LIKE '%p_changed_by%')
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'checkin_to_shelter'), false) AS m6_checkin_takes_actor,
  COALESCE((SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'shelter_live_status'
               AND column_name = 'coordinator_id') = 1, false)               AS m6_view_coordinator,

  -- Data prerequisites, not migration state
  (SELECT count(*) FROM Supply_Categories)                               AS supply_categories,
  (SELECT count(*) FROM Supplies)                                        AS supply_items,
  (SELECT count(*) FROM Disaster_Events
    WHERE end_date IS NULL OR end_date >= CURRENT_DATE)                  AS open_events;
```

Expected **today** on the hosted database: `m2_triage_columns`, `m3_request_needs`, `m4_view_is_active`, `m4_checkin_returns_reason`, `m5_nearest_has_space`, `m6_capacity_log_actor`, `m6_checkin_takes_actor` and `m6_view_coordinator` all `false` — and **`m1_shortage_supply_id` probably `true` already**, because the baseline `schema.sql` this database was built from already gave that view a `supply_id`. So that column cannot tell you whether migration 1 was applied, and it does not matter (0.5.1). `supply_categories` = `4` (any non-zero value is fine), `supply_items` = `5`, `open_events` = `15`. Both the "before" and "after" values here were reproduced against a database rebuilt from the pre-Phase-A `schema.sql`.

After completing steps 5–11: all nine `m*` columns are `true` and `open_events` = `2`.

One note on `m4_checkin_returns_reason`, because it is the one check that had to be rewritten: it counts `character varying`, not a specific signature. Migration 4 makes the function return a `VARCHAR`; migration 6 rebuilds it with a third, defaulted parameter. A probe that looked the function up by its two-argument signature would report `false` again after migration 6, on a database where every migration had in fact been applied — reproduced on PostgreSQL 16. Matching by name keeps one answer for the whole train.

If a column reports `NULL` rather than `false`, the `COALESCE` was removed or edited — treat `NULL` as "unknown" and investigate before running a migration.

#### 0.5.1 Migration 1 — `20261016_add_supply_id_to_shortage_view.sql` (6 lines)

| | |
| --- | --- |
| Phase | Pre-Phase A |
| What it does | Recreates the `Critical_Supply_Shortage` view with `supply_id`, so the coordinator's allocation action can identify the stock row instead of guessing from item name and shelter. |
| Touches | One view. No tables, no data. |
| Already the case? | **Probably yes.** The pre-Phase-A `schema.sql` this database was created from already defines `Critical_Supply_Shortage` with `supply_id` — verified by loading that file and running the 0.5.0 probe, which reported `m1_shortage_supply_id = true` before any migration had run. |
| Idempotent | **Only before migration 3.** Once migration 3 has replaced the view with its wider column list, re-running this file fails with *cannot drop columns from view* — `CREATE OR REPLACE VIEW` can add columns, it cannot remove them. That failure is harmless and changes nothing (verified: the view keeps migration 3's nine columns), but it is noise you do not need. |
| Safe to skip? | **Yes, always.** Migration 3 recreates the same view with `supply_id` plus `unit` and category columns, so this file is a narrower earlier version of the same thing — and the baseline already produces that view, so on this database it is redundant whether or not it has been run before. Running it first is fine; running it again afterwards is not. |
| Verify | `SELECT string_agg(attname, ',' ORDER BY attname) FROM pg_attribute WHERE attrelid = 'critical_supply_shortage'::regclass AND attnum > 0;` — the list must contain `supply_id`. |
| If it fails | *cannot drop columns from view* means migration 3 has already run — expected, harmless, skip this file. Any other error, such as a missing `Supplies` or `Shelters`, means the database is not ReliefGrid's: stop and check step 2. |

#### 0.5.2 Migration 2 — `20261025_add_aid_request_triage.sql` (110 lines) — **run once**

| | |
| --- | --- |
| Phase | A — triage |
| What it does | Adds `reviewed_priority`, `reviewed_by`, `reviewed_at` to `Aid_Requests` with a constraint that all three are set together or all three are null; replaces `find_nearest_shelters()` with the four-column version that still filters out shelters without room; replaces `get_priority_queue()` with the version that ages waiting requests, exposes request type and phone, and attaches the nearest shelter. |
| Touches | `Aid_Requests` (three columns + one constraint), two functions. No data changes. |
| Idempotent | **No.** Read the next row. |
| Why not | It runs `DROP FUNCTION IF EXISTS get_priority_queue();` and then `CREATE OR REPLACE FUNCTION find_nearest_shelters(...)` at the four-column shape. Once migration 5 has widened that function to nine columns, that statement fails with *cannot change return type of existing function* — reproduced on a fully migrated database. What happens next depends on the client, and **both outcomes are bad**: with `ON_ERROR_STOP` set (psql, the README's batch command) the file stops right there, leaving `get_priority_queue()` **dropped** — the coordinator's queue goes down until you re-apply migration 3. Without it (the Supabase editor carries on past a failing statement) the last statement still runs and recreates `get_priority_queue()` at the **Phase A** shape, so Phase 2's queue fields (`status`, `needs`) silently disappear. Both were reproduced. Fix in either case: re-apply migration 3, which is idempotent and restores the Phase 2 queue — also reproduced. |
| Verify | `SELECT pg_get_function_result('get_priority_queue()'::regprocedure);` must list `reviewed_priority`, `effective_priority` and `nearest_shelter_name` (section 8, query 1). |
| If it fails | A second run is the most likely cause. Check 0.5.0: if `m2_triage_columns` is already `true`, this migration is applied, so skip it — and because this file drops `get_priority_queue()` *before* the statement that fails, re-apply migration 3 afterwards (0.5.3 repairs this: verified). |

#### 0.5.3 Migration 3 — `20261026_add_request_needs_and_partial_fulfilment.sql` (391 lines)

| | |
| --- | --- |
| Phase | 2 — needs and partial fulfilment |
| What it does | Creates `Request_Needs`; adds `need_id` and `allocated_by` to `Allocations`; adds the `Aid_Requests.status` constraint after normalising unexpected values; rebuilds `Critical_Supply_Shortage` with `supply_id`, `unit` and category; replaces `allocate_supply()` with the need-aware five-argument version (**dropping** the old three-argument one) and replaces `get_priority_queue()`; backfills a need for every open, non-shelter request. |
| Touches | Two tables plus one new one, one view, two functions, and existing open requests (the backfill). |
| Idempotent | Yes — `IF NOT EXISTS`, a guarded constraint block, `CREATE OR REPLACE`. |
| Prerequisite | `Supply_Categories` must have rows, or the backfill cannot name any need. Section 6 has the insert. |
| Backfill to expect | On the seeded database this creates **5** `Request_Needs` rows, 2 of them estimates. Your counts will differ — what matters is section 8's fourth query returning `0` afterwards, and it did on both a fresh load and an upgraded database. |
| Repairs a mis-run migration 2 | Re-applying this file is the fix. It is idempotent, and it restores `get_priority_queue()` whether migration 2's re-run left it dropped or reverted to the Phase A shape — both reproduced. |
| Verify | Section 8 — all four queries, including the backfill check which **must return `0`**. |
| Deploy hazard | This file drops `allocate_supply(int,int,int)`, the signature the Phase-1 API calls. The migration and the API deploy must land within minutes of each other (section 9). On the hosted stack the API is already the new one, so applying the migration *closes* that window rather than opening it. |

#### 0.5.4 Migration 4 — `20261025_phase3_capacity_truth.sql` (120 lines)

| | |
| --- | --- |
| Phase | 3 — capacity truth |
| What it does | Normalises any `Shelters.status` outside `active`/`inactive` to `'inactive'` (fail closed, with a `NOTICE` counting the rows) and adds the `shelters_status_valid` CHECK; replaces `checkin_to_shelter(int,int)` so it returns `'ok'` / `'not_found'` / `'inactive'` / `'full'` / `'invalid_quantity'` instead of a boolean; adds `checkout_from_shelter(int,int)`; rebuilds `Shelter_Live_Status` with `event_id`, `event_name` and `is_active` appended. |
| Touches | `Shelters` (one constraint, and possibly the status values), three functions/views. |
| Idempotent | Yes — guarded constraint block, `DROP FUNCTION IF EXISTS` before the recreate, `CREATE OR REPLACE` elsewhere. |
| Data effect to expect | On the seeded demo database nothing is normalised (every row is already `active`), and the `NOTICE` is silent. If a `NOTICE` reports rows, those shelters come back **closed** — reopen any that are genuinely operating (section 18). |
| Verify | Section 20 — four queries. `checkin_to_shelter` must report `character varying`, never `boolean`. |
| Deploy hazard | The loudest of the four. A half-applied pair makes check-in fail with `500` (new API, old function) or silently report success for refusals (old API, new function). Section 21. |

#### 0.5.5 Migration 5 — `20261025_phase4_portal_trust.sql` (35 lines)

| | |
| --- | --- |
| Phase | 4 — portal trust |
| What it does | Drops and recreates `find_nearest_shelters(numeric,numeric,int,int)` so household size **orders** the results instead of filtering them, and so each row carries `latitude`, `longitude`, `address`, `contact_number` and `has_space`. A shelter too small for the household still appears, flagged `has_space = false`. |
| Touches | One function. No tables, no data. |
| Idempotent | Yes — `DROP FUNCTION IF EXISTS` precedes the `CREATE`. |
| Why it is safe to replace | `get_priority_queue()` calls this function and reads only `name`, `distance_km`, `available_space` by name. Those keep their names, types and positions in the nine-column result, so the queue is unaffected (section 29). |
| Verify | Section 30 — the nine-column `TABLE(...)` string, plus the two-shelter ordering check. |
| Deploy hazard | If the Public Portal deploys before this file runs, every shelter is labelled "not enough for your group" and map pins are placed at `NaN` coordinates. Migrate first, then let Vercel rebuild (section 31). |

#### 0.5.6 Migration 6 — `20261027_phase5_guardrails.sql` (185 lines)

| | |
| --- | --- |
| Phase | 5 — guardrails |
| What it does | Adds `changed_by` and `change_type` to `Shelter_Capacity_Log` with a CHECK over `checkin` / `checkout` / `correction`, so an occupancy change names the person who made it; replaces `log_capacity_change()` so the trigger reads that actor from a transaction-local setting; rebuilds `checkin_to_shelter()` and `checkout_from_shelter()` with a third, defaulted `p_changed_by` parameter the routes can pass; normalises stray `Volunteer_Tasks.status` values and adds `volunteer_tasks_status_allowed`; appends `coordinator_id` to `Shelter_Live_Status` so the board can scope its controls. |
| Touches | Two tables, one view, two functions, one trigger function. |
| Idempotent | Yes — `ADD COLUMN IF NOT EXISTS`, a guarded `DO $` block per constraint, `DROP FUNCTION IF EXISTS` before each recreate, `CREATE OR REPLACE VIEW`. Verified by applying it twice to a Phase-4 database: the second run only reports *does not exist, skipping* for the two-argument functions it had already replaced, and changes nothing else. |
| Backwards compatible | Yes, on purpose. The two-argument calls the old API, the test scripts and `psql` make still resolve through the defaulted third parameter; they record `changed_by = NULL` rather than failing. Verified on PostgreSQL 16. |
| Prerequisite | None. It reads nothing that Phase A–4 added, so it can be applied on the bare baseline. |
| Verify | Section 40 — four structural queries plus an actor proof that writes two capacity-log rows. |
| Deploy hazard | **One direction only.** A new API against an unmigrated database breaks check-in and check-out outright (`42883 undefined_function` → `500`). An old API against the migrated database keeps working and merely records no actor. Migrate first (section 41). |

### 0.6 Data changes, and the only one you have to run

#### 0.6.1 Nothing else is backfilled

Migrations 1, 2, 4 and 5 change no rows. Migration 3 backfills `Request_Needs` for open requests, and is what its verification query in section 8 checks. Migration 6 rewrites only `Volunteer_Tasks` rows whose `status` is outside the five states the app understands — on the seeded database it rewrites none, which is why the `NOTICE` is silent.

#### 0.6.2 What the migrations do to existing rows, in one place

| Row set | Effect |
| --- | --- |
| Open, non-shelter `Aid_Requests` with no need | A `Request_Needs` row is derived from `num_people`. Named when the request type maps to a supply category (`food` → Food, `water` → Water, `medical` → Medical), otherwise recorded as `is_estimate = true`. |
| Shelter-only open requests | No item need. A bed is served by check-in, not by allocating stock. |
| Existing `Allocations` | Keep `need_id = NULL`. They are history, not claims about a need. |
| Requests in an unexpected status | Set to `pending` before the constraint is added, so the constraint cannot fail the deploy. |
| `Shelters.status` outside `active`/`inactive` | Set to `inactive` (fail closed), with a `NOTICE`. |
| `Volunteer_Tasks.status` outside the five known states | Set to `pending` (the conservative "not done" reading), with a `NOTICE` naming the count. The old value is not preserved anywhere — record the preflight output in section 38 first if you need it. |

#### 0.6.3 The one update you run by hand — close the historical events

Required before Phase 4's T6, and it is the only data change in the whole train. `database/seed.sql` sets this for a fresh install; the hosted database was seeded before that and still has `end_date = NULL` everywhere.

```sql
-- Preview exactly the rows this closes.
SELECT event_id, name, start_date
FROM Disaster_Events
WHERE end_date IS NULL AND start_date < DATE '2026-01-01';
```

```sql
UPDATE Disaster_Events
SET end_date = start_date + INTERVAL '2 months'
WHERE end_date IS NULL AND start_date < DATE '2026-01-01';

-- Verify: expect 2 (the two 2026 entries).
SELECT count(*) AS open_events FROM Disaster_Events
WHERE end_date IS NULL OR end_date >= CURRENT_DATE;
```

Idempotent: re-running matches nothing once every historical event has an `end_date`. To undo it entirely: `UPDATE Disaster_Events SET end_date = NULL WHERE start_date < DATE '2026-01-01';`.

Two months after `start_date` is an approximation, and the file says so — these are curated historical events with no recorded end date. It is deliberately conservative: it closes the historical set and leaves the 2026 events open.

### 0.7 What to expect while it is half-applied

If you must stop partway, stop **between** migrations, after that migration's verification query passes. The dangerous half-states are inside migrations 3 and 4, because those are the two that change something the live API depends on:

| Stopped after | Live behaviour |
| --- | --- |
| Migration 1 | Unchanged from today. Safe to leave overnight. |
| Migration 2 | Queue and triage work; capacity cards still `0`; check-in still `500`. Safe to leave. |
| Migration 3 | Allocation and needs work; shelter board still wrong; check-in still `500`. Safe to leave. |
| Migration 4 | Everything except the portal's shelter list is correct; check-in **works**. |
| Migration 5 | Everything correct except the portal's household-size ordering and its result labels. |
| Migration 6 | Everything correct; capacity changes started recording who made them. Safe to leave — the API tolerates both the two-argument and three-argument form. |

In every one of those states the API and the frontends are already deployed, so the database is the only side that is behind — which is the recoverable direction.

### 0.8 The codes you will meet

| Code | Meaning here |
| --- | --- |
| `200` / `201` | Read / created |
| `400` | Input rejected by the route's own validation, with a message naming the field. Never a database error. |
| `401` | Not signed in, or a malformed `Authorization` header |
| `403` | Signed in, wrong role |
| `404` | The row does not exist (a real `404`, not a routing mistake) |
| `409` | The action conflicts with current state: over-allocation, allocating to a fulfilled request, checking out more people than are inside, closing a shelter with people in it... |
| `429` | Too many failed sign-ins for that number from that caller in 15 minutes. The response carries `Retry-After`; another account can still sign in (Phase 5, section 42). |
| `500` | A genuine unexpected failure — most often an unmigrated function being called (check-in before migration 4) |
| `503` + "missing a required migration" | The code is ahead of the database. Run the migrations. |

### 0.9 Troubleshooting

| Symptom | Most likely cause | What to do |
| --- | --- | --- |
| A migration file errors partway | A statement inside it failed; the earlier statements in that file still applied | Stop. Do not run the next file. Read the error message, and restore the backup if it is not explainable (section 13). |
| *cannot change return type of existing function* | Re-running migration 2 after migration 5 | Re-apply migration 3 to put `get_priority_queue()` back, then skip migration 2 — 0.5.0 already reports `m2_triage_columns = true`. |
| *cannot drop columns from view* | Re-running migration 1 after migration 3 | Harmless, changes nothing. Skip migration 1; migration 3's view is the one you want. |
| `503` on `GET /api/aid-requests/queue` immediately after a migration step | Migration 2's re-run dropped the queue function and stopped at the error | Re-apply migration 3. |
| The queue loads but shows no needs or progress, and looks like the Phase A version | Migration 2 was re-run in the SQL editor, which carried on past the error and recreated `get_priority_queue()` at the Phase A shape | Re-apply migration 3. |
| `42883 undefined_function` in Render logs | The API called a function the database does not have yet | The migration has not been applied. Run steps 5–10. |
| `42703 undefined_column` / `42P01 undefined_table` in Render logs | Same, for a column or table | Same. `503` reaches the client instead of `500` because of `describeDatabaseError`. |
| Shelter board totals still `0` after migrating | The Coordinator Dashboard is an older Vercel build, or the build failed | Check the Vercel deployment's commit and rebuild from `main`. |
| Portal still lists all 15 disasters | Step 10 was skipped | Run the update in 0.6.3 and re-run the `open_events` check. |
| Portal labels every shelter "not enough for your group" | Migration 5 has not run, or the portal build is older than the migration | Run the step 0.5.0 probe. If `m5_nearest_has_space` is `true`, rebuild the portal. |
| Check-in reports success but occupancy does not change | Old API build against the new function (the silent direction, section 21) | Redeploy the API from `main`. |
| Every request to the API is slow the first time | Render's free instance sleeps when idle; the first request can take 50 seconds or more | Retry once. Not a failure. |
| The portal cannot reach the API at all | `VITE_API_URL` for that Vercel project, or the value was set for Production only while you are testing a preview | Fix the variable and wait for the rebuild — Vercel applies environment changes only on new builds. |
| `500 "Check-in failed"` / `500 "Check-out failed"` immediately after the Phase 5 API deployed | The API calls the three-argument capacity functions, which migration 6 has not created yet (`42883 undefined_function`) | Apply migration 6. This is the one direction Phase 5's deploy must not get backwards (section 41). |
| Every shelter reads "Managed by another coordinator." and no check-in buttons appear | The Phase 5 dashboard is live but `Shelter_Live_Status` has no `coordinator_id` — the ownership test fails for every row | Apply migration 6, then reload. No console error accompanies this. |
| A coordinator who owns a shelter is refused with `403` | Their `Users.user_id` is not the shelter's `Shelters.coordinator_id` | Assign it as an Admin (`PATCH /api/shelters/:id` with `coordinator_id`, or the Edit form). The message names the reason. |
| The dashboard is stuck on "Restoring your session…" | `GET /api/auth/me` is failing — usually an old API build (the route is 404) or an expired token | Confirm the route answers `401` without a token (section 41). Otherwise sign in again; the token is discarded on failure. |
| The browser console shows a CORS error but `curl` succeeds | The origin is not in the allowlist — most often a custom domain, or `CORS_ORIGINS` set to a list that omits the frontend | See section 37. Setting `CORS_ORIGINS` replaces the built-in list and its Vercel-preview pattern entirely. |
| `429` while testing the throttle | Expected — five failures in 15 minutes is the limit | Wait, restart the Render instance, or test the throttle last (G11). |

### 0.10 Record sheet for this run

Keep the three per-phase sheets (sections 15, 25, 35) if you are filling those in; this one is the summary a reviewer will ask for.

| Field | Value |
| --- | --- |
| Date and time (with timezone) | |
| Who ran it | |
| Backup taken before starting (yes/no, and where) | |
| 0.5.0 probe result **before** | |
| Migration files applied, in order | |
| 0.5.0 probe result **after** | |
| `open_events` before / after step 10 | |
| Render deploy commit | |
| Public Portal Vercel commit | |
| Coordinator Dashboard Vercel commit | |
| Phase A (A1–A7) | |
| Phase 2 (P1–P11) | |
| Phase 3 (C1–C16) | |
| Phase 4 (T1–T12) | |
| Phase 5 (G1–G16) | |
| `CORS_ORIGINS` — set or unset? (never record the value) | |
| Second staff account and `Volunteer` account used | |
| Synthetic requests created / cleaned up | |
| Test shelters created / cleaned up | |
| Errors seen (browser console, Network, Render logs) | |
| Anything left undone, and why | |

---

## 1. How the pieces connect

The browser apps never talk to Supabase directly:

```text
Public Portal ─┐
               ├──> Render Express API ───> Supabase PostgreSQL
Coordinator ───┘
```

| Setting | Where it lives | What it does |
| --- | --- | --- |
| `VITE_API_URL` | Vercel → each frontend project → Environment Variables | API base URL baked into the frontend build. The app appends `/api`. Public by design — never put a secret here. |
| `DATABASE_URL` | Render → `reliefgrid-api` → Environment | Supabase connection string. Contains credentials: never paste it into chat, an issue, a screenshot or this file. |
| `JWT_SECRET` | Render → `reliefgrid-api` → Environment | Signs 12-hour login tokens. Changing it logs everyone out. |
| `CORS_ORIGINS` | Render → `reliefgrid-api` → Environment | **Optional, added by Phase 5.** Comma-separated exact origins with scheme and no trailing slash. Set, it becomes the *entire* allowlist — including for Vercel previews, which then have to be listed individually. Unset, the API accepts localhost and `127.0.0.1` on 5173/5174, the two production aliases, and previews of those two projects by pattern. An origin is not a secret. |

**No phase requires a new environment variable.** `CORS_ORIGINS` is the only new setting and it is optional; every other change in this train is code or schema. If a check fails, suspect a stale build or an unapplied migration before suspecting configuration.

## 2. Deployed endpoints

These were the URLs recorded when the runbook was written. The hosting dashboards are the source of truth — if a link has changed, use the current Production URL.

| Service | Hosting | URL |
| --- | --- | --- |
| Public Portal | Vercel → `relief-grid-publicportal` | <https://relief-grid-five.vercel.app/> |
| Coordinator Dashboard | Vercel → `relief-grid-coordinator-dashboard` | <https://relief-grid-egia.vercel.app/> |
| API | Render → `reliefgrid-api` | <https://reliefgrid-api-6o4j.onrender.com> |

Render's free instance sleeps when idle; the first request after a quiet period can take 50 seconds or more. A slow first load is not a failure.

## 3. Before you start

- **Use an authorized staff account** with the `Admin` or `ShelterCoordinator` role. Those roles can see requester contact details, record a priority review, and allocate stock. A `Volunteer` account can read the queue with contact details blanked, but gets `403` on allocation and review — and, once Phase 5 is deployed, on check-in, check-out and shelter edits too.
- **Phase 5's ownership rule needs a second staff account.** A `ShelterCoordinator` may only act on shelters whose `Shelters.coordinator_id` is their own `Users.user_id`; an `Admin` may act on any. One account cannot demonstrate a refusal that depends on ownership, so either borrow a second coordinator or use the Admin account to reassign a shelter between the two.
- **Several checks write data**: request creation, priority review, allocation, and one `created_at` update. Use clearly synthetic values and run them only on the demo/test Supabase project. Do not run them against a live operational database.
- **Reserve a phone prefix for this runbook**, for example `9000000090` – `9000000099`. Section 12 removes exactly those rows again.
- **Take a backup.** Supabase → Database → Backups. On plans without point-in-time recovery this is your rollback; if it is unavailable, run the preflight query in section 6 and keep its output as the record of the starting state.
- **Do not run `database/schema.sql` or `database/seed.sql`** against Supabase. They build a new database and will alter or duplicate data.
- **`Supply_Categories` must be populated** before migration 3 runs — it is the only data prerequisite. The preflight in section 6 checks this and shows the insert if it is empty.
- **Keep the migration and the API deployment close together** (minutes, not hours). Section 9 explains why.

## 4. Step 1 — check the wiring (read-only, no database changes)

Repeat on both deployed frontends.

1. Open the deployed site, press **F12**, open **Network**, enable **Preserve log**, reload.
2. Filter for `api` and open a request. The **Request URL** must start with the current Render host, e.g.
   - `/api/shelters/nearest?...` (portal shelter search)
   - `/api/aid-requests` (portal submission)
   - `/api/aid-requests/queue` (coordinator queue)
   - `/api/shelters/ranked` (coordinator occupancy)
3. On the Coordinator Dashboard, filter for `socket.io`. It must use the same Render host.
4. Status codes mean what they usually mean here: `200` read, `201` created, `401` not signed in, `403` signed in but wrong role, `503` **the database is behind the code** (see section 9).

A request to `localhost`, an unrelated host, or an old deployment means `VITE_API_URL` is wrong or the frontend has not been redeployed since it was set. Vercel environment changes only apply to new builds.

## 5. Step 2 — confirm Render points at the intended Supabase project

Only someone with access to the Render service settings can check this; the browser cannot reveal it.

1. Render → `reliefgrid-api` → **Environment** → `DATABASE_URL`. Do not copy the value anywhere.
2. Supabase → the intended project → **Project Settings → General**. Note the project reference.
3. Compare the host in `DATABASE_URL` with that project reference. Direct hosts and pooler hosts both belong to a project; the reference is what matters.
4. If they do not match, replace the Render value with the connection string for the intended project and redeploy. Never share the value while doing so.

## 6. Step 3 — preflight: what the database already has

This is the Phase A / Phase 2 slice of the question. **Section 0.5.0 asks it for all six migrations at once and is the one to run first** — it also covers migrations 4, 5 and 6, which this query does not.

Supabase → **SQL Editor** → **New query**. Read-only:

```sql
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'aid_requests'
            AND column_name = 'reviewed_priority')                     AS phase_a_columns,
  to_regclass('public.request_needs') IS NOT NULL                      AS phase_2_table,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'critical_supply_shortage'
            AND column_name = 'supply_id')                             AS view_has_supply_id,
  (SELECT count(*) FROM Supply_Categories)                             AS supply_categories,
  (SELECT count(*) FROM Supplies)                                      AS supply_items;
```

Expected on an un-migrated database: `false | false | false`, with a non-zero category count.

If `critical_supply_shortage` does not exist, the query still runs and reports `false` for that column; treat a missing view as missing.

Keep this output. It tells you which migration files you still need.

### If `supply_categories` is zero

The item-level model has nothing to attach needs to, and the public portal's "What do you need?" checklist is built from this table. Migration 3's backfill also maps `food` / `water` / `medical` request types onto category names, so an empty table means every historical request would be recorded as an unnamed estimate. Fill it **before** running the migrations:

```sql
INSERT INTO Supply_Categories (name) VALUES ('Food'), ('Water'), ('Medical'), ('Bedding')
ON CONFLICT (name) DO NOTHING;
```

`name` is unique, so re-running this is safe. The four names are the ones the seed file and the backfill expect; add more only if the response network actually stocks them. A zero `supply_items` count is not a blocker for the migration, but it means the Allocation tab will have nothing to choose from — stock rows are operational data, not something a migration creates.

## 7. Step 4 — apply the migrations, in order

Run **one file at a time**: paste the whole file, execute, read the result, then continue. Do not paste two files into one query.

| # | File | Phase | What it changes | Needed? |
| --- | --- | --- | --- | --- |
| 1 | `database/migrations/20261016_add_supply_id_to_shortage_view.sql` | pre-A | Adds `supply_id` to `Critical_Supply_Shortage` so an allocation can identify the stock row. | Optional — superseded by file 3, which recreates the same view with `supply_id`, `unit` and category. Harmless to run. |
| 2 | `database/migrations/20261025_add_aid_request_triage.sql` | **A** | Adds `reviewed_priority`, `reviewed_by`, `reviewed_at`, the review-completeness constraint, and replaces `find_nearest_shelters()` and `get_priority_queue()` with the ageing/queue-detail versions. | **Yes** if `phase_a_columns` was `false`. |
| 3 | `database/migrations/20261026_add_request_needs_and_partial_fulfilment.sql` | **2** | Creates `Request_Needs`, links allocations to a need and an actor, adds the request status constraint, rebuilds `Critical_Supply_Shortage`, and replaces `allocate_supply()` with the 5-argument, need-aware version. Also backfills needs for open requests. | **Yes** if `phase_2_table` was `false`. |

Notes that matter:

- File 3 is **idempotent** (`IF NOT EXISTS`, guarded constraint, `CREATE OR REPLACE`) — re-running it is safe if you are unsure whether it committed.
- File 2 is **not** idempotent: its `CREATE FUNCTION` fails if run twice. Run it once.
- Two intentional effects of file 3: the old 3-argument `allocate_supply()` is **dropped**, and any request whose `status` falls outside `pending / partially_fulfilled / fulfilled / cancelled` is reset to `pending`. See section 9 before deploying.
- No extensions are required, and no role or grant changes are needed.
- If a statement fails, stop. Restore the backup before continuing rather than running later files over a half-migrated schema.
- This section covers files 1–3 only, because it is the Phase A / Phase 2 slice. Files 4, 5 and 6 are documented one per file in 0.5.4, 0.5.5 and 0.5.6; apply them in the same sitting and in that order.

## 8. Step 5 — verify the schema landed

Same editor, four read-only queries. All four must match the expected result.

```sql
-- 1. Phase A queue function: must list reviewed_priority, effective_priority,
--    nearest_shelter_name and (after Phase 2) needs.
SELECT pg_get_function_result('get_priority_queue()'::regprocedure);

-- 2. Phase 2 allocation function: must show the five parameters.
SELECT pg_get_function_arguments('allocate_supply(int,int,int,integer,integer)'::regprocedure);

-- 3. Phase 2 shortage view: must include supply_id, unit and category_id.
SELECT string_agg(attname, ',' ORDER BY attname)
FROM pg_attribute
WHERE attrelid = 'critical_supply_shortage'::regclass AND attnum > 0;

-- 4. Backfill: must return 0. A non-zero count means open requests still
--    have no need recorded — re-run migration file 3 before continuing.
SELECT count(*) AS open_requests_without_need
FROM Aid_Requests r
WHERE r.status IN ('pending', 'partially_fulfilled')
  AND COALESCE(btrim(r.request_type), '') <> 'shelter'
  AND NOT EXISTS (SELECT 1 FROM Request_Needs n WHERE n.request_id = r.request_id);
```

Query 2 must not error: if it does, the 5-argument function does not exist and Phase 2 did not land.

## 9. Step 6 — deploy, in the right order

The one real hazard in this rollout: migration 3 drops `allocate_supply(int,int,int)`, and the **currently deployed** API still calls exactly that signature. So there is a window where the old backend and the new schema disagree, or the new backend and the old schema disagree. Keep it to a few minutes.

1. **Merge the Phase 2 branch to `main`.** Render and both Vercel projects build from `main`. If you prefer, start the Render build manually (**Manual Deploy → Deploy latest commit**) immediately after merging.
2. **While it builds, run the migrations** from section 7 — or run them first and deploy immediately after. Either order is fine; doing nothing for hours is not.
3. **Confirm Render finished**: Events shows the new commit and `Live`.
   - `GET /health` → `{"status":"ok"}` (process only — it does not touch the database).
   - `GET /api/shelters` → `200` with JSON (proves the database connection).
4. **Confirm both Vercel projects** are on the new commit and that `VITE_API_URL` is set for **Production** (and **Preview**, if you use preview URLs) on each project. Each project must keep its own root directory (`coordinator-dashboard` / `public-portal`), Vite preset, and `dist` output.
5. **Prove the new API build is live** with a staff token: `GET /api/supplies/inventory` must return `200` with rows. That route did not exist before Phase 2, so a `200` is unambiguous.

What a mismatch looks like, and what it means:

| Symptom | Meaning |
| --- | --- |
| New API answers `503` with "The database is missing a required migration. Apply database/migrations in order, then retry." | The code is ahead of the database. Run the migrations. |
| Old dashboard's Allocate button errors after you migrated but before the new API deployed | The dropped 3-argument function. Wait for the Render deploy to finish. |
| Allocation tab is missing entirely | The frontend build is old, or Vercel deployed the wrong root directory. |

## 10. Step 7 — Phase A functional checks

Sign in to the Coordinator Dashboard as staff and open **Priority queue**. The checks below read best against the synthetic requests created in section 11.1 — create those first if the queue is empty.

| ID | Issue | Action | Expected |
| --- | --- | --- | --- |
| A1 | #48 staff review | On a `pending` request, choose a **Reviewed priority** different from its reported urgency and press **Record review**. Refresh the page. | The review persists. Each row shows the reported value (`3/5 · reported`), the review state (`Not reviewed` or the reviewer), and the ordering value (`3/5 · for order`). |
| A2 | #49 waiting time | On one synthetic `pending`, unreviewed request, run the ageing update in section 12, then refresh the queue. | The waiting time reads at least one day and the ordering score has risen by one level (capped at 5). If a row shows a score above 5, that is a failure — record the request ID. |
| A3 | #50 request type | Inspect the synthetic requests. | The type column shows the stored value (`medical`, `food`, `rescue`, `shelter`) and survives a refresh. The form's "Food or water" option stores `food`. |
| A4 | #51 requester phone | Inspect the same rows. | Phone numbers appear next to names for staff roles and survive a refresh. Sign in as a `Volunteer` (if you have one) and confirm the phone is blank rather than wrong. |
| A5 | #52 location context | Compare a request submitted with location and one without. | With location: a **View map** link, coordinates, and — if an active shelter with room exists — `Closest with room: <name> · <km> · <places>`. Without location: an explicit "location not provided" state, no map link, no invented nearest shelter. |
| A6 | #53 event grouping | Open **Occupancy**. | Shelters are grouped under disaster event names. Unlinked shelters show `Unassigned event`; a linked event with no name shows `Unknown event`. |
| A7 | #54 live status and reconnect | Watch the status next to the page heading, then set DevTools → Network → **Offline**, wait, then go back online. | Online and fresh: `Live · queue refreshed <time>`. Offline: `Disconnected · queue may be stale`. Back online: `Live` again after a successful refresh. A new portal request appears without a manual reload (allow the socket event plus the periodic refresh). |

## 11. Step 8 — Phase 2 functional checks

Use the phone prefix reserved in section 3 so section 12 can clean up.

### 11.1 Public Portal — request with needs

1. Open the deployed Public Portal → **Request help**.
2. Fill **Full name**, **Phone number**, **Type of help** = `Food or water`, **People needing help** = `2`, leave urgency low.
3. In **What do you need?**, tick **Food** and set **Amount** to `3`. Tick **Medical**, set its amount to `1`.
4. Submit. Expect the "We've sent your request" panel and, in the Network tab, `POST /api/aid-requests` → `201` with a `needs` array of two entries.
5. Submit a second request with the same prefix, leaving **What do you need?** blank, type = `Rescue`. Expect `201` with one need labelled `Unspecified relief items for N people` and `is_estimate: true`.
6. Submit a third with type = `Shelter`. Expect `201` with an empty `needs` array — a bed is served by check-in, not by stock.

If the item list fails to load, the form still sends the request and says so; that is the designed fallback, not a Phase 2 failure.

### 11.2 Coordinator Dashboard — allocation

| ID | Check | Action | Expected |
| --- | --- | --- | --- |
| P1 | Inventory is visible | Open **Allocation**. | **1. Choose stock** lists every stock item with item, category, shelter and on-hand quantity — not just items below their reorder point. The header counts all items and separately names how many are below reorder point. |
| P2 | Nothing is preselected | Look at **2. Choose the request it serves** before touching stock. | It reads "Select a stock item first. Nothing is allocated until you confirm." No request is chosen for you. |
| P3 | Needs reach the queue | Open **Priority queue** and find the request from 11.1. | It shows the named needs with progress, e.g. `Food for 2 people — 0/2 sent · 2 left`, and the row is marked partly served once anything is sent. |
| P4 | Partial fulfilment | In **Allocation**, select the rice/food stock, pick the request with a Food need, set **Quantity to send** below the remaining need, press **Confirm allocation**. | Success. The need progress becomes `1/2 sent · 1 left`; the request status is `partially fulfilled`; stock on hand drops by exactly that quantity. |
| P5 | Over-allocation is refused | Repeat with a quantity above the remaining need. | Refused with a message about the outstanding need (`exceeds_remaining_need`); stock unchanged; no history row added. |
| P6 | Wrong category is refused | Select a Medical need while allocating Food stock. | Refused (`need_mismatch`); nothing deducted. |
| P7 | Audit trail | Scroll to **Recent allocations**. | One row per successful allocation with when, item and quantity, source shelter, request and requester, request status, and **Recorded by** = the signed-in staff member. It appears without a manual refresh. |
| P8 | Contact details are role-scoped | Call `GET /api/supplies/allocations` with a `Volunteer` token. | `200`, with `phone` and `requester_name` `null` but item, shelter and status present. A staff token returns them. |
| P9 | Shortage handoff | Click **Allocate** on an item in the **Critical supply shortage** panel. | The Allocation tab opens with that stock already selected and its eligible requests listed — the shortage row no longer owns a request picker of its own. |
| P10 | Role enforcement | `POST /api/supplies/allocate` with no token, then with a `Volunteer` token. | `401`, then `403`. Nothing is deducted. |
| P11 | Fulfilled requests stop | Complete a request's only need, then try to allocate to it again. | Refused: `need_already_met` for a need that is already satisfied, `request_not_eligible` once the whole request is fulfilled. Both arrive as HTTP 409. |

## 12. Step 9 — the one data-changing helper, and cleanup

### Ageing test (Phase A, A2)

Replace `123` with the synthetic request's ID. The `WHERE` clause is deliberately narrow; if it returns no row, stop and re-check the ID rather than widening it.

```sql
UPDATE Aid_Requests
SET created_at = now() - interval '25 hours'
WHERE request_id = 123
  AND status = 'pending'
  AND reviewed_priority IS NULL
RETURNING request_id, status, urgency_level, reviewed_priority, created_at;
```

### Cleanup

Only run this if the reserved prefix is used by nothing else. It restores the stock that the synthetic allocations consumed (deleting rows alone does not restock, because the trigger already deducted it), then removes the synthetic requests.

```sql
-- 1. Put the stock back.
WITH mine AS (
  SELECT a.supply_id, SUM(a.quantity_allocated) AS quantity
  FROM Allocations a
  JOIN Aid_Requests r ON r.request_id = a.request_id
  WHERE r.phone LIKE '900000009%'
  GROUP BY a.supply_id
)
UPDATE Supplies s
SET quantity = s.quantity + mine.quantity
FROM mine
WHERE s.supply_id = mine.supply_id;

-- 2. Remove allocations first: that foreign key is not cascading.
DELETE FROM Allocations
WHERE request_id IN (SELECT request_id FROM Aid_Requests WHERE phone LIKE '900000009%');

-- 3. Needs cascade with the request, but deleting explicitly is harmless.
DELETE FROM Request_Needs
WHERE request_id IN (SELECT request_id FROM Aid_Requests WHERE phone LIKE '900000009%');

-- 4. Remove the requests themselves.
DELETE FROM Aid_Requests WHERE phone LIKE '900000009%';
```

If you used a different prefix, replace it in all four statements. Deleting the synthetic rows does not remove them from the coordinator's allocation history until step 2 runs.

## 13. Rollback

There are no down migrations. The reliable rollback is:

1. Restore the pre-migration backup in Supabase.
2. Redeploy the previous Render and Vercel builds (Render: the last successful deploy; Vercel: **Deployments → previous → Promote to Production**).
3. Re-run section 6 to confirm the database is back to the recorded preflight state.

Because the migration files are additive apart from the dropped function and the status normalisation, there is nothing else to undo.

## 14. What this runbook does not cover

- **No automated frontend tests exist in the repository.** The UI checks above are manual, and the repo has no browser test harness; only the database and API have repeatable checks (`server/tests/`).
- **Supabase sits behind a connection pooler.** The concurrency guarantee was proven locally against PostgreSQL 16 with two independent sessions. Re-running `npm run test:allocation` against the hosted database is the only way to confirm it there — do that only on a disposable copy, because the script writes to the database.
- **`/health` does not check the database.** Only a database-backed route proves the connection.
- **Cold starts** on Render's free tier delay the first request; distinguish that from a broken deployment by retrying once.

## 15. Record sheet

Keep this with the deployment notes; never include tokens, passwords or the database URL.

| Field | Value |
| --- | --- |
| Date and time (with timezone) | |
| Deployed frontend URLs | |
| API host | |
| Preflight result (section 6) | |
| Migration files applied | |
| Render deploy commit | |
| Vercel deploy commits | |
| Phase A results (A1–A7) | |
| Phase 2 results (P1–P11) | |
| Synthetic request IDs created | |
| Cleanup performed | |
| Errors observed (browser console, Network, Render logs) | |

---

# Phase 3 addendum — Capacity truth

This addendum covers Phase 3 only (issues #62–#66, FRONTEND_AUDIT.md items 19, 20, 21, 22, 25). It assumes the Phase A and Phase 2 deploy described above is already live, and extends the same stack: **one Render API, two Vercel frontends, one Supabase database.** It does not repeat section 6's preflight — run that first if you have not already, so you know which earlier migrations have actually landed.

## 16. Phase 3 — overview

Phase 3 touches **shelters only**: the `Shelters` table, `checkin_to_shelter()`, a new `checkout_from_shelter()`, the `Shelter_Live_Status` view, `server/routes/shelters.js`, and the Coordinator Dashboard's **Live shelter board** (`ShelterBoard.tsx`). It does not touch `Aid_Requests`, `Request_Needs`, `Supplies`, `Allocations`, or anything in `server/routes/aidRequests.js` or `server/routes/supplies.js`.

| Needs a change? | Answer |
| --- | --- |
| Database migration | **Yes** — `database/migrations/20261025_phase3_capacity_truth.sql`. |
| Render (API) redeploy | **Yes** — `server/routes/shelters.js` gains `POST /api/shelters`, `PATCH /api/shelters/:id`, `GET /api/shelters/:id`, and `POST /api/shelters/:id/checkout`; `POST /api/shelters/:id/checkin` and `GET /api/shelters/ranked` change behaviour (see section 21). |
| Vercel — Coordinator Dashboard redeploy | **Yes** — `ShelterBoard.tsx`, `App.tsx`, `App.css`, `types.ts` all change. |
| Vercel — Public Portal redeploy | **No.** Phase 3's diff does not touch any file under `public-portal/`. Redeploying it is harmless but unnecessary. |
| New environment variable | **No.** Same as Phase A and Phase 2 — `VITE_API_URL`, `DATABASE_URL`, `JWT_SECRET` are unchanged. |

## 17. Phase 3 — prerequisites

Confirm Phase A and Phase 2 are applied using **section 6's preflight query**, not a repeat of it here. Phase 3 has **no functional dependency** on either: `checkin_to_shelter()`, `checkout_from_shelter()`, and `Shelter_Live_Status` reference only `Shelters` and `Disaster_Events`, neither of which Phase A or Phase 2 changed. You can apply the Phase 3 migration on a database that has only the original `schema.sql` baseline, before Phase A or Phase 2. The only reason to confirm them first is that this runbook assumes you are operating on the same already-deployed stack those sections describe.

**Data prerequisite:** none. Unlike Phase 2 (which needed `Supply_Categories` populated), Phase 3 reads and writes only columns already present in every `Shelters` row since the original seed.

## 18. Step 10 — Phase 3 preflight: what the database already has

Supabase → **SQL Editor** → **New query**. Read-only:

```sql
-- Read-only. Listed by function name rather than by argument list, so the same
-- query answers before and after Phase 5 rebuilds these functions.
SELECT p.oid::regprocedure AS signature, pg_get_function_result(p.oid) AS returns
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'checkin_to_shelter';

SELECT
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'checkout_from_shelter')      AS checkout_functions,
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'shelters_status_valid'
            AND conrelid = 'shelters'::regclass)                            AS status_check_exists,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'shelter_live_status'
            AND column_name = 'is_active')                                  AS view_has_is_active;
```

Expected on a database that has not run the Phase 3 migration: `checkin_to_shelter(integer,integer)` returning `boolean`, `checkout_functions = 0`, `status_check_exists = false`, `view_has_is_active = false`.

If Phase 5 has already been applied when you run this, the first query answers `checkin_to_shelter(integer,integer,integer) — character varying` instead. That is Phase 3 applied *and* upgraded, not a skip: migration 6 rebuilds the same function with one more parameter, which already implies Phase 3's return-type change.

### Constraint-violation check (informational — the migration now normalises this itself)

The Phase 3 migration adds `CHECK (status IN ('active', 'inactive'))` to `Shelters.status`. Like Phase 2's status constraint, it now **normalises unexpected values to `'inactive'` before adding the CHECK**, inside the same guarded `DO $$` block, so a stray value from the old unconstrained column cannot fail the deploy. It normalises *closed* on purpose: an unknown or typo'd status was already invisible to `find_nearest_shelters()` and rejected by `checkin_to_shelter()`, so flipping it to `'active'` would newly publish a shelter nobody has confirmed is operating. The block raises a `NOTICE` with the number of rows it changed. Run this query before migrating to know which rows that will be:

```sql
SELECT shelter_id, name, status
FROM Shelters
WHERE status IS NULL OR status NOT IN ('active', 'inactive');
```

Expected: 0 rows. The project's seed data only ever sets `status = 'active'`, so on the seeded demo database this will be empty. If it is not empty, the listed shelters come out of the migration as `inactive` — appear as **Inactive** on the board and in `find_nearest_shelters()` results. Reopen any that are genuinely operating with an explicit `UPDATE ... SET status = 'active'` (or the Edit form on the Live shelter board) after the migration.

## 19. Step 11 — apply the Phase 3 migration

| # | File | What it changes | Needed? |
| --- | --- | --- | --- |
| 4 | `database/migrations/20261025_phase3_capacity_truth.sql` | Normalises any `Shelters.status` value outside `active`/`inactive` to `'inactive'` (fail closed, with a `NOTICE` counting the rows), then adds the `shelters_status_valid` CHECK; replaces `checkin_to_shelter(int,int)` (drops it first, since its return type changes from `BOOLEAN` to `VARCHAR`) so it returns `'ok'` / `'not_found'` / `'inactive'` / `'full'` / `'invalid_quantity'` instead of a boolean; adds `checkout_from_shelter(int,int)` returning `'ok'` / `'not_found'` / `'exceeds_occupancy'` / `'invalid_quantity'`; rebuilds `Shelter_Live_Status` with `event_id`, `event_name`, and `is_active` appended after the original six columns. | **Yes** if `checkin_return_type` was `boolean` in section 18. |

This file is listed as **migration 4** in `database/migrations/README.md`, with Phase 4's as migration 5.

**Idempotency:** safe to re-run. The status-check block is guarded (`IF NOT EXISTS`); `checkin_to_shelter()` is preceded by an explicit `DROP FUNCTION IF EXISTS`, so re-running the file drops and recreates it cleanly every time rather than failing like Phase A's migration 2 does; `checkout_from_shelter()` uses `CREATE OR REPLACE`; the view uses `CREATE OR REPLACE VIEW`. `database/migrations/README.md` documents a single `psql` batch covering migrations 1–5 in order. Against Supabase, paste this file into the SQL Editor on its own — one file per query, the same way migrations 1–3 were applied — because a two-file paste half-applies if the second one fails.

**Side effects to expect, not bugs:**
- The old `checkin_to_shelter(int,int)` **BOOLEAN**-returning function is dropped and replaced. See section 21 for why the deploy order matters here specifically.
- No trigger changes. `checkout_from_shelter()` reuses the existing `trg_log_capacity` trigger (`AFTER UPDATE OF capacity_occupied ON Shelters`) because it updates the same column the same way check-in does — every successful check-out writes a `Shelter_Capacity_Log` row automatically, with no new trigger needed.
- `mv_daily_capacity_trend` is untouched. Because check-outs now also log to `Shelter_Capacity_Log`, the daily trend will show occupancy *decreasing* on days with check-outs once you `REFRESH MATERIALIZED VIEW mv_daily_capacity_trend` — this is new real data, not a bug in the view.
- No data backfill. The one normalisation this migration performs is the `Shelters.status` reset described above — nothing else is touched.
- Both functions now reject `p_num_people <= 0` with `'invalid_quantity'` before taking any lock. The deployed API already validated this client-side, so this only matters for anyone calling the functions directly (test scripts, `psql`, a future caller) — it is not reachable through the current routes.

## 20. Step 12 — verify the Phase 3 schema landed

```sql
-- 1. Check-in must return a status code, not a boolean.
SELECT p.oid::regprocedure AS signature, pg_get_function_result(p.oid) AS returns
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'checkin_to_shelter';
-- Expected, before Phase 5: checkin_to_shelter(integer,integer) — character varying
-- Expected, after Phase 5:  checkin_to_shelter(integer,integer,integer) — character varying
-- Never boolean, in either state.

-- 2. Check-out must exist.
SELECT p.oid::regprocedure AS signature, pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'checkout_from_shelter';
-- Expected: one row, starting p_shelter_id integer, p_num_people integer —
-- and after Phase 5 ending p_changed_by integer DEFAULT NULL::integer

-- 3. The status CHECK must be in place.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'shelters_status_valid' AND conrelid = 'shelters'::regclass;
-- Expected: one row, definition CHECK (((status)::text = ANY (ARRAY['active'::character varying, 'inactive'::character varying]::text[])))

-- 4. The view must carry the new columns.
SELECT string_agg(attname, ',' ORDER BY attname)
FROM pg_attribute
WHERE attrelid = 'shelter_live_status'::regclass AND attnum > 0;
-- Expected, before Phase 5:
--   capacity_occupied,capacity_total,event_id,event_name,is_active,name,occupancy_pct,shelter_id,status
-- Expected, after Phase 5 (coordinator_id appended):
--   capacity_occupied,capacity_total,coordinator_id,event_id,event_name,is_active,name,occupancy_pct,shelter_id,status
```

Query 1 must not error and must not say `boolean` — either means the drop/recreate did not happen. Neither query names a signature, so both keep answering once Phase 5 has rebuilt these functions; a query keyed on `checkin_to_shelter(int,int)` would start erroring at that point, which is why they are written this way.

## 21. Step 13 — deploy order and hazards (Phase 3)

Phase 3 has a hazard the Phase A/2 rollout did not: **a mismatch here does not always error loudly — one direction fails silently.**

**If the migration runs before the new API deploys** (old `server/routes/shelters.js` still live):
The old check-in route reads the function's result as `if (result.rows[0].success)`. Before the migration, `checkin_to_shelter()` returns a Postgres `BOOLEAN`, which `pg` hands to Node as a real JavaScript `true`/`false`. After the migration, the same call returns a `VARCHAR` — `'ok'`, `'not_found'`, `'inactive'`, or `'full'` — and `pg` hands that to Node as a string. **Every one of those four strings is truthy in JavaScript.** The old code's `if (result.rows[0].success)` will therefore be `true` for every outcome, including `'not_found'`, `'inactive'`, and `'full'` — it reports `200 {"success": true}` for a check-in that the function actually refused. This is **not** a crash and **not** a database write (the function only updates `capacity_occupied` on the `'ok'` branch), so no data corrupts — but the coordinator dashboard shows a false success message for a check-in that never happened. Keep this window as short as possible; if you cannot deploy within minutes, apply the migration and the API together or not at all.

**If the new API deploys before the migration runs:**
The new check-in route does `if (outcome === 'ok')`. Before the migration, the database still returns a Postgres `BOOLEAN`, which `pg` hands to Node as `true`/`false` — neither of which strictly equals the string `'ok'`. Every check-in request, including ones with available space, falls through to the `CAPACITY_RESULT_RESPONSES[outcome] || { status: 500, message: 'Check-in failed' }` default and returns `500`. This is a loud, visible outage (not silent), limited to check-in: `GET /api/shelters` still works (it queries the *view*, not the function), but **check-in is completely unavailable** until the migration lands. Check-out calls `checkout_from_shelter()`, which does not exist yet on an unmigrated database, so those fail with a clean `500 "Check-out failed"` from the generic catch block (the underlying Postgres error is `42883 undefined_function`).

**If the new Coordinator Dashboard deploys before the migration runs:**
`ShelterBoard.tsx` reads `shelter.is_active` from `GET /api/shelters` and filters the headline totals on it: `shelters.filter((shelter) => shelter.is_active)`. On an unmigrated view, that field is simply absent from the JSON, so `shelter.is_active` is `undefined` in the browser — which is falsy. **Every shelter is excluded from the "People sheltered" and "Open spaces" summary cards**, which will both read `0`, even though real people are checked in. The per-shelter table rows still render correctly (they don't depend on `is_active`), so this looks like a totals bug, not a missing-data error, and could be mistaken for a real regression if you don't know the schema is behind.

**Safest order:** apply the migration first, confirm it with section 20's queries, then deploy the API, then the Coordinator Dashboard. Keep the gap to a few minutes, the same guidance as section 9.

**Proof the new API build is live** (no token, no mutation):

```bash
curl -i https://<render-host>/api/shelters/1
```

- Old API: Express's default 404 page (`Cannot GET /api/shelters/1`) — no route matches a bare `/:id` on the old router.
- New API: `401 {"message":"Missing or malformed Authorization header"}` — the route exists and `requireAuth` ran. A `401` here is the "it's live" signal, not a problem.

Confirm both Vercel projects separately, the same way section 9 step 4 describes — this phase only requires the Coordinator Dashboard project to have picked up the new commit; the Public Portal project does not need to (section 16).

## 22. Step 14 — Phase 3 functional checks

Sign in to the Coordinator Dashboard as staff and open **Live shelter board**. Use any shelter that currently has spare capacity and is `active`, unless the row says otherwise.

**If the Phase 5 build is already deployed** — which is the case if you are running this whole train in one sitting and merged both phases first — then C1 and C12 behave differently, and the differences are correct: check-in and check-out require `Admin` or `ShelterCoordinator` and, for a coordinator, a shelter they are assigned to. Use an account that owns the shelter you are testing, or the `Admin`. Sections 42's G2–G6 are what assert that rule; these two rows simply note the change so a `403` here is not mistaken for a regression.

| ID | Issue | Role needed | Action | Expected |
| --- | --- | --- | --- | --- |
| C1 | #62 | Staff (before Phase 5: any authenticated role; after Phase 5: `Admin`, or the coordinator assigned to this shelter) | Check in a few people, then use the new **Check out** control for fewer people than you just checked in. | `200 {"success": true}`; **Occupancy** drops by exactly that amount; a new row appears in `Shelter_Capacity_Log` for this shelter (same trigger as check-in). After Phase 5 that row also records the signed-in user in `changed_by` — G12 checks it directly. |
| C2 | #62 | Staff | Try to check out more people than the shelter currently shows as occupied. | `409`, message `"Cannot check out more people than are currently checked in"`; occupancy unchanged. |
| C3 | #62 | Staff | Check out from a shelter ID that does not exist (e.g. via the API directly, since the UI only offers real IDs). | `404`, message `"No shelter exists with this ID"`. |
| C4 | #63 | Staff | Edit a shelter's status to **Inactive / closed** (see C10), then try to check someone in to it. | `409`, message `"This shelter is closed/inactive and cannot accept check-ins"`; occupancy unchanged; no `shelter-updated` socket event, so other open dashboards do not refresh. |
| C5 | #64 | Staff | Attempt a check-in against an unknown shelter ID via the API. | `404`, message `"No shelter exists with this ID"` — **not** `200 {"success": true}` as it was before Phase 3. |
| C6 | #65 | Any signed-in role | On **Live shelter board**, note the "People sheltered" and "Open spaces" summary cards, then close a shelter (set it **Inactive**) that has people checked in. | The closed shelter still appears in the table with an **Inactive** badge next to its occupancy status, but its capacity drops out of both summary cards — they recompute from active shelters only. |
| C7 | #65 | Any signed-in role | Use the event filter dropdown above the table (only shown when more than one event is present). | Selecting an event narrows the table and the summary cards to shelters in that event only; an inactive shelter in the selected event is still excluded from the totals as in C6. |
| C8 | #65 | Any signed-in role | Open **Occupancy ranking**. | A shelter you set **Inactive** in C6 does not appear in any event's ranked list at all. |
| C9 | #66 | Admin or ShelterCoordinator | Click **Add shelter**, fill name/latitude/longitude/capacity, submit. | `201`; the form closes and the new shelter appears in the table immediately, no manual reload. |
| C10 | #66 | Admin or ShelterCoordinator | Click **Edit** on a shelter, change **Status** to **Inactive / closed**, save — including one that still has people checked in. | `200`; closing is allowed regardless of current occupancy. The row shows the **Inactive** badge and loses its **Check in** control (replaced with "Closed — no new check-ins."), but keeps **Check out** — a closed shelter can still be occupied and must stay emptyable. |
| C11 | #66 | Admin or ShelterCoordinator | On a shelter with people checked in, try to **Edit** its capacity down to below the current occupancy. | `409`, message `"capacity_total cannot be reduced below the current occupancy"`; nothing is changed. |
| C12 | #66 | Volunteer | Attempt **Add shelter** or **Edit** (via the API, since the UI hides these controls for this role). | `403`. After Phase 5 the same account is refused on check-in, check-out and allocation too (G3). |
| C13 | regression | Admin or ShelterCoordinator | Record a priority review on **Priority queue** (Phase A, A1) or complete a Food need on **Allocation** (Phase 2, P4). | Behaves exactly as sections 10 and 11 describe — unaffected by the Phase 3 deploy, since Phase 3 touches no shared code path with triage or allocation. |
| C14 | #62, #66 | Staff | On the shelter closed in C10, use **Check out** to remove everyone still inside it. | `200` each time; occupancy reaches `0`. `checkout_from_shelter()` never checks `status`, so this works on an inactive shelter exactly as it does on an active one — confirm check-in on the same shelter still returns `409` throughout. |
| C15 | #25 | Staff (API) | `POST /api/shelters/abc/checkin`, `POST /api/shelters/abc/checkout`, `GET /api/shelters/abc`, `PATCH /api/shelters/abc` — a non-numeric ID in place of a real one. | `400` on all four, with a message naming the `id`/`shelter id` problem — **not** `500`. |
| C16 | #25 | Staff (API) | `POST /api/shelters` with `status: ""`, then `PATCH /api/shelters/:id` with `status: ""`. | `400` on both, `"status must be 'active' or 'inactive'"` — an empty string is rejected, not silently treated as `'active'`. |

## 23. Step 15 — data-changing helpers and cleanup (Phase 3)

**Check-in/check-out tests (C1–C5) need no cleanup** if you check out exactly what you checked in — the shelter returns to its original `capacity_occupied`. If you leave it unbalanced, repeat the opposite action rather than editing the row directly, so the `Shelter_Capacity_Log` trail stays consistent with what actually happened.

**Shelter-management tests (C9–C12) create or modify real rows.** Use a distinctive, reserved name prefix so cleanup only ever touches rows this runbook created — for example `Runbook test shelter` — the same idea as the reserved phone prefix in section 3, applied to shelters instead of requests.

```sql
-- Preview: exactly the shelters created for this runbook.
SELECT shelter_id, name, status, capacity_total, capacity_occupied
FROM Shelters
WHERE name LIKE 'Runbook test shelter%';
```

```sql
-- Safe default: deactivate rather than delete. A shelter_id may already be
-- referenced by Supplies, Volunteer_Tasks, or Shelter_Capacity_Log once it
-- has been used in testing, and deleting it would violate those foreign keys.
UPDATE Shelters SET status = 'inactive'
WHERE name LIKE 'Runbook test shelter%';
```

```sql
-- Only delete if nothing references the shelter_id yet.
DELETE FROM Shelters
WHERE name LIKE 'Runbook test shelter%'
  AND shelter_id NOT IN (SELECT DISTINCT shelter_id FROM Supplies)
  AND shelter_id NOT IN (SELECT DISTINCT shelter_id FROM Volunteer_Tasks WHERE shelter_id IS NOT NULL)
  AND shelter_id NOT IN (SELECT DISTINCT shelter_id FROM Shelter_Capacity_Log WHERE shelter_id IS NOT NULL);
```

If a test shelter you closed in C10/C4 should return to normal afterwards, reopen it rather than leaving it inactive:

```sql
UPDATE Shelters SET status = 'active'
WHERE name LIKE 'Runbook test shelter%'
  AND shelter_id = 123; -- replace with the specific shelter_id you are restoring
```

## 24. Phase 3 — rollback notes

No change to section 13's conclusion: there are no down migrations, and the migration is additive/replace-only (a CHECK constraint, two function bodies, and a view with appended columns), so restoring the pre-migration backup and redeploying the previous builds remains the only reliable rollback.

**One Phase-3-specific addition:** do not roll back the API or Coordinator Dashboard alone while leaving the Phase 3 migration applied. That recreates the exact "new schema, old API" condition in section 21 — the old check-in route would silently report success for check-ins it actually refused. If you roll back, roll back the database and the API together.

## 25. Phase 3 — record sheet

A separate sheet from section 15's, so Phase A/2 and Phase 3 results are not overwritten in the same cells.

| Field | Value |
| --- | --- |
| Date and time (with timezone) | |
| Migration 4 applied (`20261025_phase3_capacity_truth.sql`) | |
| Render deploy commit | |
| Coordinator Dashboard Vercel commit | |
| Phase 3 results (C1–C16) | |
| Synthetic/test shelter names or IDs created | |
| Cleanup performed | |
| Errors observed (browser console, Network, Render logs) | |

## 26. Phase 4 — overview

Phase 4 touches **the public-facing path only**: `find_nearest_shelters()`, `server/routes/aidRequests.js`'s `POST /` validation, `server/routes/auth.js`'s registration validation, a new `server/routes/events.js`, and the **Public Portal**'s `RequestForm.tsx` and `FindShelter.tsx`. It does not touch `Shelters` DDL, `Aid_Requests` DDL, `Request_Needs`, `Allocations`, or anything under `coordinator-dashboard/`.

| Needs a change? | Answer |
| --- | --- |
| Database migration | **Yes** — `database/migrations/20261025_phase4_portal_trust.sql`, which replaces only `find_nearest_shelters()`. |
| Render (API) redeploy | **Yes** — new `GET /api/events`; `POST /api/aid-requests` and `POST /api/auth/register` / `POST /api/auth/register/staff` gain real field validation (previously presence-only). |
| Vercel — Public Portal redeploy | **Yes** — `RequestForm.tsx` and `FindShelter.tsx` both change substantially. |
| Vercel — Coordinator Dashboard redeploy | **No.** Phase 4's diff does not touch any file under `coordinator-dashboard/`. Redeploying it is harmless but unnecessary. |
| New environment variable | **No.** Same as every earlier phase. |

## 27. Phase 4 — prerequisites

Confirm Phase A and Phase 2 via **section 6's preflight**, not repeated here. Phase 4 has **no functional dependency** on either — `find_nearest_shelters()`, the new validation in `aidRequests.js`/`auth.js`, and `events.js` all reference columns and tables that existed before Phase A or Phase 2 (`Shelters`, `Aid_Requests`, `Users`, `Disaster_Events`). You can apply this migration on a database that has only the original `schema.sql` baseline.

**Data prerequisite — the event selector (#74):** `GET /api/events` filters on `end_date IS NULL OR end_date >= CURRENT_DATE`. `database/seed.sql` now sets an approximate `end_date` two months after `start_date` on every historical event, leaving only the two 2026 entries open — but `seed.sql` only runs on a fresh install, and **the already-seeded Supabase database still has `end_date = NULL` on all 15 rows**. Run the one-step update in section 33 before testing T6, otherwise the dropdown lists every disaster back to 1990.

**Phase 3 dependency:** T7's browse-all list reads `is_active` from `GET /api/shelters`, which only exists once the Phase 3 migration (sections 16–25) is applied. Apply Phase 3 first. Without it the portal's filter degrades to showing every shelter rather than hiding any — nothing breaks, but closed shelters cannot be excluded.

## 28. Step 10 — Phase 4 preflight: what the database already has

`pg_get_function_result` on a `RETURNS TABLE` function returns its full column list as one string — the simplest way to check column count without naming each one individually:

```sql
SELECT pg_get_function_result('find_nearest_shelters(numeric,numeric,int,int)'::regprocedure) AS nearest_return_type;
```

Expected on a database that has not run the Phase 4 migration:
```
TABLE(shelter_id integer, name character varying, distance_km numeric, available_space integer)
```
After the migration, this grows to nine columns (`latitude`, `longitude`, `address`, `contact_number`, `has_space` appended) — see section 30's exact expected string.

**No constraint-violation check is needed for this migration.** Unlike Phase 3's `Shelters.status` constraint, this migration adds no `CHECK`, no `NOT NULL`, and no unique index — it only replaces a function body and widens its return columns. There is nothing existing data could violate.

## 29. Step 11 — apply the Phase 4 migration

| # | File | What it changes | Needed? |
| --- | --- | --- | --- |
| 5 | `database/migrations/20261025_phase4_portal_trust.sql` | Drops and recreates `find_nearest_shelters(numeric,numeric,int,int)` (drops it first, since its `RETURNS TABLE` column list grows from four columns to nine — `CREATE OR REPLACE FUNCTION` cannot do that). The `WHERE` clause no longer excludes shelters that are too small for `req_space`; instead the result is ordered `has_space DESC, distance_km ASC`, so a full shelter still appears (flagged `has_space = false`) instead of disappearing. | **Yes** if section 28's query returned the four-column form. |

This file is listed as **migration 5** in `database/migrations/README.md`, after Phase 3's migration 4. Apply them in that numbered order: the directory sorts both Phase 3 and Phase 4 ahead of migration 3 by filename, because they were authored on branches.

**Idempotency:** safe to re-run. `DROP FUNCTION IF EXISTS` precedes the `CREATE FUNCTION`, so re-running the file drops and recreates cleanly every time.

**Side effects to expect, not bugs:**
- `get_priority_queue()` (Phase A/2) also calls `find_nearest_shelters()`, selecting only `nearby.name`, `nearby.distance_km`, `nearby.available_space` by position from a `LEFT JOIN LATERAL`. Those three columns keep the same name, type, and position in the new nine-column result, so `get_priority_queue()` is **unaffected** and needs no change — verified by reading its definition in `schema.sql`, not assumed.
- No table, trigger, or view changes. No data backfill.

## 30. Step 12 — verify the Phase 4 schema landed

```sql
SELECT pg_get_function_result('find_nearest_shelters(numeric,numeric,int,int)'::regprocedure);
```

Expected after the migration:
```
TABLE(shelter_id integer, name character varying, distance_km numeric, available_space integer, latitude numeric, longitude numeric, address text, contact_number character varying, has_space boolean)
```

A quick functional check in the same editor — pick any two shelters, one with room and one full, near the same point, and confirm the full one is still returned:

```sql
SELECT shelter_id, name, has_space, available_space
FROM find_nearest_shelters(10.0, 76.0, 1, 10)
ORDER BY has_space DESC;
-- Expected: shelters with has_space = true appear first; a full shelter
-- (has_space = false) still appears instead of being silently dropped.
```

## 31. Step 13 — deploy order and hazards (Phase 4)

**If the new Public Portal deploys before the migration runs** (unmigrated database still returns the old four-column shape):

`FindShelter.tsx` reads `shelter.has_space`, `shelter.latitude`, `shelter.longitude`, `shelter.address`, and `shelter.contact_number` from every result. On the old shape these are simply absent from the JSON — `undefined` in the browser, not `null`. Verified directly:

- The free-space label is built from `shelter.available_space` and `shelter.has_space`. The old shape does still return `available_space`, but `has_space` is absent — `undefined`, which is falsy — so **every shelter is labelled "not enough for your group"**, even one with plenty of room. This is a visible, misleading regression, not a crash.
- The map-marker filter is `shelters.filter((shelter) => shelter.latitude !== null && shelter.longitude !== null)`. `undefined !== null` evaluates to **`true`** in JavaScript — confirmed directly — so shelters with no `latitude` field at all still pass this filter. The component then renders `<Marker position={[Number(shelter.latitude), Number(shelter.longitude)]}>`, and `Number(undefined)` is `NaN` — confirmed directly. A Leaflet marker constructed from `NaN` coordinates does not throw in this codebase's usage, but it does not appear at a meaningful position either; treat any marker that appears to sit at the map's corner or vanish on zoom as this symptom, not a new bug.
- "Directions"/"Call" links (`shelter.contact_number`, `shelter.latitude`) simply don't render, since their guards (`{shelter.contact_number && ...}`) correctly treat `undefined` as absent — this part degrades gracefully.

**If the migration runs before the new Public Portal deploys:** no hazard. The *old* `FindShelter.tsx` never reads the five new columns, so it keeps working exactly as before — it just doesn't gain the new behaviour until it redeploys. `GET /api/shelters/nearest` itself is unchanged code (`server/routes/shelters.js` is not part of this phase's diff); it blindly returns whatever `find_nearest_shelters()` currently returns, so there is nothing to break on the API side either direction.

**`server/routes/aidRequests.js`, `auth.js`, and the new `events.js` have no migration dependency at all** — their validation and the events query only touch columns that existed before this phase. Deploying the API ahead of or behind the migration is safe for those three.

**Safest order:** apply the migration first, confirm with section 30, then deploy the API, then the Public Portal.

**Proof the new API build is live** (no mutation):

```bash
curl -i https://<render-host>/api/events
```
- Old API: Express's default 404 (`Cannot GET /api/events`) — the route did not exist.
- New API: `200` with a JSON array (possibly all 15 seeded events — see section 27). A `200` here, with no token required, is the "it's live" signal.

## 32. Step 14 — Phase 4 functional checks

Run these against the deployed Public Portal unless marked "API". No staff account is needed — the public-facing routes are unauthenticated by design.

| ID | Issue | Action | Expected |
| --- | --- | --- | --- |
| T1 | #67 | On **Request help**, try to type more than 100 characters into **Full name**, or more than 15 into **Phone number**. | The input simply stops accepting characters — `maxLength` matches the limits now (previously 120/30, which exceeded the database's `VARCHAR(100)`/`VARCHAR(15)`). Separators are dropped as you type rather than counted, so pasting `+91 98765 43210` keeps all 13 characters instead of being truncated to something that is no longer the right number. |
| T2 | #68 | API: `POST /api/aid-requests` with `num_people: 0`, or `urgency_level: 9`, or `request_type: "alien"`. | `400` with a specific message for each — `"num_people must be a positive whole number"`, `"urgency_level must be a whole number from 1 to 5"`, `"request_type must be one of: shelter, medical, food, rescue"`. None of these should ever produce a `500`. A phone number typed with separators is accepted: `phone: "+91 98765 43210"` returns `201` and stores `+919876543210`. |
| T3 | #68 | API: `POST /api/aid-requests` with `latitude` set but `longitude` omitted. | `400`, `"latitude and longitude must both be provided together"`. |
| T4 | #68 | API: `POST /api/aid-requests` with `event_id: 999999` (or any ID that doesn't exist). | `400`, `"event_id does not reference an existing disaster event"` — **not** `500`. |
| T5 | #69 | Submit a valid request on **Request help**. | The confirmation screen shows **"Your reference number is #&lt;id&gt;."** with the exact ID the API returned — not discarded. |
| T6 | #74 | Open **Request help** and look at the event selector (only rendered when more than one event is returned). | After section 33's update, only the events that have no `end_date` or a future one are listed — on the seeded data, the two 2026 entries, most recent first. If you skip that update, all 15 appear back to 1990; that is the stale `end_date` data, not a filter bug. Selecting one sends that `event_id`; leaving "Not sure / general request" sends `event_id: null`. |
| T7 | #38 | In **Find a shelter**, press **Browse all shelters**. | A full list appears with occupied/total counts, with no location requested and no distance shown. Only shelters that are not marked **Inactive** are listed — a shelter you closed in section 22 (`ShelterBoard`) is absent here, because the public list and the coordinator board must not disagree about whether a shelter is open. |
| T8 | #38 | On **Find a shelter**, click **Pick on map** instead of **Use my location**. | A map appears centered on a default view; clicking anywhere on it immediately searches from that point — no GPS permission prompt at all. |
| T9 | #39 | On **Find a shelter**, set **People in your household** to a number larger than any single shelter's free space, then search by location. | Results still return (not empty); a result whose free space is below the household size shows its count with **"not enough for your group"** against it, driven by the `has_space` flag — labelled, not omitted. |
| T10 | #40 | Search by location near at least one shelter. | The map shows a pin for **every returned shelter**, not only the user's own position, each poppable to the shelter's name and space count. |
| T11 | #41 | Search by location where the nearest shelter is full. | That shelter still appears in the results list (not hidden), labelled with its free-space count and **"not enough for your group"**, with address and a **Call**/**Directions** link if `contact_number`/coordinates are present — not an empty state. |
| T12 | regression | On the Coordinator Dashboard, open **Priority queue** or **Allocation** as staff. | Unaffected — Phase 4 touches no coordinator-dashboard code; behaves exactly as sections 10/11 describe. |

## 33. Step 15 — data-changing helpers and cleanup (Phase 4)

**Most Phase 4 checks are read-only** (T6–T11 only read data) or create a request that behaves like any other synthetic request from section 11.1 — use the same reserved phone prefix, and the same cleanup in section 12 removes them (it already deletes `Request_Needs` and `Allocations` rows for the prefix before deleting the request itself, which also covers the needs this phase's requests may carry).

**Required before T6 — close the historical events on the already-seeded database.** Two months after `start_date` is the same approximation `seed.sql` now uses; the two 2026 entries stay open.

```sql
-- Preview: exactly the rows this will close.
SELECT event_id, name, start_date
FROM Disaster_Events
WHERE end_date IS NULL AND start_date < DATE '2026-01-01';
```

```sql
UPDATE Disaster_Events
SET end_date = start_date + INTERVAL '2 months'
WHERE end_date IS NULL AND start_date < DATE '2026-01-01';
```

Idempotent — re-running matches nothing once every historical event has an `end_date`. To undo it: `UPDATE Disaster_Events SET end_date = NULL WHERE start_date < DATE '2026-01-01';`.

**To see the single-active-event auto-select path**, temporarily close one of the two remaining 2026 rows as well (`UPDATE Disaster_Events SET end_date = CURRENT_DATE - INTERVAL '1 day' WHERE event_id = <id>;`), check that the selector disappears and the request is submitted with that event already attached, then set its `end_date` back to `NULL`.

## 34. Phase 4 — rollback notes

No change to section 13's conclusion. This migration is replace-only (one function body, recreated from scratch after an explicit drop) — restoring the pre-migration backup and redeploying the previous builds remains the only reliable rollback, and there is nothing additive to partially undo.

**No Phase-4-specific hazard on rollback**, unlike Phase 3: rolling back only the Public Portal while leaving this migration applied is safe — the old frontend simply ignores the five new columns. Rolling back only the API is also safe for the same reason. The one direction that is not safe is already covered in section 31: deploying the **new** Public Portal before the migration runs.

## 35. Phase 4 — record sheet

A separate sheet from sections 15 and 25 (Phase 3), so results are not overwritten in the same cells.

| Field | Value |
| --- | --- |
| Date and time (with timezone) | |
| Migration applied (`20261025_phase4_portal_trust.sql`) | |
| Render deploy commit | |
| Public Portal Vercel commit | |
| Phase 4 results (T1–T12) | |
| Synthetic request IDs created (reserved phone prefix) | |
| Disaster_Events temporarily closed for T6, if used | |
| Cleanup performed | |
| Errors observed (browser console, Network, Render logs) | |

---

# Phase 5 addendum — Guardrails

This addendum covers Phase 5 only (issues #76–#82, FRONTEND_AUDIT.md items 46–52). It assumes the stack described above is live and adds no new service: the same Render API, two Vercel frontends, one Supabase database. Where Phase 4 changed what the portal *shows*, Phase 5 changes who may *write*, and what is recorded when they do.

**Read it as the last step of the same sitting.** Migration 6 goes after migration 5 in 0.4's order, and most of these checks are clicks rather than SQL: eleven of the sixteen need no SQL from you at all, and the other five (G12–G16) are the ones that read or write the new schema.

## 36. Phase 5 — overview

Phase 5 touches the **authorization path**: `server/middleware/auth.js` (one token check shared by HTTP and Socket.IO), `server/lib/shelterAccess.js` (new), `server/index.js` (CORS allowlist, security headers, socket handshake), `server/routes/auth.js` (`GET /api/auth/me`, login throttling), `server/routes/shelters.js` and `server/routes/supplies.js` (role and ownership checks), the Coordinator Dashboard's session restore, socket token and per-shelter controls, and one migration.

It does not touch `Aid_Requests`, `Request_Needs`, `Allocations`, `allocate_supply()`, `get_priority_queue()`, `find_nearest_shelters()` or any file under `public-portal/`.

| Needs a change? | Answer |
| --- | --- |
| Database migration | **Yes** — `database/migrations/20261027_phase5_guardrails.sql`, three backwards-compatible additions. |
| Render (API) redeploy | **Yes**, and it must follow the migration (section 41). |
| Vercel — Coordinator Dashboard redeploy | **Yes** — session restore, socket token, ownership-aware controls. |
| Vercel — Public Portal redeploy | **No.** No file under `public-portal/` changes. It only has to be an allowed origin, and both production aliases already are. |
| New environment variable | **No.** `CORS_ORIGINS` is optional (section 37). |
| Accounts | A `Volunteer`, and **two** staff accounts — one `Admin`, one `ShelterCoordinator` assigned to a shelter. |

## 37. Phase 5 — prerequisites

**Phase 5 has no functional dependency on Phases A–4.** Migration 6 touches only `Shelter_Capacity_Log`, `Volunteer_Tasks`, `Shelter_Live_Status`, `Shelters` and the two capacity functions — all present in the original baseline. You can apply it on an unmigrated database; there is simply no reason to, since 0.4 has you running everything in one sitting and the earlier phases provide most of the data these checks read.

**Accounts, not permissions, are the real prerequisite.** Ownership checks are only provable with two staff accounts:

```sql
-- Who is assigned what? Run this before G4/G5 so you know which shelter to use.
SELECT s.shelter_id, s.name, s.coordinator_id, u.name AS coordinator, u.role
FROM Shelters s
LEFT JOIN Users u ON u.user_id = s.coordinator_id
ORDER BY s.shelter_id;
```

A shelter with `coordinator_id = NULL` is managed by nobody: only an `Admin` can act on it, and its row will read "Managed by another coordinator." on a coordinator's board. That is the rule working, not a bug — assign it if you want to test the allowed path.

```sql
-- The accounts, and their roles.
SELECT user_id, name, role FROM Users ORDER BY user_id;
```

**`CORS_ORIGINS` is optional.** Leaving it unset is supported and is what the deployed aliases rely on. If you set it, it becomes the entire allowlist — comma-separated, exact origins, scheme included, no trailing slash — and the Vercel-preview pattern stops applying, so a preview URL has to be listed explicitly or it will be blocked. Changing it needs a Render redeploy to take effect.

**Nothing else changes.** `JWT_SECRET` stays as it is (rotating it logs everyone out, which is a separate decision), `DATABASE_URL` is untouched, and neither frontend gains a variable — the dashboard reads the token it already stored under `reliefgrid_token`.

## 38. Step 16 — Phase 5 preflight: what the database already has

Read-only. Confirms which parts of migration 6, if any, have landed:

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shelter_capacity_log'
      AND column_name IN ('changed_by','change_type'))                        AS capacity_log_actor_columns,
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'shelter_capacity_log_change_type_allowed')        AS change_type_check,
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'volunteer_tasks_status_allowed')                  AS task_status_check,
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'shelter_live_status'
             AND column_name = 'coordinator_id')                              AS view_has_coordinator_id,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('checkin_to_shelter','checkout_from_shelter')
      AND pg_get_function_arguments(p.oid) LIKE '%p_changed_by%')             AS capacity_functions_take_actor;
```

Expected before the migration: `capacity_log_actor_columns` = `0`, and `false, false, false, 0`.
Expected after: `2`, and `true, true, true, 2` — both functions, not one. A `1` here means a previous run stopped between the two function definitions; re-apply the file (it is idempotent) before continuing.

**The one data check that matters.** Migration 6 rewrites `Volunteer_Tasks` rows whose `status` it does not recognise, and it does not keep the old value. Look first:

```sql
SELECT status, count(*) FROM Volunteer_Tasks GROUP BY status ORDER BY 2 DESC;
```

Expected on the seeded database: a single row, `pending`. Anything outside `pending` / `in_progress` / `done` / `blocked` / `cancelled` comes out of the migration as `pending`, with a `NOTICE` naming the count — record it here before you run the file, from section 45's sheet, if the distinction matters.

## 39. Step 17 — apply the Phase 5 migration

| # | File | What it changes | Needed? |
| --- | --- | --- | --- |
| 6 | `database/migrations/20261027_phase5_guardrails.sql` | Adds `changed_by` and `change_type` to `Shelter_Capacity_Log` (with a CHECK over `checkin`/`checkout`/`correction`) and redefines `log_capacity_change()` to read the actor from a transaction-local setting; rebuilds `checkin_to_shelter()` and `checkout_from_shelter()` with a defaulted third parameter `p_changed_by`; normalises `Volunteer_Tasks.status` and adds its CHECK; appends `coordinator_id` to `Shelter_Live_Status`. | **Yes** if section 38 reported `capacity_log_actor_columns = 0`. |

Paste it into the Supabase SQL editor on its own, after migration 5, exactly as the earlier files were applied — one file per query.

**Idempotency:** safe to re-run. Columns use `IF NOT EXISTS`, both constraints sit inside guarded `DO $$` blocks keyed on `pg_constraint`, both functions are dropped before being recreated, and the view uses `CREATE OR REPLACE VIEW` with the new column appended. Applying it twice to a Phase-4 database was verified: the second run printed *does not exist, skipping* for the two-argument signatures and changed nothing else.

**Side effects to expect, not bugs:**

- **The two-argument functions are gone as signatures, but not as calls.** `checkin_to_shelter(1, 2)` still works and resolves to the three-argument function via the default. It records `changed_by = NULL`. Verified: the two-argument call returns `ok` and writes a log row with no actor; the three-argument call returns `ok` and writes the id you passed.
- **A direct `UPDATE Shelters SET capacity_occupied = …` from the SQL editor still works.** The trigger reads an unset setting as `NULL`, so the log row has `changed_by` and `change_type` both `NULL` rather than the write failing. Verified.
- **`change_type` may be `NULL`.** The CHECK allows it, precisely so that psql path is not blocked. Only the routes set a value.
- **The view gains a column; nothing is reordered.** `coordinator_id` is appended last, so `CREATE OR REPLACE VIEW` stays valid and every existing `SELECT` keeps its column order.
- **No table is rebuilt and no data is migrated**, other than the `Volunteer_Tasks.status` normalisation described in section 38.

## 40. Step 18 — verify the Phase 5 schema landed

Four structural queries, then one functional proof. All four must match.

```sql
-- 1. The capacity log now carries an actor and a change type.
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'shelter_capacity_log'
ORDER BY ordinal_position;
-- Expected: log_id, shelter_id, capacity_occupied, logged_at,
--           changed_by (integer), change_type (character varying, 20)

-- 2. Both CHECKs exist.
SELECT conname FROM pg_constraint
WHERE conname IN ('shelter_capacity_log_change_type_allowed','volunteer_tasks_status_allowed')
ORDER BY conname;
-- Expected: both rows, two rows total.

-- 3. Both capacity functions take the actor.
SELECT p.oid::regprocedure AS signature, pg_get_function_result(p.oid) AS returns,
       pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('checkin_to_shelter','checkout_from_shelter')
ORDER BY 1;
-- Expected: two rows, both character varying, both ending
--           p_changed_by integer DEFAULT NULL::integer

-- 4. The view exposes the assigned coordinator.
SELECT string_agg(attname, ',' ORDER BY attname)
FROM pg_attribute
WHERE attrelid = 'shelter_live_status'::regclass AND attnum > 0;
-- Expected: capacity_occupied,capacity_total,coordinator_id,event_id,event_name,is_active,name,occupancy_pct,shelter_id,status
```

Then prove the actor path actually reaches the log, and that the two-argument compatibility path still works. This writes **two** capacity-log rows and changes occupancy twice, so use a shelter you are already exercising and undo it afterwards.

```sql
-- Your own user id, so the actor is a real account.
SELECT user_id, name, role FROM Users ORDER BY user_id;

-- 3-argument: records the actor.
SELECT checkin_to_shelter(<shelter_id>, 1, <your_user_id>) AS with_actor;
-- 2-argument: still works, records no actor.
SELECT checkin_to_shelter(<shelter_id>, 1) AS without_actor;

SELECT log_id, shelter_id, capacity_occupied, changed_by, change_type
FROM Shelter_Capacity_Log ORDER BY log_id DESC LIMIT 2;
-- Expected, newest first: changed_by NULL and change_type 'checkin';
--                        then changed_by = <your_user_id>, change_type 'checkin'.

-- Put the two back.
SELECT checkout_from_shelter(<shelter_id>, 2, <your_user_id>);
```

And the constraint refuses a value the app does not understand — expect `23514`, with nothing written:

```sql
INSERT INTO Volunteer_Tasks (shelter_id, description, status)
VALUES (1, 'runbook constraint probe', 'almost done');
-- ERROR: new row for relation "volunteer_tasks" violates check constraint
--        "volunteer_tasks_status_allowed"
```

## 41. Step 19 — deploy order and hazards (Phase 5)

Phase 5 has **one dangerous direction and one safe one**, and they are not symmetric:

**If the new API deploys before migration 6 runs — check-in and check-out break outright.** The routes call `checkin_to_shelter($1, $2, $3)`; on an unmigrated database only the two-argument function exists, so Postgres answers `42883 undefined_function` and the route's catch-all returns `500 "Check-in failed"` / `500 "Check-out failed"`. Loud, obvious, and limited to those two routes: the queue, allocation, the board's read path and both frontends keep working, because `allocate_supply()` and the views are untouched. Fix: apply migration 6.

**If migration 6 runs before the new API deploys — nothing breaks.** The old API calls the two-argument form, which still resolves through the default, so check-ins succeed and the capacity log records `changed_by = NULL`. The only loss is attribution, for the duration of the gap. This is the safe direction, and it is why 0.4 puts migration 6 at step 10 and the deploy at step 12.

**If the new Coordinator Dashboard deploys before migration 6 — the board looks dead, without an error.** The board decides whether to offer controls with `user.role === 'Admin' || shelter.coordinator_id === user.user_id`. On a view without `coordinator_id`, that field is `undefined` in the browser, the comparison is false for every row, and every shelter reads **"Managed by another coordinator."** with no Check in button. Nothing throws, nothing appears in the console, and the API would in fact have allowed an Admin. Apply the migration and reload.

**Safest order:** migration 6 (step 10) → verify with section 40 → deploy the API → deploy the Coordinator Dashboard. The Public Portal needs no redeploy for this phase, but if you have already redeployed it, confirm it is still an allowed origin (section 37).

**Proof the new API build is live** (no token, no mutation):

```bash
curl -i https://<render-host>/api/auth/me
```

- Old API: `404`, `Cannot GET /api/auth/me` — the route did not exist.
- New API: `401` with a message — the route exists and `requireAuth` ran. A `401` here is the signal, not a failure.

```bash
curl -sI https://<render-host>/health
```

The new build answers without `x-powered-by` and with `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer` and `content-security-policy: default-src 'none'; frame-ancestors 'none'`. `strict-transport-security` appears only because Render terminates TLS and forwards `x-forwarded-proto`.

## 42. Step 20 — Phase 5 functional checks

Two staff accounts and a `Volunteer`, unless a row says otherwise. G7–G11 are browser-console or `curl` checks and need no database work at all; G12–G16 are the ones that read or write the new schema.

| ID | Issue | Role needed | Action | Expected |
| --- | --- | --- | --- | --- |
| G1 | #76 | Any staff | Sign in, then press **F5**. | The dashboard returns to the same screen with the header still showing your name and role. A brief "Restoring your session…" state is correct; a flash of the sign-in form is not. Network shows `GET /api/auth/me` → `200`. |
| G2 | #76 | API | `GET /api/auth/me` with no `Authorization` header, then with a staff token. | `401` with a message naming the header, then `200` with `user_id`, `name`, `role` — read from `Users`, not from the token. |
| G3 | #77 | Volunteer | With a `Volunteer` token, call `POST /api/shelters/:id/checkin`, `POST /api/shelters/:id/checkout`, `POST /api/supplies/allocate`, `POST /api/shelters` and `PATCH /api/shelters/:id`. | `403 "Insufficient permissions"` on all five. Occupancy and stock unchanged, and no capacity-log row is written. |
| G4 | #78 | ShelterCoordinator | Sign in as the coordinator assigned to shelter A and look at a shelter assigned to B on **Live shelter board**. | A's row offers Check in / Edit; B's row reads **"Managed by another coordinator."** with no controls. Calling `POST /api/shelters/<B>/checkin` directly returns `403` with a message naming the assignment. |
| G5 | #78 | ShelterCoordinator, then Admin | As the coordinator, `PATCH /api/shelters/<own>` with someone else's `coordinator_id`; then repeat as the `Admin`. | Coordinator: `403 "Only an Admin can assign a shelter to another coordinator"` (or the reassign wording on `PATCH`). Admin: `200`, and the board's ownership moves on the next load. |
| G6 | #78 | ShelterCoordinator | Allocate stock that is held at another coordinator's shelter. | `403` naming the assignment. As `Admin`: allowed. Stock held at no shelter (`Supplies.shelter_id IS NULL`) is refused for a coordinator with "only an Admin can allocate it". |
| G7 | #79 | Any staff | Sign in, then delete `reliefgrid_token` from **Application → Local Storage** and force a reconnect with DevTools → Network → **Offline**, then **Online**. | The socket is refused: the live-status indicator stays `Disconnected · queue may be stale` and never returns to `Live`, and the console records a `connect_error` naming `unauthorized`. Signing in again restores it. |
| G8 | #79 | Any staff | With the dashboard open and connected, submit a request on the Public Portal and watch **Network → WS → Messages**. | The `new-aid-request` frame carries `request_id` only — no requester name, no phone. `supply-allocated` likewise carries ids, quantity, need id and status only. |
| G9 | #80 | API | `curl -i -H "Origin: https://evil.example" https://<render-host>/api/shelters`, then with `Origin: https://relief-grid-five.vercel.app`. | Foreign origin: **no** `access-control-allow-origin` header. Allowed origin: the header echoes that origin. The server answers in both cases — the browser is what refuses to expose the response, which is why the blocked request shows no status in DevTools. |
| G10 | #80 | API | `curl -sI https://<render-host>/health`. | `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, `content-security-policy: default-src 'none'; frame-ancestors 'none'`, `cross-origin-resource-policy: same-site`, and **no** `x-powered-by`. `strict-transport-security` present over https. |
| G11 | #80 | API, test account | Sign in with the wrong password six times for the same phone number, then with the right one; then sign in as a different account. | The sixth answer (and any after it) is `429` with a `Retry-After` header. The **other** account still signs in — the limit is keyed to the number and caller, not global. The locked account works again after 15 minutes or a Render restart. Run this last: it locks that account out for 15 minutes by design. |
| G12 | #81 | ShelterCoordinator | Check someone in and out on the board, then query the log. | `SELECT changed_by, change_type FROM Shelter_Capacity_Log ORDER BY log_id DESC LIMIT 2;` → the newest rows carry your `user_id` and `checkin` / `checkout`. Before Phase 5 they carried neither column at all. |
| G13 | #81 | API | In the SQL editor, call the two-argument form: `SELECT checkin_to_shelter(<shelter_id>, 1);` and `SELECT checkout_from_shelter(<shelter_id>, 1);`. | Both return `ok`, proving old callers (test scripts, psql, a not-yet-redeployed API) are not broken. The log rows they write have `changed_by = NULL` — the honest record, not a fabricated actor. |
| G14 | #82 | API | Run the `INSERT … 'almost done'` probe from section 40, then `UPDATE Volunteer_Tasks SET status = 'blocked' WHERE task_id = <id>;` and set it back to `pending`. | The `INSERT` fails with `23514`; the valid `UPDATE` succeeds. Five states accepted, everything else refused. |
| G15 | #82 | API | `UPDATE Aid_Requests SET status = 'done-ish' WHERE request_id = <id>;` and `UPDATE Shelters SET status = 'closed-ish' WHERE shelter_id = <id>;`. | Both fail with `23514` — `aid_requests_status_allowed` and `shelters_status_valid` respectively. Nothing is written, so there is nothing to undo. |
| G16 | #76 | Admin | Change a test user's role: `UPDATE Users SET role = 'Volunteer' WHERE user_id = <id>;`, have them reload, then set it back and reload again. | The header and the available tabs follow the database, not the token: staff-only tabs disappear, then return. This is the `/api/auth/me` path from G1 doing its job, and it is the reason a revoked role takes effect on reload. |

**Regression, worth one glance:** P7's **Recorded by** and P10's `403` are unchanged by this phase. If they regress, Phase 5 broke the allocation route — `P10` in particular should still be `401` then `403`, not `500`.

## 43. Step 21 — data-changing helpers and cleanup (Phase 5)

Most Phase 5 checks are read-only or refuse before writing. What they leave behind:

- **`Shelter_Capacity_Log` rows from G12, G13 and section 40.** These are the feature, not litter: deleting them removes the evidence that attribution works. If you must tidy up, do it only for the shelter you tested, and record the count first. Check out exactly what you checked in so occupancy returns to where it started rather than being edited directly.
- **`Volunteer_Tasks` G14** leaves the row you touched at the status you set. Set it back to its original value; the failed `INSERT` and the two `23514` updates in G15 write nothing.
- **Login throttling (G11)** keeps its counters in the Render process's memory. They expire after 15 minutes or on restart; there is no table to clean.
- **No shelter or request rows are created by this phase's checks**, so sections 12 and 23's cleanup still covers everything created earlier. The two capacity-log rows from section 40's actor proof are the only new rows that need a decision, and the recommendation is to leave them.
- **`CORS_ORIGINS`, if you set it,** stays in Render's environment. Removing it restores the built-in allowlist on the next deploy; nothing in the database remembers it.

## 44. Phase 5 — rollback notes

There are still no down migrations, and section 13's conclusion stands: restoring the pre-migration backup and redeploying the previous builds is the only reliable rollback.

**The one rule specific to this phase:** do not restore the database while leaving the Phase 5 API live. That is the `42883` condition from section 41 — every check-in and check-out answers `500` — and unlike Phase 3's hazard, it fails loudly, so it is at least discoverable. Rolling back only the **Coordinator Dashboard** while the Phase 5 API and schema stay in place is safe: the old board offers check-in buttons on shelters it does not own, and the API refuses them with `403`, which is a confusing UI but never a wrong write. Rolling back only the **API** while keeping the schema is also safe, for the reason in section 39: the old code's two-argument calls still resolve.

## 45. Phase 5 — record sheet

A separate sheet again, so nothing above is overwritten.

| Field | Value |
| --- | --- |
| Date and time (with timezone) | |
| Migration 6 applied (`20261027_phase5_guardrails.sql`) | |
| Section 38 preflight before (`capacity_log_actor_columns` / flags) | |
| `Volunteer_Tasks.status` values seen before migrating | |
| `NOTICE` reported by migration 6 (rows normalised) | |
| Section 40 verification — all four queries matched? | |
| Actor proof: `changed_by` recorded for the 3-argument call, NULL for the 2-argument one | |
| Render deploy commit | |
| Coordinator Dashboard Vercel commit | |
| Public Portal redeployed for this phase? (should be no) | |
| `CORS_ORIGINS` — set or unset (never the value) | |
| Accounts used: Admin / ShelterCoordinator / Volunteer | |
| Shelters used, and their `coordinator_id` | |
| Phase 5 results (G1–G16) | |
| Capacity-log rows left by this run (shelter id and count) | |
| Errors observed (browser console, Network, Render logs) | |
