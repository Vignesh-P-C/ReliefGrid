# ReliefGrid — Project Knowledge Base
*Full context for AI coding agents. Read this before making any changes.*

---

## 1. What This Project Is

**ReliefGrid** is a Disaster Relief Resource & Shelter Coordination System, built as a **university DBMS course project** (BCSE302L — Database Systems). It is a 4-person, 12-week team project.

**Critical framing — do not lose this:** this is graded as a *database systems* project, not a generic full-stack project. The professor explicitly said projects should not just "have a database" — the database must be the central, load-bearing feature. Concretely, this means:
- Complex logic (matching, capacity safety, priority ordering, reporting) lives in **stored procedures/functions, triggers, and views inside Postgres** — not in Express/JS application code.
- The backend (Express) is intentionally a **thin wrapper**: most routes are a single `pool.query()` call into a DB function or view.
- Every major SQL technique used should map back to a specific syllabus module (see §3). When adding features, prefer solving problems at the database level over the application level, and prefer techniques that map to the syllabus.

**Do not** silently move logic that currently lives in SQL functions/triggers into JavaScript "for simplicity" — that would undermine the entire point of the project.

---

## 2. The Problem & Solution (for context/README/report generation)

**Problem:** During a disaster, shelter/supply coordination happens over WhatsApp and spreadsheets. No live visibility into shelter space, no smart matching of aid requests to nearest available shelter, no early warning on supply shortages, no guarantee against double-booking shelter capacity.

**Scope boundaries (intentional, not gaps):** No payment processing, no SMS gateway for feature phones, no multi-region/multi-country support, no PostGIS (uses a plain haversine SQL function instead of real spatial indexing). Single district, web-only. These are documented as "what we'd add next," not omissions to apologize for.

**End-to-end flow:**
```
1. Person needs help → opens the public app → shares location
2. App calls find_nearest_shelters() → shows nearest shelters with free space (map + list)
3. Person submits an aid request (name, phone, location, urgency)
4. Request appears in the coordinator dashboard's priority queue (get_priority_queue(), most urgent first)
5. Coordinator checks the person into a shelter → checkin_to_shelter() row-locks, checks
   capacity, updates it — safe under concurrent load
6. All coordinator dashboards update live, instantly (Socket.io)
7. Coordinator allocates supplies → allocate_supply() runs as one atomic transaction
   (deduct stock + log allocation + update request status, or none of it)
8. If supplies at a shelter run low → Critical_Supply_Shortage view fires an alert
9. Every capacity change is logged → feeds a materialized view for trend reporting;
   indexes keep geospatial and lookup queries fast at scale
```

---

## 3. Syllabus → Project Map (BCSE302L)

This table is the design rationale for the whole project. Every "why did we build it this way" question traces back to this.

| Module | Topic | Where it lives in this project |
|---|---|---|
| 1 | DBMS architecture, three-schema architecture, DBA roles | Conceptual schema = ER model; internal schema = physical storage/indexes; external schema = views (`Shelter_Live_Status`) and API responses |
| 2 | ER modeling, keys, constraints | Full ER diagram, PK/FK/candidate keys, participation constraints |
| 3 | Normalization (1NF–BCNF), functional dependencies | Full UNF → BCNF derivation of the schema, documented in `database/normalization.md` |
| 4 | Indexing, hashing, query optimization | B-tree vs hash index comparison, `EXPLAIN ANALYZE` before/after adding indexes |
| 5 | Transaction processing, ACID, recovery | Explicit transaction blocks + ACID demo (`allocate_supply`); `pg_dump`/WAL-based recovery |
| 6 | Concurrency control, locking, deadlocks, isolation levels | `FOR UPDATE` row locking, isolation-level comparison (`READ COMMITTED` vs `SERIALIZABLE`), engineered deadlock demo |
| 7 | NoSQL, CAP theorem | Written justification for relational over NoSQL (strong consistency requirement — capacity must never go negative) |

---

## 4. Tech Stack

- **Database:** PostgreSQL via Supabase (single shared project across the team)
- **Backend:** Node.js + Express, JWT auth (`jsonwebtoken`, `bcryptjs`), Socket.io for live updates, `pg` for DB access
- **Coordinator Dashboard:** React (Vite), `axios`, `socket.io-client`
- **Public/Volunteer Portal ("the app"):** React (Vite), `leaflet` + `react-leaflet` for maps, browser geolocation API
- **Deployment:** DB on Supabase, backend on Render, both frontends on Vercel

