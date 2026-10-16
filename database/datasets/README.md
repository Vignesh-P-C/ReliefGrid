# ReliefGrid test datasets

This directory contains deterministic, CSV-based fixtures for the ten PostgreSQL tables, a small public-source extract, source/provenance metadata, and ready-to-run DBMS scenario inputs. **Load these only into a disposable local test database.** The fixtures include fictional accounts, fictional operational activity, and historical aggregate snapshots; they are not current relief information.

## Directory layout

```text
database/datasets/
├── generate_datasets.js             # Rebuilds all generated files (fixed seed)
├── postgres/                        # One CSV per PostgreSQL table, exact schema columns
├── source_snapshots/                # Public source facts before schema transformations
├── metadata/
    ├── dataset_catalog.csv          # Files, row counts, provenance class, and load order
    ├── record_provenance.csv        # Table ID ranges, origins, and transformations
    ├── external_sources.csv         # Citations, terms, and local download status
    ├── external_files.csv           # Individual optional public message-corpus files
    └── simulation_scenarios.csv     # Inputs and expected outcomes for DBMS demos
└── external/
    └── disaster_response_messages/  # Drop location for the three optional author CSVs
        └── README.md
```

The table CSVs are `postgres/01_disaster_events.csv` through `postgres/10_allocations.csv`. Their headers follow the column order in `database/schema.sql`; they include explicit primary keys and can be loaded with PostgreSQL `\copy`.

## Contents

| Table | Rows | Notes |
|---|---:|---|
| `Disaster_Events` | 15 | 13 source-grounded historical events, plus 2 explicitly fabricated test events |
| `Users` | 104 | Fictional roles and reserved `TEST-USER-*` identifiers |
| `Shelters` | 54 | Existing seed fixtures, 14 dated district aggregates, and 32 synthetic shelters |
| `Shelter_Capacity_Log` | 10,000 | Deterministic synthetic observations for trend and scale experiments |
| `Supply_Categories` | 8 | Operational test categories |
| `Supplies` | 165 | Synthetic/current fixture stock; balances reflect the allocation history in the CSV |
| `Volunteers` | 101 | Fictional volunteer records |
| `Volunteer_Tasks` | 323 | Small task tree plus synthetic parent/child groups |
| `Aid_Requests` | 10,008 | 8 original demo rows plus 10,000 synthetic requests; first 2,000 generated requests are fulfilled |
| `Allocations` | 2,000 | Synthetic allocations corresponding to those fulfilled requests |

