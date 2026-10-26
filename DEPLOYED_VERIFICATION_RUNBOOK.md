# ReliefGrid — Deployed Verification Runbook (Phase A + Phase 2)

**Purpose:** verify Phase A (triage) and Phase 2 (request needs and partial fulfilment) against the deployed Public Portal, Coordinator Dashboard, Render API and Supabase database. No local server or local frontend is needed.

**Scope:** this runbook starts from a deployed stack whose database has **not yet been migrated**. It tells you what to run in Supabase, what to deploy, and what to click afterwards. It replaces the earlier Phase A–only document.

**Not a substitute for:** the local checks in `server/tests/` (`npm run test:allocation` covers the allocation contract against any disposable PostgreSQL). Those prove the database and API contract; this runbook proves the deployed wiring, permissions and UI behaviour.

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

**Neither phase needs a new environment variable.** If a check fails, suspect a stale build or an unapplied migration before suspecting configuration.

## 2. Deployed endpoints

These were the URLs recorded when the runbook was written. The hosting dashboards are the source of truth — if a link has changed, use the current Production URL.

| Service | Hosting | URL |
| --- | --- | --- |
| Public Portal | Vercel → `relief-grid-publicportal` | <https://relief-grid-five.vercel.app/> |
| Coordinator Dashboard | Vercel → `relief-grid-coordinator-dashboard` | <https://relief-grid-egia.vercel.app/> |
| API | Render → `reliefgrid-api` | <https://reliefgrid-api-6o4j.onrender.com> |

Render's free instance sleeps when idle; the first request after a quiet period can take 50 seconds or more. A slow first load is not a failure.

## 3. Before you start

- **Use an authorized staff account** with the `Admin` or `ShelterCoordinator` role. Those roles can see requester contact details, record a priority review, and allocate stock. A `Volunteer` account can read the queue with contact details blanked, but gets `403` on allocation and review.
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
SELECT
  pg_get_function_result('checkin_to_shelter(int,int)'::regprocedure)        AS checkin_return_type,
  to_regprocedure('checkout_from_shelter(int,int)') IS NOT NULL              AS checkout_exists,
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'shelters_status_valid'
            AND conrelid = 'shelters'::regclass)                            AS status_check_exists,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'shelter_live_status'
            AND column_name = 'is_active')                                  AS view_has_is_active;
```

Expected on a database that has not run the Phase 3 migration: `checkin_return_type = boolean`, `checkout_exists = false`, `status_check_exists = false`, `view_has_is_active = false`.

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

This file is **not listed** in `database/migrations/README.md` (that file only documents migrations 1–3, the Phase A/Phase 2 set) — a human should add it there as migration 4; this addendum does not edit that file.

**Idempotency:** safe to re-run. The status-check block is guarded (`IF NOT EXISTS`); `checkin_to_shelter()` is preceded by an explicit `DROP FUNCTION IF EXISTS`, so re-running the file drops and recreates it cleanly every time rather than failing like Phase A's migration 2 does; `checkout_from_shelter()` uses `CREATE OR REPLACE`; the view uses `CREATE OR REPLACE VIEW`. There is no `psql`-style batch command documented for this file in the repo (only `database/migrations/README.md`'s Phase A/2 batch exists) — paste it into the Supabase SQL Editor as one statement block, the same way migrations 1–3 were applied.

**Side effects to expect, not bugs:**
- The old `checkin_to_shelter(int,int)` **BOOLEAN**-returning function is dropped and replaced. See section 21 for why the deploy order matters here specifically.
- No trigger changes. `checkout_from_shelter()` reuses the existing `trg_log_capacity` trigger (`AFTER UPDATE OF capacity_occupied ON Shelters`) because it updates the same column the same way check-in does — every successful check-out writes a `Shelter_Capacity_Log` row automatically, with no new trigger needed.
- `mv_daily_capacity_trend` is untouched. Because check-outs now also log to `Shelter_Capacity_Log`, the daily trend will show occupancy *decreasing* on days with check-outs once you `REFRESH MATERIALIZED VIEW mv_daily_capacity_trend` — this is new real data, not a bug in the view.
- No data backfill. The one normalisation this migration performs is the `Shelters.status` reset described above — nothing else is touched.
- Both functions now reject `p_num_people <= 0` with `'invalid_quantity'` before taking any lock. The deployed API already validated this client-side, so this only matters for anyone calling the functions directly (test scripts, `psql`, a future caller) — it is not reachable through the current routes.

## 20. Step 12 — verify the Phase 3 schema landed

```sql
-- 1. Check-in must return a status code, not a boolean.
SELECT pg_get_function_result('checkin_to_shelter(int,int)'::regprocedure);
-- Expected: character varying

-- 2. Check-out must exist.
SELECT pg_get_function_arguments('checkout_from_shelter(int,int)'::regprocedure);
-- Expected: p_shelter_id integer, p_num_people integer