---

## 5. Repo / Folder Structure

```
reliefgrid/
├── server/                 (Express — thin wrapper around the DB)
│   ├── index.js
│   ├── db.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── shelters.js
│   │   ├── aidRequests.js
│   │   └── supplies.js
│   ├── middleware/
│   │   └── auth.js
│   ├── tests/
│   │   └── concurrency-test.js
│   └── .env               (DATABASE_URL, JWT_SECRET, PORT — never commit)
├── coordinator-dashboard/  (React)
├── public-portal/          (React)
├── database/
│   ├── schema.sql          (the largest, most important file in the repo)
│   ├── normalization.md    (UNF→BCNF walkthrough — report appendix)
│   └── queries/            (saved advanced queries: window fns, recursive CTEs, EXPLAIN outputs)
└── README.md
```

`.gitignore`: `node_modules/`, `.env`, `dist/`, `build/`.

---

## 6. Database Schema (10 tables)

```sql
CREATE TABLE Disaster_Events (
  event_id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  type VARCHAR(50),
  region VARCHAR(100),
  severity SMALLINT CHECK (severity BETWEEN 1 AND 5),
  start_date DATE NOT NULL,
  end_date DATE
);

CREATE TABLE Users (
  user_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(15) UNIQUE NOT NULL,
  email VARCHAR(150),
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (role IN ('Admin','ShelterCoordinator','Volunteer'))
);

CREATE TABLE Shelters (
  shelter_id SERIAL PRIMARY KEY,
  event_id INT REFERENCES Disaster_Events(event_id),
  name VARCHAR(150) NOT NULL,
  address TEXT,
  latitude NUMERIC(9,6) NOT NULL,
  longitude NUMERIC(9,6) NOT NULL,
  capacity_total INT NOT NULL CHECK (capacity_total >= 0),
  capacity_occupied INT NOT NULL DEFAULT 0 CHECK (capacity_occupied >= 0),
  contact_number VARCHAR(15),
  coordinator_id INT REFERENCES Users(user_id),
  status VARCHAR(20) DEFAULT 'active',
  CHECK (capacity_occupied <= capacity_total)
);

CREATE TABLE Shelter_Capacity_Log (
  log_id SERIAL PRIMARY KEY,
  shelter_id INT REFERENCES Shelters(shelter_id),
  capacity_occupied INT NOT NULL,
  logged_at TIMESTAMP DEFAULT now()
);

CREATE TABLE Supply_Categories (
  category_id SERIAL PRIMARY KEY,
  name VARCHAR(80) UNIQUE NOT NULL
);

CREATE TABLE Supplies (
  supply_id SERIAL PRIMARY KEY,
  shelter_id INT REFERENCES Shelters(shelter_id),
  category_id INT REFERENCES Supply_Categories(category_id),
  item_name VARCHAR(100) NOT NULL,
  quantity INT NOT NULL CHECK (quantity >= 0),
  unit VARCHAR(20),
  reorder_threshold INT DEFAULT 10
);

CREATE TABLE Volunteers (
  volunteer_id SERIAL PRIMARY KEY,
  user_id INT REFERENCES Users(user_id),
  skills TEXT,
  availability VARCHAR(30)
);

CREATE TABLE Volunteer_Tasks (
  task_id SERIAL PRIMARY KEY,
  shelter_id INT REFERENCES Shelters(shelter_id),
  volunteer_id INT REFERENCES Volunteers(volunteer_id),
  parent_task_id INT REFERENCES Volunteer_Tasks(task_id),  -- self-ref, used for recursive CTE
  description TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  priority SMALLINT DEFAULT 3
);

CREATE TABLE Aid_Requests (
  request_id SERIAL PRIMARY KEY,
  event_id INT REFERENCES Disaster_Events(event_id),
  requester_name VARCHAR(100),
  phone VARCHAR(15),
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  request_type VARCHAR(50),
  num_people INT CHECK (num_people > 0),
  urgency_level SMALLINT CHECK (urgency_level BETWEEN 1 AND 5),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE Allocations (
  allocation_id SERIAL PRIMARY KEY,
  request_id INT REFERENCES Aid_Requests(request_id),
  supply_id INT REFERENCES Supplies(supply_id),
  quantity_allocated INT CHECK (quantity_allocated > 0),
  allocated_at TIMESTAMP DEFAULT now()
);
```