The separate official-source snapshot contains 14 district rows for the **single date 2018-08-20**: 4,033 camps and 719,228 people in camps in total. The source page is the [Kerala Local Self Government Department camp report](https://lsgkerala.gov.in/en/flood-relief/camps-20august2018). The extract is `source_snapshots/kerala_2018-08-20_district_camps.csv`; it deliberately keeps the reported values separate from schema-ready rows.

## Provenance and safety

- `metadata/record_provenance.csv` documents source-backed and fabricated ID ranges. For mixed rows, its notes distinguish observed headcounts from approximate coordinates, capacity buffers, fictional identities, and synthetic operational fields.
- Rows 9–22 in `Shelters` are dated district aggregates, not individual camp records. Their coordinates approximate district administrative centers, their capacity buffer is modeled, and their `historical_snapshot` status keeps them out of active nearest-shelter matching.
- `Users.password_hash` contains the literal marker `FIXTURE_ONLY_NOT_A_BCRYPT_HASH`. These fixture accounts cannot authenticate. No password or reusable credential is included; create a separate local test account if an authenticated UI test is needed.
- `TEST-USER-*` and `TEST-REQ-*` values are identifiers, not phone numbers. Shelter contact numbers are blank.
- The messages corpus from the prior plan is cataloged in `metadata/external_sources.csv`, but its three 25,000-message train/validation/test CSV files are **not in this workspace**. The author's repository states CC BY 4.0 and PII removal. Keep that text corpus separate from operational ReliefGrid records; it has different disaster/geographic coverage and must not be joined to identify message authors. If you add it later, preserve attribution and its stated privacy restriction. Put the original CSVs in `external/disaster_response_messages/`; direct links are in `metadata/external_files.csv`.
- The historical event data and source-backed shelter counts are not a single contemporaneous operational database. Don't aggregate across dates as though they described one live moment.

## Load into a disposable PostgreSQL database

First create an isolated database, then apply `database/schema.sql`. Do not point the experiment scripts or these imports at Render/Supabase or another shared/production database. From the repository root, open `psql` connected to that disposable database and run the following in order:

```sql
\copy Disaster_Events (event_id,name,type,region,severity,start_date,end_date) FROM 'database/datasets/postgres/01_disaster_events.csv' WITH (FORMAT csv, HEADER true)
\copy Users (user_id,name,phone,email,password_hash,role) FROM 'database/datasets/postgres/02_users.csv' WITH (FORMAT csv, HEADER true)
\copy Shelters (shelter_id,event_id,name,address,latitude,longitude,capacity_total,capacity_occupied,contact_number,coordinator_id,status) FROM 'database/datasets/postgres/03_shelters.csv' WITH (FORMAT csv, HEADER true)
\copy Shelter_Capacity_Log (log_id,shelter_id,capacity_occupied,logged_at) FROM 'database/datasets/postgres/04_shelter_capacity_log.csv' WITH (FORMAT csv, HEADER true)
\copy Supply_Categories (category_id,name) FROM 'database/datasets/postgres/05_supply_categories.csv' WITH (FORMAT csv, HEADER true)
\copy Supplies (supply_id,shelter_id,category_id,item_name,quantity,unit,reorder_threshold) FROM 'database/datasets/postgres/06_supplies.csv' WITH (FORMAT csv, HEADER true)
\copy Volunteers (volunteer_id,user_id,skills,availability) FROM 'database/datasets/postgres/07_volunteers.csv' WITH (FORMAT csv, HEADER true)
\copy Volunteer_Tasks (task_id,shelter_id,volunteer_id,parent_task_id,description,status,priority) FROM 'database/datasets/postgres/08_volunteer_tasks.csv' WITH (FORMAT csv, HEADER true)
\copy Aid_Requests (request_id,event_id,requester_name,phone,latitude,longitude,request_type,num_people,urgency_level,status,created_at) FROM 'database/datasets/postgres/09_aid_requests.csv' WITH (FORMAT csv, HEADER true)
\copy Allocations (allocation_id,request_id,supply_id,quantity_allocated,allocated_at) FROM 'database/datasets/postgres/10_allocations.csv' WITH (FORMAT csv, HEADER true)
```

The explicit order respects foreign keys. Because the files include explicit serial IDs, reset each table's sequence before creating additional rows. Run this after all ten imports:

```sql
SELECT setval(pg_get_serial_sequence('disaster_events','event_id'), (SELECT MAX(event_id) FROM disaster_events));
SELECT setval(pg_get_serial_sequence('users','user_id'), (SELECT MAX(user_id) FROM users));
SELECT setval(pg_get_serial_sequence('shelters','shelter_id'), (SELECT MAX(shelter_id) FROM shelters));
SELECT setval(pg_get_serial_sequence('shelter_capacity_log','log_id'), (SELECT MAX(log_id) FROM shelter_capacity_log));
SELECT setval(pg_get_serial_sequence('supply_categories','category_id'), (SELECT MAX(category_id) FROM supply_categories));
SELECT setval(pg_get_serial_sequence('supplies','supply_id'), (SELECT MAX(supply_id) FROM supplies));
SELECT setval(pg_get_serial_sequence('volunteers','volunteer_id'), (SELECT MAX(volunteer_id) FROM volunteers));
SELECT setval(pg_get_serial_sequence('volunteer_tasks','task_id'), (SELECT MAX(task_id) FROM volunteer_tasks));
SELECT setval(pg_get_serial_sequence('aid_requests','request_id'), (SELECT MAX(request_id) FROM aid_requests));
SELECT setval(pg_get_serial_sequence('allocations','allocation_id'), (SELECT MAX(allocation_id) FROM allocations));
```

## Scenarios and regeneration

`metadata/simulation_scenarios.csv` lists deterministic test inputs for shelter matching, the priority queue, stock shortages, atomic supply allocation, capacity trends, concurrent check-in, isolation, and deadlock demos. It names the seed IDs and notes when a fresh fixture reload is required. Existing demo scripts mutate rows; follow their safety notes and use only the disposable database.

Run `node database/datasets/generate_datasets.js` from the repository root to regenerate the synthetic rows and CSV metadata. The generator uses fixed seed `20261016`, validates foreign keys, value checks, capacities, and task-parent ordering before writing. It does not access the network or any environment file.
