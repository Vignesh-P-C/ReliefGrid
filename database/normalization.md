# Normalization Walkthrough — ReliefGrid

This is the derivation of the final 10-table schema (`schema.sql`) from a naive,
denormalized starting point. It exists to demonstrate the normalization process
explicitly (Module 3), not just present a finished ER diagram.

---

## Starting point: an unnormalized reporting table

A first-pass, naive design for "everything a shelter report needs" might look like this:

```
Shelter_Report_Raw(
  shelter_id, shelter_name, address, latitude, longitude,
  coordinator_name, coordinator_phone,
  event_name, event_region,
  supply_item, supply_qty, supply_unit
)
```

## Functional dependencies identified

```
shelter_id      → shelter_name, address, latitude, longitude, coordinator_id, event_id
coordinator_id  → coordinator_name, coordinator_phone
event_id        → event_name, event_region
supply_id       → supply_item, supply_qty, supply_unit
```

## Step 1 — First Normal Form (1NF)

**Violation:** the moment a shelter stocks more than one supply item, `supply_item`/
`supply_qty`/`supply_unit` would need to repeat within the same "row" for that shelter —
a repeating group, which breaks atomicity of values.

**Fix:** pull supplies into their own table, keyed by `supply_id`, referencing
`shelter_id`. Now every table has atomic, single-valued columns.

## Step 2 — Second Normal Form (2NF)

**Violation:** once shelter attributes and supply attributes are considered together
under a composite key like (`shelter_id`, `supply_id`), attributes such as
`shelter_name` and `address` depend only on `shelter_id` — not on the full composite
key. This is a **partial dependency**.

**Fix:** split `Shelters` out as its own table, independent of `Supplies`. `Supplies`
keeps only attributes that depend on the full key (`supply_id` alone, since it's a
surrogate key here).

## Step 3 — Third Normal Form (3NF)

**Violation:** `coordinator_name` and `coordinator_phone` depend on `coordinator_id`,
which itself depends on `shelter_id` — a **transitive dependency**
(`shelter_id → coordinator_id → coordinator_name`). Same pattern for
`event_name`/`event_region`, which depend on `event_id`, not directly on `shelter_id`.

**Fix:**
- Split coordinators (and all people) into a `Users` table, referenced from `Shelters`
  via `coordinator_id`.
- Split `Disaster_Events` into its own table, referenced from `Shelters` via `event_id`.

## Step 4 — Boyce-Codd Normal Form (BCNF) check

For every table in the final schema, confirm every determinant is a candidate key:

| Table | Determinant(s) | Candidate key? |
|---|---|---|
| `Disaster_Events` | `event_id` | Yes — no violation |
| `Users` | `user_id`; also `phone` (unique) | Both are candidate keys — no violation |
| `Shelters` | `shelter_id` | Yes — no violation |
| `Supplies` | `supply_id` | Yes — no violation |
| `Aid_Requests` | `request_id` | Yes — no violation |
| `Allocations` | `allocation_id` | Yes — no violation |

No table has a non-key attribute determining another non-key attribute, so the schema
is in BCNF.

## Final schema (10 tables)

`Disaster_Events`, `Users`, `Shelters`, `Shelter_Capacity_Log`, `Supply_Categories`,
`Supplies`, `Volunteers`, `Volunteer_Tasks`, `Aid_Requests`, `Allocations`.

`Shelter_Capacity_Log` and `Supply_Categories` weren't part of the original raw
table — they were added deliberately during schema design (not derived from
normalizing the raw table) to support the materialized view / trend reporting and to
avoid a `Supplies.category` string column with no referential integrity. Worth noting
in the report as a "beyond strict normalization" design decision, not a normal-form fix.

See `schema.sql` for the full DDL of the final schema, including all constraints.