### Normalization rationale (summary — full version in `database/normalization.md`)
Started from a flat `Shelter_Report_Raw` table. Functional dependencies identified:
```
shelter_id      → shelter_name, address, latitude, longitude, coordinator_id, event_id
coordinator_id  → coordinator_name, coordinator_phone
event_id        → event_name, event_region
supply_id       → supply_item, supply_qty, supply_unit
```
- **1NF violation:** repeating supply items per shelter → split `Supplies` into its own table.
- **2NF violation:** partial dependency of shelter attributes on a composite key → split `Shelters` out.
- **3NF violation:** transitive dependency `shelter_id → coordinator_id → coordinator_name` → split coordinators into `Users`; same logic separates `Disaster_Events`.
- **BCNF check:** confirmed every determinant in the final tables is a candidate key.

---

## 7. Database Logic — Functions, Triggers, Views

### 7.1 Geospatial matching
```sql
CREATE OR REPLACE FUNCTION find_nearest_shelters(
  in_lat NUMERIC, in_lon NUMERIC, req_space INT, max_results INT
) RETURNS TABLE(shelter_id INT, name VARCHAR, distance_km NUMERIC, available_space INT) AS $$
BEGIN
  RETURN QUERY
  SELECT s.shelter_id, s.name,
    ROUND((6371 * acos(
      cos(radians(in_lat)) * cos(radians(s.latitude)) *
      cos(radians(s.longitude) - radians(in_lon)) +
      sin(radians(in_lat)) * sin(radians(s.latitude))
    ))::numeric, 2) AS distance_km,
    (s.capacity_total - s.capacity_occupied) AS available_space
  FROM Shelters s
  WHERE (s.capacity_total - s.capacity_occupied) >= req_space
    AND s.status = 'active'
  ORDER BY distance_km ASC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;
```

### 7.2 Priority queue
```sql
CREATE OR REPLACE FUNCTION get_priority_queue()
RETURNS TABLE(request_id INT, requester_name VARCHAR, urgency_level SMALLINT, num_people INT, waiting_minutes NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT r.request_id, r.requester_name, r.urgency_level, r.num_people,
    ROUND(EXTRACT(EPOCH FROM (now() - r.created_at)) / 60, 1)
  FROM Aid_Requests r
  WHERE r.status = 'pending'
  ORDER BY r.urgency_level DESC, r.created_at ASC;
END;
$$ LANGUAGE plpgsql;
```

### 7.3 Concurrency-safe check-in (THE centerpiece function)
```sql
-- UNSAFE version — kept only as the "before" example for the report, never called from the app
CREATE OR REPLACE FUNCTION checkin_unsafe(p_shelter_id INT, p_num_people INT) RETURNS BOOLEAN AS $$
DECLARE occ INT; tot INT;
BEGIN
  SELECT capacity_occupied, capacity_total INTO occ, tot FROM Shelters WHERE shelter_id = p_shelter_id;
  IF occ + p_num_people > tot THEN RETURN FALSE; END IF;
  UPDATE Shelters SET capacity_occupied = occ + p_num_people WHERE shelter_id = p_shelter_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- SAFE version — this is what the app actually calls
CREATE OR REPLACE FUNCTION checkin_to_shelter(p_shelter_id INT, p_num_people INT) RETURNS BOOLEAN AS $$
DECLARE occ INT; tot INT;
BEGIN
  SELECT capacity_occupied, capacity_total INTO occ, tot
  FROM Shelters WHERE shelter_id = p_shelter_id
  FOR UPDATE;  -- row lock: blocks concurrent transactions on this row until commit

  IF occ + p_num_people > tot THEN RETURN FALSE; END IF;

  UPDATE Shelters SET capacity_occupied = occ + p_num_people WHERE shelter_id = p_shelter_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
```

