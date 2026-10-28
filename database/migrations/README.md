# Database migrations

`database/schema.sql` builds a **new** database. These migrations bring an
**existing** database up to the same shape: the same tables, columns, column
types, functions, views, constraints and indexes. That equality is what makes a
deploy safe.

Column *order* is the one place the two paths can differ, because `ALTER TABLE
ADD COLUMN` appends. On an upgraded database `Allocations.need_id` and
`allocated_by` therefore sit after `allocated_at`. Nothing depends on physical
column order — every query and every `INSERT` names its columns — but a shape
diff must compare column sets, not `attnum` order.

## Order

Apply in the numbered order below — never an older file after a newer one.
Filename order is **not** the apply order here: the Phase 3 and Phase 4 files were
written on branches and carry an earlier date prefix (`20261025`) than migration
3 (`20261026`), so sorting the directory by name would run them ahead of the
migration they follow.

| # | File | What it changes |
| --- | --- | --- |
| 1 | `20261016_add_supply_id_to_shortage_view.sql` | Adds `supply_id` to `Critical_Supply_Shortage` so the allocation action can identify the stock row. |
| 2 | `20261025_add_aid_request_triage.sql` | Adds `reviewed_priority` / `reviewed_by` / `reviewed_at`, and replaces `get_priority_queue()` with ageing and request detail. |
| 3 | `20261026_add_request_needs_and_partial_fulfilment.sql` | Adds `Request_Needs`, links allocations to a need and an actor, adds the request status constraint, and replaces `allocate_supply()` and `get_priority_queue()`. Also widens the shortage view with `unit` and category fields. |
| 4 | `20261025_phase3_capacity_truth.sql` | Restricts `Shelters.status` to `active`/`inactive`, makes `checkin_to_shelter()` return a reason instead of a boolean (`ok` / `not_found` / `inactive` / `full`), adds `checkout_from_shelter()`, and widens `Shelter_Live_Status` with event context and `is_active`. |
| 5 | `20261025_phase4_portal_trust.sql` | Replaces `find_nearest_shelters()`: shelters with room for the household sort first, full ones stay in the result flagged `has_space = false`, and location and contact details come back with each row. |
| 6 | `20261027_phase5_guardrails.sql` | Records who changed capacity (`Shelter_Capacity_Log.changed_by`, `change_type`), rebuilds `checkin_to_shelter()` / `checkout_from_shelter()` with a defaulted actor parameter, constrains `Volunteer_Tasks.status`, and appends `coordinator_id` to `Shelter_Live_Status`. |

## Applying

Against Supabase, paste each file into the SQL editor — one file per query, in
the numbered order. Against any other PostgreSQL instance:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/migrations/20261016_add_supply_id_to_shortage_view.sql \
  -f database/migrations/20261025_add_aid_request_triage.sql \
  -f database/migrations/20261026_add_request_needs_and_partial_fulfilment.sql \
  -f database/migrations/20261025_phase3_capacity_truth.sql \
  -f database/migrations/20261025_phase4_portal_trust.sql \
  -f database/migrations/20261027_phase5_guardrails.sql
