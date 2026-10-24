# Normalization and Key Analysis — ReliefGrid

This note records the design derivation and a table-by-table check of the ten
relations in [`schema.sql`](schema.sql). The conclusions describe the current
DDL under the assumptions below; they are not a proof about every possible
business rule that the schema does not encode.

## Scope and assumptions

- The relation attributes are the columns declared in `schema.sql`.
- Primary keys, `UNIQUE` constraints, and foreign keys are the declared
  constraints. A foreign key by itself does not make its column unique.
- Attributes are treated as scalar values. In particular, `Volunteers.skills`
  is currently one free-text value. If the application stores a list of skills
  in that field, introduce a `Volunteer_Skills(volunteer_id, skill)` relation.
- No extra business dependencies are assumed unless the DDL enforces them.
  For example, the schema does not enforce one volunteer profile per user or
  one supply row per shelter and item.

## Design derivation

A useful teaching example is a stock report with one row per shelter and
catalog item. In this hypothetical report, `(shelter_id, item_code)` is the
composite key; this is a derivation example, not a key declared by the current
schema:

```text
Shelter_Stock_Report(
  shelter_id, item_code, shelter_name, address, event_id, event_name,
  coordinator_id, coordinator_name, coordinator_phone,
  item_name, category_name, quantity, unit
)
```

The illustrative dependencies include:

```text
shelter_id               → shelter_name, address, event_id, coordinator_id
item_code                → item_name, category_name
(shelter_id, item_code)  → quantity, unit
event_id                 → event_name
coordinator_id           → coordinator_name, coordinator_phone
```

The first two dependencies are partial dependencies on the composite report
key. The event and coordinator details also depend on identifiers other than
the report key, creating transitive dependencies. The design separates these
entities into `Shelters`, `Supplies`, `Disaster_Events`, and `Users`, connected
by foreign keys. This prevents updates to a shelter, event, coordinator, or
stock record from requiring repeated edits to every report row. The current
schema uses `Supplies.supply_id` as the key for a stock record; it does not
declare a global item catalog or enforce uniqueness of `(shelter_id, item_name)`.

The same separation is used for other many-to-one and transactional data:
`Volunteers` and `Volunteer_Tasks` are separate from users and shelters;
`Aid_Requests` and `Allocations` are separate from supply stock. A request can
have multiple allocation records, and a supply can be allocated many times, so
those facts belong in their own relation rather than repeated columns.

All declared columns use scalar SQL types, so the current relations are in 1NF
under the scalar-value assumption above. No relation has a composite candidate
key, so there are no partial dependencies on a proper subset of a candidate
key; this supports 2NF. The table-by-table analysis below finds no declared
non-key determinant, so each relation satisfies BCNF under the stated
constraints and assumptions (and therefore also 3NF).

## Table-by-table keys and dependencies

In the table below, “key → all other columns” abbreviates the functional
dependency from that candidate key to every remaining attribute in the named
relation. These dependencies follow from the declared key constraints.

| Relation | Candidate key(s) from the DDL | Relevant functional dependencies | Normal form supported |
|---|---|---|---|
| `Disaster_Events` | `event_id` | `event_id → name, type, region, severity, start_date, end_date` | BCNF |
| `Users` | `user_id`; `phone` | `user_id → name, phone, email, password_hash, role`; `phone → user_id, name, email, password_hash, role` | BCNF |
| `Shelters` | `shelter_id` | `shelter_id → event_id, name, address, latitude, longitude, capacity_total, capacity_occupied, contact_number, coordinator_id, status` | BCNF |
| `Shelter_Capacity_Log` | `log_id` | `log_id → shelter_id, capacity_occupied, logged_at` | BCNF |
| `Supply_Categories` | `category_id`; `name` | `category_id → name`; `name → category_id` | BCNF |
| `Supplies` | `supply_id` | `supply_id → shelter_id, category_id, item_name, quantity, unit, reorder_threshold` | BCNF |
| `Volunteers` | `volunteer_id` | `volunteer_id → user_id, skills, availability` | BCNF |
| `Volunteer_Tasks` | `task_id` | `task_id → shelter_id, volunteer_id, parent_task_id, description, status, priority` | BCNF |
| `Aid_Requests` | `request_id` | `request_id → event_id, requester_name, phone, latitude, longitude, request_type, num_people, urgency_level, status, created_at` | BCNF |
| `Allocations` | `allocation_id` | `allocation_id → request_id, supply_id, quantity_allocated, allocated_at` | BCNF |

`Users.phone` is a candidate key because it is both `UNIQUE` and `NOT NULL`.
`Supply_Categories.name` is a candidate key for the same reason. The other
foreign-key columns are not declared unique and therefore are not candidate
keys: a user may have multiple shelter records or volunteer profiles, and a
shelter may have multiple supply and capacity-log records. Nullable foreign
keys do not change the primary-key conclusions. Check constraints on values
such as capacity and urgency restrict allowed values but do not introduce
additional functional dependencies.

The BCNF results rely on the declared constraints and stated domain assumptions.
If a real business rule introduces another dependency—for example, if each
`user_id` must have at most one volunteer profile—encode it with the appropriate
constraint and revisit the candidate-key analysis. The schema currently does
not enforce that example.

## Deliberate design extensions

`Shelter_Capacity_Log` and `Supply_Categories` were added as design extensions,
not as relations required by the shelter-report decomposition:

- **`Shelter_Capacity_Log`** stores dated occupancy observations separately
  from the shelter's current occupancy. This preserves a one-to-many history
  for trend reporting instead of overwriting past values or adding repeating
  history columns to `Shelters`.
- **`Supply_Categories`** gives supply categories stable identifiers and
  referential integrity. It avoids repeating category labels as unconstrained
  free text on every supply row.

## Presentation summary

The design separates events, users, shelters, supplies, requests, and
allocations so each fact is stored with its own identifier and referenced by
foreign keys. All ten tables have been checked against their declared keys and
dependencies. Under the assumptions documented here, every determinant is a
candidate key, so the relations satisfy BCNF. The capacity log and category
lookup are intentional extensions for history and consistency, respectively.