### 7.4 Atomic supply allocation (ACID demo)
```sql
CREATE OR REPLACE FUNCTION allocate_supply(
  p_request_id INT, p_supply_id INT, p_qty INT
) RETURNS BOOLEAN AS $$
DECLARE available INT;
BEGIN
  SELECT quantity INTO available FROM Supplies WHERE supply_id = p_supply_id FOR UPDATE;

  IF available IS NULL OR available < p_qty THEN
    RAISE NOTICE 'Insufficient stock for supply_id %', p_supply_id;
    RETURN FALSE;
  END IF;

  UPDATE Supplies SET quantity = quantity - p_qty WHERE supply_id = p_supply_id;
  INSERT INTO Allocations(request_id, supply_id, quantity_allocated)
  VALUES (p_request_id, p_supply_id, p_qty);
  UPDATE Aid_Requests SET status = 'fulfilled' WHERE request_id = p_request_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
```

### 7.5 Triggers
```sql
-- Auto-deduct + guard against negative stock (belt-and-suspenders alongside allocate_supply)
CREATE OR REPLACE FUNCTION deduct_supply_on_allocation() RETURNS TRIGGER AS $$
BEGIN
  UPDATE Supplies SET quantity = quantity - NEW.quantity_allocated WHERE supply_id = NEW.supply_id;
  IF (SELECT quantity FROM Supplies WHERE supply_id = NEW.supply_id) < 0 THEN
    RAISE EXCEPTION 'Allocation exceeds available stock for supply_id %', NEW.supply_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deduct_supply
AFTER INSERT ON Allocations
FOR EACH ROW EXECUTE FUNCTION deduct_supply_on_allocation();

-- Log every capacity change for the materialized view / trend reporting
CREATE OR REPLACE FUNCTION log_capacity_change() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO Shelter_Capacity_Log(shelter_id, capacity_occupied) VALUES (NEW.shelter_id, NEW.capacity_occupied);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_log_capacity
AFTER UPDATE OF capacity_occupied ON Shelters
FOR EACH ROW EXECUTE FUNCTION log_capacity_change();
```

### 7.6 Views
```sql
CREATE VIEW Shelter_Live_Status AS
SELECT shelter_id, name, capacity_total, capacity_occupied,
  ROUND(100.0 * capacity_occupied / NULLIF(capacity_total,0), 1) AS occupancy_pct,
  CASE WHEN capacity_occupied >= capacity_total THEN 'full'
       WHEN capacity_occupied >= 0.9 * capacity_total THEN 'near-full'
       ELSE 'available' END AS status
FROM Shelters;

CREATE VIEW Critical_Supply_Shortage AS
SELECT s.shelter_id, sh.name AS shelter_name, s.item_name, s.quantity, s.reorder_threshold
FROM Supplies s JOIN Shelters sh ON s.shelter_id = sh.shelter_id
WHERE s.quantity <= s.reorder_threshold;
```

### 7.7 Window functions
```sql
-- Rank shelters by occupancy within each disaster event
SELECT s.shelter_id, s.name, s.event_id,
  ROUND(100.0 * s.capacity_occupied / NULLIF(s.capacity_total,0), 1) AS occupancy_pct,
  RANK() OVER (
    PARTITION BY s.event_id
    ORDER BY s.capacity_occupied::float / NULLIF(s.capacity_total,0) DESC
  ) AS occupancy_rank
FROM Shelters s;

-- Running total of allocations per shelter over time
SELECT a.allocation_id, s.shelter_id, a.allocated_at, a.quantity_allocated,
  SUM(a.quantity_allocated) OVER (PARTITION BY s.shelter_id ORDER BY a.allocated_at) AS running_total
FROM Allocations a JOIN Supplies s ON a.supply_id = s.supply_id;
```

### 7.8 Recursive CTE (volunteer task dependency tree)
```sql
WITH RECURSIVE task_tree AS (
  SELECT task_id, parent_task_id, description, status, 1 AS depth
  FROM Volunteer_Tasks
  WHERE parent_task_id IS NULL AND shelter_id = 1
  UNION ALL
  SELECT t.task_id, t.parent_task_id, t.description, t.status, tt.depth + 1
  FROM Volunteer_Tasks t
  JOIN task_tree tt ON t.parent_task_id = tt.task_id
)
SELECT * FROM task_tree ORDER BY depth, task_id;
```

