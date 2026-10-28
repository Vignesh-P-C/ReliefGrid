# Transactional DBMS experiment results (Audit #30)

Measured, not invented. Run twice, never against the live Supabase/Render deployment itself:

1. **Fixture run** — PostgreSQL 16.15 (Docker `postgres:16`), schema loaded fresh from `database/schema.sql`, synthetic fixture rows.
2. **Supabase-matching run** — PostgreSQL 17.11 (Docker `postgres:17`, matching Supabase's actual engine version exactly), schema from `database/schema.sql`, then populated with a **read-only copy of the real production data** (all 8 real shelters, all real requests/allocations/users, etc.) pulled from the live Supabase database via a single `BEGIN TRANSACTION READ ONLY ... ROLLBACK` — the live database was never written to. This run used the real "Government High School Shelter" (shelter_id 6, `capacity_total = 3`) for the overbooking test and the real "Kalady Ashram School Relief Camp" / "Ernakulam District Relief Camps" (shelter_id 1, 2) for the isolation and deadlock tests — the actual rows the live app serves, not invented ones.

Every result below was identical between the two runs. The point of the second run was to rule out "this only works on my made-up test data" — it doesn't; the same guarantees hold against real production rows on the exact Postgres version Supabase runs.

Each scenario ran once interactively on 2026-10-29; all four scripts are deterministic for the invariant they check (the specific session that wins a race can vary — see the deadlock result below — the invariant they prove cannot), so re-running is expected to keep holding the same invariant.

## Reproduce

**Fixture run (safe, no credentials needed):**
```bash
docker run --rm -d -e POSTGRES_PASSWORD=test -e POSTGRES_DB=reliefgrid_test -p 5435:5432 postgres:16
cd server
TEST_DATABASE_URL=postgresql://postgres:test@localhost:5435/reliefgrid_test node tests/setup-test-db.js   # loads schema.sql only
```

**Supabase-matching run (needs the real `DATABASE_URL` in `server/.env`, read-only):** load `schema.sql` into a `postgres:17` container the same way, then run a one-off script that opens `BEGIN TRANSACTION READ ONLY` on the live Supabase connection, copies every table in FK-safe order into the local container (disabling `trg_deduct_supply` for the `Allocations` replay only, since those rows already reflect historical deductions), and rolls back the live transaction. This script was written ad hoc for this verification and intentionally not kept in the repo, to avoid a live DB credential path sitting in version control — recreate it the same way if you need to re-verify against production data again.

`isolation-level-test.js`, `deadlock-test.js`, and `allocation-test.js` talk to Postgres directly and only need a handful of `Shelters` rows, `Supply_Categories` ('Food', 'Medical'), and (for allocation) `Users.user_id = 1` to exist. `concurrency-test.js` additionally needs a running API and a valid JWT, since it goes through `POST /api/shelters/:id/checkin` — for the Supabase-matching run, this means a real user's `password_hash` has to be overwritten locally (never live) to a known value just to log in, since real password hashes aren't known.

## 1. Isolation levels — `tests/isolation-level-test.js`

**Scenario:** Session A opens a transaction and reads `Shelters.capacity_occupied`. While A is still open, Session B updates the same row and commits. A then writes based on the value it read earlier, and tries to commit. Run once under `READ COMMITTED`, once under `SERIALIZABLE`.

**Result:**
- `READ COMMITTED`: A's commit **succeeded**, silently overwriting B's change — A never saw B's update and had no way to know its read was stale.
- `SERIALIZABLE`: A's commit **failed** with `SQLSTATE 40001` (`could not serialize access due to concurrent update`) — Postgres's serializable snapshot isolation detected A and B could not have been serialized in either order and aborted A.

**Why:** `checkin_to_shelter()`/`checkout_from_shelter()` use `SELECT ... FOR UPDATE` (explicit row locking) rather than relying on the transaction isolation level, which is why the app is safe under the database's default `READ COMMITTED` without needing `SERIALIZABLE` everywhere (`SERIALIZABLE` has a real cost: failed transactions must be retried by the application).

## 2. Deadlock — `tests/deadlock-test.js`

**Scenario:** Session A locks shelter 1, then asks for shelter 2. Session B locks shelter 2, then asks for shelter 1 — a circular wait.

**Result:** one session acquired both locks and committed; the other failed with `SQLSTATE 40P01` (`deadlock detected`). Postgres's deadlock detector (default `deadlock_timeout` = 1s) found the cycle and aborted one side rather than hanging both forever. *Which* side loses is not deterministic — the fixture run aborted Session B, the Supabase-matching run aborted Session A — but a side always loses, and the detector always resolves the cycle rather than letting both hang.

**Why it matters for this app:** nothing in the current codebase locks two shelters at once in opposite orders, so this is a demonstration of Postgres's protection mechanism, not a bug being fixed. The documented prevention rule (always lock in a consistent order, e.g. ascending `shelter_id`) is noted in the script and holds for any future code that needs to touch two rows at once.

## 3. Overbooking under concurrency — `tests/concurrency-test.js`

**Scenario:** 5 simultaneous check-in requests of 2 people each, fired at once, against a shelter with `capacity_total = 3`, starting at `capacity_occupied = 0`.

**Result:**
```
Group A -> status 200: { success: true }
Group B -> status 409: { success: false, message: 'Not enough space in this shelter' }
Group C -> status 409: { success: false, message: 'Not enough space in this shelter' }
Group D -> status 409: { success: false, message: 'Not enough space in this shelter' }
Group E -> status 409: { success: false, message: 'Not enough space in this shelter' }

Summary: 1 succeeded, 4 rejected.
Final: capacity_total = 3, capacity_occupied = 2
```
Exactly one group got in (2 of 3 beds); nothing overbooked the shelter (2 ≤ 3), and the four rejections got an honest `409`, not a stale "full" shown after the fact.

**Why:** the same `FOR UPDATE` row lock as above — the five requests serialize at the database row, so there is no window where two requests both read "1 bed free" and both insert.

## 4. Allocation atomicity and rollback — `tests/allocation-test.js`

**Scenario:** 16 checks run directly against `allocate_supply()` — partial fulfilment, over-allocation, completing a need, re-allocating a fulfilled request, a missing request, a shelter-only request with no item needs, a category mismatch, insufficient stock, and two simultaneous allocations racing for the last unit of stock.

**Result:** `16/16 checks passed.` Notably:
- A rejected allocation (insufficient stock, wrong category, etc.) leaves `Supplies.quantity` untouched and creates no `Allocations` row — confirms the function's early-return paths never partially apply a write.
- The concurrent race for the last unit: exactly one of two simultaneous calls succeeded, the need was not over-allocated, and stock was deducted exactly once — confirms the same row-locking pattern used for shelters also holds for `Supplies`/`Request_Needs`.

**Why it matters:** this is the core "transaction did the whole thing or none of it" guarantee the course material asks for, demonstrated against a real race rather than asserted.

## Summary

| Experiment | Mechanism being proven | Result |
|---|---|---|
| Isolation levels | `READ COMMITTED` allows a lost update; `SERIALIZABLE` catches it at commit time | Confirmed, both directions |
| Deadlock | Postgres's deadlock detector breaks a circular lock wait | Confirmed — one session aborted with `40P01`, the other committed |
| Overbooking | Row-level locking (`FOR UPDATE`) serializes concurrent check-ins | Confirmed — occupancy never exceeded capacity under 5-way concurrent load |
| Allocation atomicity | `allocate_supply()` never partially applies a write, and races for the last unit resolve to exactly one winner | Confirmed — 16/16, including the concurrent race |
