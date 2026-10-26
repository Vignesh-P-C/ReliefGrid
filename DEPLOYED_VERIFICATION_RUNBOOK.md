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

# Phase 4 addendum — Portal trust

This addendum covers Phase 4 only (issues #67–#74, FRONTEND_AUDIT.md items 34, 35, 36, 38, 39, 40, 41, 42). It assumes the Phase A and Phase 2 deploy described above is already live, and extends the same stack: **one Render API, two Vercel frontends, one Supabase database.** It does not repeat section 6's preflight — run that first if you have not already.

## 16. Phase 4 — overview

Phase 4 touches **the public-facing path only**: `find_nearest_shelters()`, `server/routes/aidRequests.js`'s `POST /` validation, `server/routes/auth.js`'s registration validation, a new `server/routes/events.js`, and the **Public Portal**'s `RequestForm.tsx` and `FindShelter.tsx`. It does not touch `Shelters` DDL, `Aid_Requests` DDL, `Request_Needs`, `Allocations`, or anything under `coordinator-dashboard/`.

| Needs a change? | Answer |
| --- | --- |
| Database migration | **Yes** — `database/migrations/20261025_phase4_portal_trust.sql`, which replaces only `find_nearest_shelters()`. |
| Render (API) redeploy | **Yes** — new `GET /api/events`; `POST /api/aid-requests` and `POST /api/auth/register` / `POST /api/auth/register/staff` gain real field validation (previously presence-only). |
| Vercel — Public Portal redeploy | **Yes** — `RequestForm.tsx` and `FindShelter.tsx` both change substantially. |
| Vercel — Coordinator Dashboard redeploy | **No.** Phase 4's diff does not touch any file under `coordinator-dashboard/`. Redeploying it is harmless but unnecessary. |
| New environment variable | **No.** Same as every earlier phase. |

## 17. Phase 4 — prerequisites

Confirm Phase A and Phase 2 via **section 6's preflight**, not repeated here. Phase 4 has **no functional dependency** on either — `find_nearest_shelters()`, the new validation in `aidRequests.js`/`auth.js`, and `events.js` all reference columns and tables that existed before Phase A or Phase 2 (`Shelters`, `Aid_Requests`, `Users`, `Disaster_Events`). You can apply this migration on a database that has only the original `schema.sql` baseline.

**Data prerequisite — read this before testing the event selector (#74):** `GET /api/events` filters on `end_date IS NULL OR end_date >= CURRENT_DATE`. Checked against `database/seed.sql`: **none of the 15 seeded `Disaster_Events` rows set `end_date` at all** — every one, including the 1990 Andhra Pradesh & Tamil Nadu Cyclone and the other historical entries, has `end_date = NULL`. On the seeded demo database, `GET /api/events` will therefore return **all 15 events**, not just the current one or two. This is not a bug — the filter logic is reasonable given the schema — but it means T6 below will show a long dropdown with decades-old disasters in it, which is expected on this dataset, not a sign the filter is broken. If you want to demonstrate the "exactly one active event auto-selects" behaviour (Audit #42's nicer path), set `end_date` on all but one event first (see section 23's helper).

## 18. Step 10 — Phase 4 preflight: what the database already has

`pg_get_function_result` on a `RETURNS TABLE` function returns its full column list as one string — the simplest way to check column count without naming each one individually:

```sql
SELECT pg_get_function_result('find_nearest_shelters(numeric,numeric,int,int)'::regprocedure) AS nearest_return_type;
```

Expected on a database that has not run the Phase 4 migration:
```
TABLE(shelter_id integer, name character varying, distance_km numeric, available_space integer)
```
After the migration, this grows to nine columns (`latitude`, `longitude`, `address`, `contact_number`, `has_space` appended) — see section 20's exact expected string.

**No constraint-violation check is needed for this migration.** Unlike Phase 3's `Shelters.status` constraint, this migration adds no `CHECK`, no `NOT NULL`, and no unique index — it only replaces a function body and widens its return columns. There is nothing existing data could violate.

## 19. Step 11 — apply the Phase 4 migration

| # | File | What it changes | Needed? |
| --- | --- | --- | --- |
| 5 | `database/migrations/20261025_phase4_portal_trust.sql` | Drops and recreates `find_nearest_shelters(numeric,numeric,int,int)` (drops it first, since its `RETURNS TABLE` column list grows from four columns to nine — `CREATE OR REPLACE FUNCTION` cannot do that). The `WHERE` clause no longer excludes shelters that are too small for `req_space`; instead the result is ordered `has_space DESC, distance_km ASC`, so a full shelter still appears (flagged `has_space = false`) instead of disappearing. | **Yes** if section 18's query returned the four-column form. |

Like Phase 3's file, this is **not listed** in `database/migrations/README.md` (migrations 1–3 only) — a human should add it as migration 4 or 5 depending on whether Phase 3's migration is numbered first; this addendum does not edit that file.

**Idempotency:** safe to re-run. `DROP FUNCTION IF EXISTS` precedes the `CREATE FUNCTION`, so re-running the file drops and recreates cleanly every time.

**Side effects to expect, not bugs:**
- `get_priority_queue()` (Phase A/2) also calls `find_nearest_shelters()`, selecting only `nearby.name`, `nearby.distance_km`, `nearby.available_space` by position from a `LEFT JOIN LATERAL`. Those three columns keep the same name, type, and position in the new nine-column result, so `get_priority_queue()` is **unaffected** and needs no change — verified by reading its definition in `schema.sql`, not assumed.
- No table, trigger, or view changes. No data backfill.

## 20. Step 12 — verify the Phase 4 schema landed

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

## 21. Step 13 — deploy order and hazards (Phase 4)

**If the new Public Portal deploys before the migration runs** (unmigrated database still returns the old four-column shape):

`FindShelter.tsx` reads `shelter.has_space`, `shelter.latitude`, `shelter.longitude`, `shelter.address`, and `shelter.contact_number` from every result. On the old shape these are simply absent from the JSON — `undefined` in the browser, not `null`. Verified directly:

- `shelter.has_space ? shelter.available_space : 'Full'` — `undefined` is falsy, so **every shelter in the results list shows "Full · no space"**, even ones with plenty of room. This is a visible, misleading regression, not a crash.
- The map-marker filter is `shelters.filter((shelter) => shelter.latitude !== null && shelter.longitude !== null)`. `undefined !== null` evaluates to **`true`** in JavaScript — confirmed directly — so shelters with no `latitude` field at all still pass this filter. The component then renders `<Marker position={[Number(shelter.latitude), Number(shelter.longitude)]}>`, and `Number(undefined)` is `NaN` — confirmed directly. A Leaflet marker constructed from `NaN` coordinates does not throw in this codebase's usage, but it does not appear at a meaningful position either; treat any marker that appears to sit at the map's corner or vanish on zoom as this symptom, not a new bug.
- "Directions"/"Call" links (`shelter.contact_number`, `shelter.latitude`) simply don't render, since their guards (`{shelter.contact_number && ...}`) correctly treat `undefined` as absent — this part degrades gracefully.

**If the migration runs before the new Public Portal deploys:** no hazard. The *old* `FindShelter.tsx` never reads the five new columns, so it keeps working exactly as before — it just doesn't gain the new behaviour until it redeploys. `GET /api/shelters/nearest` itself is unchanged code (`server/routes/shelters.js` is not part of this phase's diff); it blindly returns whatever `find_nearest_shelters()` currently returns, so there is nothing to break on the API side either direction.

**`server/routes/aidRequests.js`, `auth.js`, and the new `events.js` have no migration dependency at all** — their validation and the events query only touch columns that existed before this phase. Deploying the API ahead of or behind the migration is safe for those three.

**Safest order:** apply the migration first, confirm with section 20, then deploy the API, then the Public Portal.

**Proof the new API build is live** (no mutation):

```bash
curl -i https://<render-host>/api/events
```
- Old API: Express's default 404 (`Cannot GET /api/events`) — the route did not exist.
- New API: `200` with a JSON array (possibly all 15 seeded events — see section 17). A `200` here, with no token required, is the "it's live" signal.

## 22. Step 14 — Phase 4 functional checks

Run these against the deployed Public Portal unless marked "API". No staff account is needed — the public-facing routes are unauthenticated by design.

| ID | Issue | Action | Expected |
| --- | --- | --- | --- |
| T1 | #67 | On **Request help**, try to type more than 100 characters into **Full name**, or more than 15 into **Phone number**. | The input simply stops accepting characters — `maxLength` matches the limits now (previously 120/30, which exceeded the database's `VARCHAR(100)`/`VARCHAR(15)`). |
| T2 | #68 | API: `POST /api/aid-requests` with `num_people: 0`, or `urgency_level: 9`, or `request_type: "alien"`. | `400` with a specific message for each — `"num_people must be a positive whole number"`, `"urgency_level must be a whole number from 1 to 5"`, `"request_type must be one of: shelter, medical, food, rescue"`. None of these should ever produce a `500`. |
| T3 | #68 | API: `POST /api/aid-requests` with `latitude` set but `longitude` omitted. | `400`, `"latitude and longitude must both be provided together"`. |
| T4 | #68 | API: `POST /api/aid-requests` with `event_id: 999999` (or any ID that doesn't exist). | `400`, `"event_id does not reference an existing disaster event"` — **not** `500`. |
| T5 | #69 | Submit a valid request on **Request help**. | The confirmation screen shows **"Your reference number is #&lt;id&gt;."** with the exact ID the API returned — not discarded. |
| T6 | #74 | Open **Request help** and look at the event selector (only rendered when more than one event is returned). | Per section 17, expect **all 15 seeded events** listed on an unmodified demo database, most recent `start_date` first, including historical ones — this is correct behaviour given the data, not a bug. Selecting one and submitting sends that `event_id`; leaving "Not sure / general request" sends `event_id: null`. |
| T7 | #38 | On **Find a shelter**, click **Pick on map** instead of **Use my location**. | A map appears centered on a default view; clicking anywhere on it immediately searches from that point — no GPS permission prompt at all. |
| T8 | #38 | On **Find a shelter**, click **Browse all shelters**. | A full list of shelters appears with occupied/total counts, with no location requested and no distance shown. |
| T9 | #39 | On **Find a shelter**, set **People in your household** to a number larger than any single shelter's free space, then search by location. | Results still return (not empty); each result reads **"Full · no space"** if `available_space` is less than the household size for that shelter, per the `has_space` flag — not simply omitted. |
| T10 | #40 | Search by location near at least one shelter. | The map shows a pin for **every returned shelter**, not only the user's own position, each poppable to the shelter's name and space count. |
| T11 | #41 | Search by location where the nearest shelter is full. | That shelter still appears in the results list (not hidden), labelled **"Full"**, with address and a **Call**/**Directions** link if `contact_number`/coordinates are present — not an empty state. |
| T12 | regression | On the Coordinator Dashboard, open **Priority queue** or **Allocation** as staff. | Unaffected — Phase 4 touches no coordinator-dashboard code; behaves exactly as sections 10/11 describe. |

## 23. Step 15 — data-changing helpers and cleanup (Phase 4)

**Most Phase 4 checks are read-only** (T6–T11 only read data) or create a request that behaves like any other synthetic request from section 11.1 — use the same reserved phone prefix, and the same cleanup in section 12 removes them (it already deletes `Request_Needs` and `Allocations` rows for the prefix before deleting the request itself, which also covers the needs this phase's requests may carry).

**Optional — to demonstrate the single-active-event auto-select path for T6** (section 17), temporarily close all but one event:

```sql
-- Preview first: confirm exactly which events you are about to close.
SELECT event_id, name, start_date, end_date FROM Disaster_Events WHERE end_date IS NULL;
```

```sql
-- Close every event except the one you want to demo (replace 14 with its event_id).
UPDATE Disaster_Events
SET end_date = CURRENT_DATE - INTERVAL '1 day'
WHERE end_date IS NULL AND event_id <> 14;
```

```sql
-- Restore afterwards — reopen exactly the rows this just closed.
UPDATE Disaster_Events
SET end_date = NULL
WHERE end_date = CURRENT_DATE - INTERVAL '1 day' AND event_id <> 14;
```

Narrow the second statement's date comparison if you ran the close step on a different day than the restore.

## 24. Phase 4 — rollback notes

No change to section 13's conclusion. This migration is replace-only (one function body, recreated from scratch after an explicit drop) — restoring the pre-migration backup and redeploying the previous builds remains the only reliable rollback, and there is nothing additive to partially undo.

**No Phase-4-specific hazard on rollback**, unlike Phase 3: rolling back only the Public Portal while leaving this migration applied is safe — the old frontend simply ignores the five new columns. Rolling back only the API is also safe for the same reason. The one direction that is not safe is already covered in section 21: deploying the **new** Public Portal before the migration runs.

## 25. Phase 4 — record sheet

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