-- 3. The status CHECK must be in place.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'shelters_status_valid' AND conrelid = 'shelters'::regclass;
-- Expected: one row, definition CHECK (((status)::text = ANY (ARRAY['active'::character varying, 'inactive'::character varying]::text[])))

-- 4. The view must carry the new columns.
SELECT string_agg(attname, ',' ORDER BY attname)
FROM pg_attribute
WHERE attrelid = 'shelter_live_status'::regclass AND attnum > 0;
-- Expected: capacity_occupied,capacity_total,event_id,event_name,is_active,name,occupancy_pct,shelter_id,status
```

Query 1 must not error and must not say `boolean` — either means the drop/recreate did not happen.

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

| ID | Issue | Role needed | Action | Expected |
| --- | --- | --- | --- | --- |
| C1 | #62 | Staff (any authenticated role — check-in/out is not role-restricted) | Check in a few people, then use the new **Check out** control for fewer people than you just checked in. | `200 {"success": true}`; **Occupancy** drops by exactly that amount; a new row appears in `Shelter_Capacity_Log` for this shelter (same trigger as check-in). |
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
| C12 | #66 | Volunteer | Attempt **Add shelter** or **Edit** (via the API, since the UI hides these controls for this role). | `403`. |
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

**Phase 3 dependency:** T8's browse-all list reads `is_active` from `GET /api/shelters`, which only exists once the Phase 3 migration (sections 16–25) is applied. Apply Phase 3 first. Without it the portal's filter degrades to showing every shelter rather than hiding any — nothing breaks, but closed shelters cannot be excluded.

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

Like Phase 3's file, this is **not listed** in `database/migrations/README.md` (migrations 1–3 only) — a human should add it as migration 4 or 5 depending on whether Phase 3's migration is numbered first; this addendum does not edit that file.

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

- `shelter.has_space ? shelter.available_space : 'Full'` — `undefined` is falsy, so **every shelter in the results list shows "Full · no space"**, even ones with plenty of room. This is a visible, misleading regression, not a crash.
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
| T1 | #67 | On **Request help**, try to type more than 100 characters into **Full name**, or more than 15 into **Phone number**. | The input simply stops accepting characters — `maxLength` matches the limits now (previously 120/30, which exceeded the database's `VARCHAR(100)`/`VARCHAR(15)`). |
| T2 | #68 | API: `POST /api/aid-requests` with `num_people: 0`, or `urgency_level: 9`, or `request_type: "alien"`. | `400` with a specific message for each — `"num_people must be a positive whole number"`, `"urgency_level must be a whole number from 1 to 5"`, `"request_type must be one of: shelter, medical, food, rescue"`. None of these should ever produce a `500`. |
| T3 | #68 | API: `POST /api/aid-requests` with `latitude` set but `longitude` omitted. | `400`, `"latitude and longitude must both be provided together"`. |
| T4 | #68 | API: `POST /api/aid-requests` with `event_id: 999999` (or any ID that doesn't exist). | `400`, `"event_id does not reference an existing disaster event"` — **not** `500`. |
| T5 | #69 | Submit a valid request on **Request help**. | The confirmation screen shows **"Your reference number is #&lt;id&gt;."** with the exact ID the API returned — not discarded. |
| T6 | #74 | Open **Request help** and look at the event selector (only rendered when more than one event is returned). | After section 33's update, only the events that have no `end_date` or a future one are listed — on the seeded data, the two 2026 entries, most recent first. If you skip that update, all 15 appear back to 1990; that is the stale `end_date` data, not a filter bug. Selecting one sends that `event_id`; leaving "Not sure / general request" sends `event_id: null`. |
| T7 | #38 | In **Find a shelter**, press **Browse all shelters**. | Only shelters that are not marked **Inactive** are listed. A shelter you closed in section 22 (`ShelterBoard`) is absent here — the public list and the coordinator board must not disagree about whether a shelter is open. |
| T7 | #38 | On **Find a shelter**, click **Pick on map** instead of **Use my location**. | A map appears centered on a default view; clicking anywhere on it immediately searches from that point — no GPS permission prompt at all. |
| T8 | #38 | On **Find a shelter**, click **Browse all shelters**. | A full list of shelters appears with occupied/total counts, with no location requested and no distance shown. |
| T9 | #39 | On **Find a shelter**, set **People in your household** to a number larger than any single shelter's free space, then search by location. | Results still return (not empty); each result reads **"Full · no space"** if `available_space` is less than the household size for that shelter, per the `has_space` flag — not simply omitted. |
| T10 | #40 | Search by location near at least one shelter. | The map shows a pin for **every returned shelter**, not only the user's own position, each poppable to the shelter's name and space count. |
| T11 | #41 | Search by location where the nearest shelter is full. | That shelter still appears in the results list (not hidden), labelled **"Full"**, with address and a **Call**/**Directions** link if `contact_number`/coordinates are present — not an empty state. |
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
