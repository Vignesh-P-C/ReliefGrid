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
