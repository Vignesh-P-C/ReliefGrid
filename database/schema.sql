-- ============================================================
-- ReliefGrid — Disaster Relief Resource & Shelter Coordination
-- Full schema: tables, functions, triggers, views, indexes.
-- Run this whole file in the Supabase SQL editor.
-- Order matters: tables -> functions/triggers -> views -> indexes
-- (functions referencing tables that don't exist yet will fail).
-- ============================================================

-- ============================================================
-- 1. TABLES  (see database/normalization.md for the UNF->BCNF derivation)
-- ============================================================

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
  parent_task_id INT REFERENCES Volunteer_Tasks(task_id), -- self-ref, used by the recursive CTE
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


-- ============================================================
-- 2. FUNCTIONS
-- ============================================================

-- 2.1 Geospatial nearest-shelter matching (haversine distance)
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

-- 2.2 Priority queue (most urgent, then longest-waiting, first)
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

-- 2.3a UNSAFE check-in — kept ONLY as the "before" example for the report/demo.
-- Never call this from the application. It has a check-then-update race condition.
CREATE OR REPLACE FUNCTION checkin_unsafe(p_shelter_id INT, p_num_people INT) RETURNS BOOLEAN AS $$
DECLARE
  occ INT; tot INT;
BEGIN
  SELECT capacity_occupied, capacity_total INTO occ, tot FROM Shelters WHERE shelter_id = p_shelter_id;
  IF occ + p_num_people > tot THEN RETURN FALSE; END IF;
  UPDATE Shelters SET capacity_occupied = occ + p_num_people WHERE shelter_id = p_shelter_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 2.3b SAFE check-in — this is what the application actually calls.
-- FOR UPDATE takes a row lock so concurrent check-ins on the same shelter
-- serialize instead of racing (Module 6: lock-based concurrency control).
CREATE OR REPLACE FUNCTION checkin_to_shelter(p_shelter_id INT, p_num_people INT) RETURNS BOOLEAN AS $$
DECLARE
  occ INT; tot INT;
BEGIN
  SELECT capacity_occupied, capacity_total INTO occ, tot
  FROM Shelters WHERE shelter_id = p_shelter_id
  FOR UPDATE;

  IF occ + p_num_people > tot THEN
    RETURN FALSE;
  END IF;

  UPDATE Shelters SET capacity_occupied = occ + p_num_people WHERE shelter_id = p_shelter_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 2.4 Atomic supply allocation — deduct stock + record allocation + update
-- request status as one unit. If any step fails, all of it rolls back
-- (Module 5: transactions & ACID).
CREATE OR REPLACE FUNCTION allocate_supply(
  p_request_id INT, p_supply_id INT, p_qty INT
) RETURNS BOOLEAN AS $$
DECLARE
  available INT;
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


-- ============================================================
-- 3. TRIGGERS
-- ============================================================

-- 3.1 Belt-and-suspenders stock guard on every allocation insert
CREATE OR REPLACE FUNCTION deduct_supply_on_allocation() RETURNS TRIGGER AS $$
BEGIN
  UPDATE Supplies SET quantity = quantity - NEW.quantity_allocated
  WHERE supply_id = NEW.supply_id;

  IF (SELECT quantity FROM Supplies WHERE supply_id = NEW.supply_id) < 0 THEN
    RAISE EXCEPTION 'Allocation exceeds available stock for supply_id %', NEW.supply_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deduct_supply
AFTER INSERT ON Allocations
FOR EACH ROW EXECUTE FUNCTION deduct_supply_on_allocation();

-- 3.2 Log every capacity change (feeds the materialized view in section 5)
CREATE OR REPLACE FUNCTION log_capacity_change() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO Shelter_Capacity_Log(shelter_id, capacity_occupied)
  VALUES (NEW.shelter_id, NEW.capacity_occupied);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_log_capacity
AFTER UPDATE OF capacity_occupied ON Shelters
FOR EACH ROW EXECUTE FUNCTION log_capacity_change();


-- ============================================================
-- 4. VIEWS
-- ============================================================

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


-- ============================================================
-- 5. MATERIALIZED VIEW (reporting layer — must be refreshed manually or via pg_cron)
-- ============================================================

CREATE MATERIALIZED VIEW mv_daily_capacity_trend AS
SELECT shelter_id, date_trunc('day', logged_at) AS day,
  MAX(capacity_occupied) AS peak_occupied
FROM Shelter_Capacity_Log
GROUP BY shelter_id, date_trunc('day', logged_at);


-- ============================================================
-- 6. INDEXES
-- ============================================================

-- Speeds up the latitude/longitude range scan inside find_nearest_shelters()
CREATE INDEX idx_shelters_location ON Shelters(latitude, longitude);

-- B-tree vs hash comparison for exact-match login lookups (Module 4 talking point)
CREATE INDEX idx_users_phone_btree ON Users USING btree(phone);
CREATE INDEX idx_users_phone_hash ON Users USING hash(phone);


-- ============================================================
-- 7. REFERENCE QUERIES (not schema objects — copy these into
--    database/queries/ with their EXPLAIN ANALYZE / output screenshots)
-- ============================================================

-- 7.1 Window functions: rank shelters by occupancy within each disaster event
-- SELECT s.shelter_id, s.name, s.event_id,
--   ROUND(100.0 * s.capacity_occupied / NULLIF(s.capacity_total,0), 1) AS occupancy_pct,
--   RANK() OVER (
--     PARTITION BY s.event_id
--     ORDER BY s.capacity_occupied::float / NULLIF(s.capacity_total,0) DESC
--   ) AS occupancy_rank
-- FROM Shelters s;

-- 7.2 Window functions: running total of allocations per shelter over time
-- SELECT a.allocation_id, s.shelter_id, a.allocated_at, a.quantity_allocated,
--   SUM(a.quantity_allocated) OVER (PARTITION BY s.shelter_id ORDER BY a.allocated_at) AS running_total
-- FROM Allocations a JOIN Supplies s ON a.supply_id = s.supply_id;

-- 7.3 Recursive CTE: full task dependency tree for a shelter
-- WITH RECURSIVE task_tree AS (
--   SELECT task_id, parent_task_id, description, status, 1 AS depth
--   FROM Volunteer_Tasks
--   WHERE parent_task_id IS NULL AND shelter_id = 1
--   UNION ALL
--   SELECT t.task_id, t.parent_task_id, t.description, t.status, tt.depth + 1
--   FROM Volunteer_Tasks t
--   JOIN task_tree tt ON t.parent_task_id = tt.task_id
-- )
-- SELECT * FROM task_tree ORDER BY depth, task_id;