### 7.9 Materialized view (reporting)
```sql
CREATE MATERIALIZED VIEW mv_daily_capacity_trend AS
SELECT shelter_id, date_trunc('day', logged_at) AS day, MAX(capacity_occupied) AS peak_occupied
FROM Shelter_Capacity_Log
GROUP BY shelter_id, date_trunc('day', logged_at);

-- Must be refreshed manually or via pg_cron; it will show stale data otherwise
REFRESH MATERIALIZED VIEW mv_daily_capacity_trend;
```

### 7.10 Indexing
```sql
CREATE INDEX idx_shelters_location ON Shelters(latitude, longitude);  -- B-tree, speeds up range queries
CREATE INDEX idx_users_phone_btree ON Users USING btree(phone);
CREATE INDEX idx_users_phone_hash ON Users USING hash(phone);          -- faster for exact-match login lookups, but no range/sort support
```
Baseline vs. after comparison should be captured with `EXPLAIN ANALYZE` and saved to `database/queries/`.

---

## 8. Concurrency Control — Demo Scripts (Module 6, the strongest part of the project)

**Isolation level comparison** — run two overlapping sessions:
```sql
-- Session A
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT capacity_occupied FROM Shelters WHERE shelter_id = 1;
-- pause; run Session B fully before continuing
UPDATE Shelters SET capacity_occupied = capacity_occupied + 2 WHERE shelter_id = 1;
COMMIT; -- expect: "could not serialize access due to concurrent update"

-- Session B (run while A is paused)
BEGIN ISOLATION LEVEL SERIALIZABLE;
UPDATE Shelters SET capacity_occupied = capacity_occupied + 2 WHERE shelter_id = 1;
COMMIT;
```
Compare against the same sequence under default `READ COMMITTED` (succeeds silently, weaker guarantee).

**Engineered deadlock** — two sessions locking two shelters in opposite order:
```sql
-- Session A
BEGIN;
UPDATE Shelters SET capacity_occupied = capacity_occupied + 1 WHERE shelter_id = 1;
-- pause
UPDATE Shelters SET capacity_occupied = capacity_occupied + 1 WHERE shelter_id = 2;
COMMIT;

-- Session B (start while A is paused)
BEGIN;
UPDATE Shelters SET capacity_occupied = capacity_occupied + 1 WHERE shelter_id = 2;
-- pause
UPDATE Shelters SET capacity_occupied = capacity_occupied + 1 WHERE shelter_id = 1;
COMMIT;
```
Postgres's deadlock detector aborts one session with `ERROR: deadlock detected`. Prevention strategy to document: always acquire locks in a consistent order (e.g., always lock the lower `shelter_id` first).

**Overbooking concurrency test** (`server/tests/concurrency-test.js`):
```js
async function attemptCheckin(shelterId, numPeople, label) {
  const res = await fetch(`http://localhost:5000/api/shelters/${shelterId}/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TEST_TOKEN}` },
    body: JSON.stringify({ num_people: numPeople })
  });
  console.log(`${label} → status ${res.status}:`, await res.json());
}

Promise.all([
  attemptCheckin(1, 2, 'Group A'), attemptCheckin(1, 2, 'Group B'), attemptCheckin(1, 2, 'Group C'),
  attemptCheckin(1, 2, 'Group D'), attemptCheckin(1, 2, 'Group E'),
]);
```
Verify after: `SELECT capacity_total, capacity_occupied FROM Shelters WHERE shelter_id = 1;` — must never exceed `capacity_total`.

---

## 9. Backend (Express)

`server/.env`:
```
DATABASE_URL=your_supabase_connection_string_here
JWT_SECRET=pick_a_long_random_string_here
PORT=5000
```

`server/db.js`:
```js
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
module.exports = pool;
```

`server/index.js`:
```js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors()); app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/shelters', require('./routes/shelters'));
app.use('/api/aid-requests', require('./routes/aidRequests'));
app.use('/api/supplies', require('./routes/supplies'));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