```

Always use `-v ON_ERROR_STOP=1`. Without it `psql` keeps going after an error
and leaves the database half-migrated.

Migrations 3, 4, 5 and 6 are idempotent. Migration 3 uses `IF NOT EXISTS` for
tables, columns and indexes, a guarded `DO` block for the status constraint and
`CREATE OR REPLACE` for functions; migrations 4, 5 and 6 guard their constraints
the same way and drop a function before recreating it when its return columns
change. Migrations 5 and 6 also replace the same functions again, which is why
each of them drops before creating: migration 6 rebuilds both capacity functions
with a third, defaulted parameter rather than a new name, so two-argument calls
keep working unchanged. Re-running any of those four is safe. Migrations 1 and 2 are **not**, and both
fail in a way that depends on how far the later files have got:

- Migration 1 re-runs cleanly until migration 3 replaces the view, after which
  it fails with *cannot drop columns from view* — `CREATE OR REPLACE VIEW` can
  add columns, not remove them. Nothing is changed by the failure.
- Migration 2 re-runs cleanly until migration 5 widens
  `find_nearest_shelters()`, after which it fails with *cannot change return
  type of existing function*. Because the same file drops
  `get_priority_queue()` a few statements earlier, that failure leaves the queue
  function **dropped** in a client that stops at the first error (`psql`), or
  silently reverted to its Phase A shape in one that carries on (the Supabase
  editor). Re-applying migration 3 repairs either state.

Apply 1 and 2 once each, in order. If one of them reports an error, re-apply
migration 3 before moving on, and read the message rather than pasting again.

## Deployment order

1. Back up the database (Supabase: Database → Backups).
2. Apply the migrations.
3. Deploy the API.
4. Deploy the frontends.

A build that reads a new column or a changed function shape has to deploy
*after* the migration that provides it. Migration 5 (`find_nearest_shelters()`
going from four columns to nine) is the current example: a portal deployed ahead
of it labels every shelter "not enough for your group" and places map pins at
`NaN` coordinates. `DEPLOYED_VERIFICATION_RUNBOOK.md` section 31 records the
detail.

Migration 6 is the second example, with one asymmetry worth knowing. The Phase 5
API calls `checkin_to_shelter($1, $2, $3)`, so an API deployed against an
unmigrated database fails every check-in and check-out with
`42883 undefined_function` and answers `500` — loud, and limited to those two
routes. The other direction is safe: the older two-argument API keeps working
against the migrated schema and simply records `changed_by = NULL`. Migrate
first, then deploy. `DEPLOYED_VERIFICATION_RUNBOOK.md` section 41 records the
detail.

The API and frontends are written to fail with a readable message rather than
silently misbehaving if they are deployed against a database that has not been
migrated (see `describeDatabaseError` in `server/routes/supplies.js`).

## What the upgrade does to existing rows

- Every **open** request that is not shelter-only gets a `Request_Needs` row
  derived from its `num_people`. If the request type maps to a supply category
  (`food` → Food, `water` → Water, `medical` → Medical) the need is named;
  otherwise it is recorded with `is_estimate = true`, meaning any compatible
  item may satisfy it. Nothing is invented as if it were a real request.
- Shelter-only requests get **no** item need. Their need is a bed, which
  check-in serves — allocating stock to them was the old behaviour and it was
  wrong.
- Existing `Allocations` keep `need_id = NULL`. They are history, not claims
  about a need, and their requests stay `fulfilled`.
- Requests in an unexpected status are set to `pending` before the status
  constraint is added, so the constraint cannot fail a deploy.
- `Volunteer_Tasks.status` values outside `pending` / `in_progress` / `done` /
  `blocked` / `cancelled` are set to `pending` (migration 6), with a `NOTICE`
  naming the count. The previous value is not preserved, so read those rows
  before migrating if the distinction matters. The seeded database has none.

## Verifying an upgrade

```sql
-- Should return the same column list on a fresh and an upgraded database.
-- ORDER BY attname, not attnum: ALTER TABLE appends, so physical order differs.
SELECT string_agg(attname, ',' ORDER BY attname)
FROM pg_attribute
WHERE attrelid = 'critical_supply_shortage'::regclass AND attnum > 0;

-- Should match the OUT parameters in schema.sql / migration 3.
SELECT pg_get_function_result('get_priority_queue()'::regprocedure);
SELECT pg_get_function_arguments('allocate_supply(int,int,int,integer,integer)'::regprocedure);

-- Both capacity functions, by name rather than signature: migration 6 adds a
-- defaulted third parameter, so a (int,int) lookup stops resolving afterwards.
SELECT p.oid::regprocedure AS signature, pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('checkin_to_shelter','checkout_from_shelter')
ORDER BY 1;

-- Migration 6's three additions.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'shelter_capacity_log'
  AND column_name IN ('changed_by','change_type');
SELECT conname FROM pg_constraint
WHERE conname IN ('shelter_capacity_log_change_type_allowed','volunteer_tasks_status_allowed')
ORDER BY conname;
SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'shelter_live_status'
  AND column_name = 'coordinator_id';

-- Every open, non-shelter request should have at least one need.
SELECT count(*) FROM Aid_Requests r
WHERE r.status IN ('pending', 'partially_fulfilled')
  AND COALESCE(btrim(r.request_type), '') <> 'shelter'
  AND NOT EXISTS (SELECT 1 FROM Request_Needs n WHERE n.request_id = r.request_id);
```

## Behaviour checks

`cd server && DATABASE_URL=… npm run test:allocation` runs the allocation
contract against the database: partial and full fulfilment, ineligible and
missing requests, category mismatch, insufficient stock, and two concurrent
allocations of the last unit of need. It creates its own fixtures and deletes
them again.

`npm run test:phase3`, `npm run test:phase4` and `npm run test:phase5` cover the
later phases against a running API rather than the database alone. The Phase 5
suite exercises the actor on both capacity-log paths, the task status constraint,
volunteer refusals, ownership scoping, the anonymous socket, the CORS and header
behaviour, and login throttling.

## Rolling back

There are no down migrations. A rollback restores the pre-migration backup and
redeploys the previous API build; the migration files themselves are additive,
so restoring is the only reliable path.