Route style (keep routes this thin — this is the whole design philosophy of the project):
```js
// routes/shelters.js
router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM Shelter_Live_Status ORDER BY shelter_id');
  res.json(result.rows);
});

router.get('/nearest', async (req, res) => {
  const { lat, lon, people } = req.query;
  const result = await pool.query('SELECT * FROM find_nearest_shelters($1,$2,$3,5)', [lat, lon, people || 1]);
  res.json(result.rows);
});

router.post('/:id/checkin', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { num_people } = req.body;
  const result = await pool.query('SELECT checkin_to_shelter($1,$2) AS success', [id, num_people]);
  if (result.rows[0].success) {
    req.app.get('io').emit('shelter-updated', { shelterId: id });
    return res.json({ success: true });
  }
  res.status(409).json({ success: false, message: 'Not enough space' });
});

router.get('/ranked', async (req, res) => {
  const result = await pool.query(`
    SELECT shelter_id, name, event_id,
      ROUND(100.0 * capacity_occupied / NULLIF(capacity_total,0),1) AS occupancy_pct,
      RANK() OVER (PARTITION BY event_id ORDER BY capacity_occupied::float/NULLIF(capacity_total,0) DESC) AS occupancy_rank
    FROM Shelters`);
  res.json(result.rows);
});
```
- `routes/auth.js` + `middleware/auth.js`: standard JWT pattern — bcrypt-hash passwords, `POST /login` verifies + signs a token, `requireAuth` guards writes.
- `routes/aidRequests.js` wraps `get_priority_queue()`.
- `routes/supplies.js` wraps `Critical_Supply_Shortage` and calls `allocate_supply()`.

---

## 10. Frontends

**Coordinator Dashboard** (required screens only — don't add filler admin pages):
1. Live shelter board — `GET /api/shelters`, subscribes to `shelter-updated` Socket.io event, re-fetches on trigger.
2. Ranked occupancy view — `GET /api/shelters/ranked` (window function endpoint).
3. Critical shortage banner — `Critical_Supply_Shortage` endpoint.
4. Priority queue — `get_priority_queue()` endpoint.

**Public/Volunteer Portal** (two screens only):
1. Geolocation-based nearest-shelter finder (`/api/shelters/nearest`, Leaflet map).
```jsx
export default function FindShelter() {
  const [shelters, setShelters] = useState([]);
  const locateAndSearch = () => {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const res = await axios.get('http://localhost:5000/api/shelters/nearest', {
        params: { lat: latitude, lon: longitude, people: 1 }
      });
      setShelters(res.data);
    });
  };
  return (
    <div>
      <button onClick={locateAndSearch}>Find shelters near me</button>
      <ul>{shelters.map(s => <li key={s.shelter_id}>{s.name} — {s.distance_km} km — {s.available_space} free</li>)}</ul>
    </div>
  );
}
```
2. Aid-request submission form (`POST /api/aid-requests`) — reused for volunteer signup if time is short.

---

## 11. Team Roles

| Person | Focus areas |
|---|---|
| **A** | Core schema + normalization write-up, auth (backend), dashboard live board, overbooking concurrency testing |
| **B** | Triggers/audit logic, transactions & ACID (`allocate_supply`), isolation-level & deadlock demo scripts, shelters + check-in API, dashboard supply/volunteer screens |
| **C** | Stored procedures + views + window functions + recursive CTE, aid-request/supplies API, app's shelter finder + map |
| **D** | Repo setup + Supabase, materialized view + indexing/query-optimization work, backup/recovery (`pg_dump`), volunteers API + concurrency test scripts, app's request form |

Everyone works across DB, backend, and frontend at different points — the DB workload (~6 of 12 weeks) is deliberately shared, not stacked on one person.

---

## 12. Deployment

- **DB:** Supabase (already live once schema is run).
- **Backend:** Render — connect repo, root directory `server`, env vars `DATABASE_URL` / `JWT_SECRET`.
- **Frontends:** Vercel, one project per app (`coordinator-dashboard`, `public-portal`), `VITE_API_URL` pointing at the Render backend URL.

---

## 13. Backup & Recovery

```bash
pg_dump "your_connection_string" -F c -f backup_reliefgrid.dump
pg_restore -d "your_connection_string" backup_reliefgrid.dump
```
Conceptual tie-in for the report: Postgres uses write-ahead logging (WAL) — changes are logged before being applied to data files, enabling crash recovery by replaying the log. `pg_dump`/`pg_restore` is a logical backup; WAL replay is Postgres's own physical recovery mechanism underneath it.

---

## 14. 12-Week Time Budget

| Weeks | Focus |
|---|---|
| 1 | Repo setup, planning, ER modeling, normalization |
| 2 | Core schema DDL, start advanced DB programming |
| 2–3 | Advanced DB programming (procedures, triggers, views, window fns, recursive CTE, materialized view) |
| 3 | Transactions & ACID |
| 3–4 | Concurrency control deep-dive (locking, isolation levels, deadlocks) |
| 4 | Indexing, query optimization, backup/recovery |
| 5 | Backend setup & auth |
| 5–6 | Core APIs (thin wrappers) |
| 6 | Concurrency/isolation/deadlock test scripts |
| 7–8 | Coordinator dashboard |
| 9 | Public portal |
| 10 | Integration & hardening |
| 11 | Deployment |
| 12 | Demo video + report finalization |

Roughly **6 weeks of DB-layer work vs. ~3.5 weeks of app-layer work** — this ratio is intentional and should be preserved; if scope needs to shrink under time pressure, cut frontend polish before cutting DB features.

---

## 15. Troubleshooting Reference

| Symptom | Likely cause | Fix |
|---|---|---|
| `ECONNREFUSED` connecting to Postgres | Wrong `DATABASE_URL` | Re-copy the URI from Supabase Project Settings |
| Check-in test shows overbooking | Using `checkin_unsafe` instead of `checkin_to_shelter`, or missing `FOR UPDATE` | Confirm the deployed function body includes `FOR UPDATE` |
| Deadlock never triggers | Statements committed too fast / not run in true parallel sessions | Add an explicit pause between each session's two `UPDATE`s so both hold their first lock before either requests the second |
| `SERIALIZABLE` test doesn't show a failure | Both transactions touched disjoint data, or one committed before the other began | Ensure both sessions overlap in time and touch the same row |
| Materialized view shows stale data | Forgot to `REFRESH MATERIALIZED VIEW` | Refresh manually before demoing, or set up `pg_cron` |
| Recursive CTE returns nothing | No row with `parent_task_id IS NULL` for that shelter | Seed at least one top-level task per shelter |
| Socket.io updates not appearing live | CORS mismatch or `io.emit` not called after the DB write | Confirm `cors: { origin: '*' }`, and the emit is inside the route handler |
| `401 Unauthorized` on protected routes | Token not attached or `JWT_SECRET` mismatch | Check `Authorization: Bearer <token>` header and `.env` values on both sides |
| `find_nearest_shelters` returns nothing | No shelters within `required_space`, or lat/lon swapped | `SELECT * FROM Shelters` first; confirm argument order |

---

## 16. Report / Deliverable Checklist

1. GitHub repo structure, all collaborators
2. Schema — all ten tables visible
3. `find_nearest_shelters` returning rows
4. Ranked-occupancy window-function query result
5. Recursive CTE task-tree output
6. ACID rollback demo (quantity unchanged after forced failure)
7. Deadlock error message (`deadlock detected`) + prevention write-up
8. `EXPLAIN ANALYZE` — Seq Scan vs Index Scan, side by side
9. `pg_dump` backup file created
10. Postman login returning JWT
11. Check-in succeeding, then `409` once full
12. **Concurrency test terminal output + DB proof of no overbooking** (the key screenshot)
13. Two browser tabs, live Socket.io sync
14. Public portal map view with nearby shelters
15. Both deployed apps live, pulling real data

Report should also include: the normalization walkthrough (`database/normalization.md`) as its own appendix, the ACID property table (§7.4 context), and the syllabus-map table (§3) reproduced near the intro.

---

## 17. Ground Rules for the AI Agent

- **Preserve the DB-first architecture.** If a feature could be done in SQL (a function/view/trigger) or in JS, default to SQL, and explain the choice in comments if it's non-obvious.
- **Don't remove or "simplify away" the concurrency, transaction, or normalization work** — these are the graded centerpieces, not optional polish.
- **Keep Express routes thin.** A route ballooning past a query-and-response is a signal that logic drifted into the wrong layer — push it back into a function/procedure.
- **When adding new features, check §3 first** — prefer solutions that map to an untouched or reinforced syllabus module over ones that don't.
- **Naming:** the project is called **ReliefGrid**. Use this name in READMEs, page titles, commit messages, and any generated docs — not "Disaster Relief System" or generic placeholders.
- **Don't invent scope** beyond §2's boundaries (no payment processing, no SMS, no multi-region, no PostGIS) unless the user explicitly asks to expand scope.