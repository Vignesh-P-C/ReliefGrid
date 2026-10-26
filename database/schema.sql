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
  reviewed_priority SMALLINT CHECK (reviewed_priority BETWEEN 1 AND 5),
  reviewed_by INT REFERENCES Users(user_id),
  reviewed_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT now(),
  CONSTRAINT aid_requests_review_metadata_complete CHECK (
    (reviewed_priority IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (reviewed_priority IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT aid_requests_status_allowed CHECK (
    status IN ('pending', 'partially_fulfilled', 'fulfilled', 'cancelled')
  )
);

-- What a request actually asked for. One row per requested supply type, so a
-- family asking for food and medical items has two needs and stays open until
-- both are met. is_estimate marks a need whose supply type was never named.
CREATE TABLE Request_Needs (
  need_id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES Aid_Requests(request_id) ON DELETE CASCADE,
  category_id INT REFERENCES Supply_Categories(category_id),
  item_label VARCHAR(100),
  quantity_needed INT NOT NULL CHECK (quantity_needed > 0),
  is_estimate BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT request_needs_named_or_estimated CHECK (is_estimate OR category_id IS NOT NULL),
  CONSTRAINT request_needs_label_not_blank CHECK (item_label IS NULL OR btrim(item_label) <> '')
);

CREATE TABLE Allocations (
  allocation_id SERIAL PRIMARY KEY,
  request_id INT REFERENCES Aid_Requests(request_id),
  supply_id INT REFERENCES Supplies(supply_id),
  quantity_allocated INT CHECK (quantity_allocated > 0),
  need_id INT REFERENCES Request_Needs(need_id),   -- which need this stock satisfied
  allocated_by INT REFERENCES Users(user_id),      -- who made the decision
  allocated_at TIMESTAMP DEFAULT now()
);


-- ============================================================
-- 2. FUNCTIONS
-- ============================================================

-- 2.1 Geospatial nearest-shelter matching (haversine distance).
-- Shelters with enough room for req_space sort first (has_space), but a
-- full shelter still appears instead of vanishing from the result set —
-- the caller decides what to do with a "full" nearest option (Audit #41).
CREATE OR REPLACE FUNCTION find_nearest_shelters(
  in_lat NUMERIC, in_lon NUMERIC, req_space INT, max_results INT
) RETURNS TABLE(
  shelter_id INT, name VARCHAR, distance_km NUMERIC, available_space INT,
  latitude NUMERIC, longitude NUMERIC, address TEXT, contact_number VARCHAR,
  has_space BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.shelter_id, s.name,
    ROUND((6371 * acos(LEAST(1::double precision, GREATEST(-1::double precision,
      cos(radians(in_lat)) * cos(radians(s.latitude)) *
      cos(radians(s.longitude) - radians(in_lon)) +
      sin(radians(in_lat)) * sin(radians(s.latitude))
    ))))::numeric, 2) AS distance_km,
    (s.capacity_total - s.capacity_occupied) AS available_space,
    s.latitude, s.longitude, s.address, s.contact_number,
    (s.capacity_total - s.capacity_occupied) >= req_space AS has_space
  FROM Shelters s
  WHERE s.status = 'active'
    AND in_lat BETWEEN -90 AND 90
    AND in_lon BETWEEN -180 AND 180
  ORDER BY has_space DESC, distance_km ASC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- 2.2 Priority queue (reviewed priority when set, with one ageing step per 24 hours)
CREATE OR REPLACE FUNCTION get_priority_queue()
RETURNS TABLE(
  request_id INT,
  requester_name VARCHAR,
  phone VARCHAR,
  request_type VARCHAR,
  urgency_level SMALLINT,
  reviewed_priority SMALLINT,
  reviewed_by INT,
  reviewer_name VARCHAR,
  reviewed_at TIMESTAMPTZ,
  effective_priority INT,
  num_people INT,
  waiting_minutes NUMERIC,
  created_at TIMESTAMP,
  latitude NUMERIC,
  longitude NUMERIC,
  nearest_shelter_name VARCHAR,
  nearest_shelter_distance_km NUMERIC,
  nearest_shelter_available_space INT,
  status VARCHAR,
  needs JSONB
) AS $$
  SELECT r.request_id, r.requester_name, r.phone, r.request_type,
    r.urgency_level, r.reviewed_priority, r.reviewed_by, reviewer.name,
    r.reviewed_at,
    LEAST(
      5,
      COALESCE(r.reviewed_priority, r.urgency_level, 1)
        + FLOOR(GREATEST(0, EXTRACT(EPOCH FROM (now() - r.created_at)) / 86400))
    )::INT,
    r.num_people,
    ROUND(GREATEST(0, EXTRACT(EPOCH FROM (now() - r.created_at)) / 60), 1),
    r.created_at,
    r.latitude,
    r.longitude,
    nearby.name,
    nearby.distance_km,
    nearby.available_space,
    r.status,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'need_id', n.need_id,
        'category_id', n.category_id,
        'category_name', c.name,
        'item_label', COALESCE(n.item_label, c.name || ' for ' || COALESCE(r.num_people, 1) || ' people'),
        'quantity_needed', n.quantity_needed,
        'quantity_allocated', COALESCE((
          SELECT SUM(a.quantity_allocated) FROM Allocations a WHERE a.need_id = n.need_id
        ), 0),
        'is_estimate', n.is_estimate
      ) ORDER BY n.need_id)
      FROM Request_Needs n
      LEFT JOIN Supply_Categories c ON c.category_id = n.category_id
      WHERE n.request_id = r.request_id
    ), '[]'::jsonb)
  FROM Aid_Requests r
  LEFT JOIN Users reviewer ON reviewer.user_id = r.reviewed_by
  LEFT JOIN LATERAL (
    SELECT shelter.name, shelter.distance_km, shelter.available_space
    FROM find_nearest_shelters(
      CASE WHEN r.latitude BETWEEN -90 AND 90 THEN r.latitude END,
      CASE WHEN r.longitude BETWEEN -180 AND 180 THEN r.longitude END,
      COALESCE(r.num_people, 1),
      1
    ) AS shelter
    WHERE r.latitude BETWEEN -90 AND 90 AND r.longitude BETWEEN -180 AND 180
  ) AS nearby ON TRUE
  WHERE r.status IN ('pending', 'partially_fulfilled')
  ORDER BY
    LEAST(
      5,
      COALESCE(r.reviewed_priority, r.urgency_level, 1)
        + FLOOR(GREATEST(0, EXTRACT(EPOCH FROM (now() - r.created_at)) / 86400))
    ) DESC,
    r.created_at ASC,
    r.request_id ASC;
$$ LANGUAGE sql STABLE;

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

-- 2.4 Atomic supply allocation — validate the request, the need and the
-- stock, then insert the allocation and update the request status as one
-- unit. The allocation trigger deducts stock; if any step fails, all of it
-- rolls back (Module 5: transactions & ACID).
--
-- Returns a domain result instead of a bare boolean so the API can answer
-- with the right status code. The request row is locked before the supply
-- row, so concurrent allocations of one request serialise and cannot both
-- consume the last unit of need.
CREATE OR REPLACE FUNCTION allocate_supply(
  p_request_id INT,
  p_supply_id INT,
  p_qty INT,
  p_need_id INT DEFAULT NULL,
  p_allocated_by INT DEFAULT NULL
) RETURNS TABLE (
  success BOOLEAN,
  code TEXT,
  message TEXT,
  request_status VARCHAR,
  need_id INT,
  remaining_need INT,
  available_stock INT
) AS $$
DECLARE
  v_status VARCHAR(20);
  v_stock INT;
  v_supply_category INT;
  v_need_category INT;
  v_need_total INT;
  v_need_allocated INT;
  v_remaining INT;
  v_need_count INT;
  v_met_count INT;
  v_started_count INT;
  v_next_status VARCHAR(20);
  v_need_id INT;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN QUERY SELECT FALSE, 'invalid_quantity'::TEXT,
      'Quantity must be a positive whole number'::TEXT,
      NULL::VARCHAR, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  SELECT r.status INTO v_status
  FROM Aid_Requests r
  WHERE r.request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'request_not_found'::TEXT,
      format('Request %s does not exist', p_request_id)::TEXT,
      NULL::VARCHAR, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  IF v_status NOT IN ('pending', 'partially_fulfilled') THEN
    RETURN QUERY SELECT FALSE, 'request_not_eligible'::TEXT,
      format('Request %s is already %s and cannot receive more stock',
             p_request_id, replace(v_status, '_', ' '))::TEXT,
      v_status, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  SELECT s.quantity, s.category_id INTO v_stock, v_supply_category
  FROM Supplies s
  WHERE s.supply_id = p_supply_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'supply_not_found'::TEXT,
      format('Supply item %s does not exist', p_supply_id)::TEXT,
      v_status, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  IF p_need_id IS NOT NULL THEN
    SELECT n.need_id, n.category_id, n.quantity_needed
    INTO v_need_id, v_need_category, v_need_total
    FROM Request_Needs n
    WHERE n.need_id = p_need_id AND n.request_id = p_request_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, 'need_not_found'::TEXT,
        format('Need %s does not belong to request %s', p_need_id, p_request_id)::TEXT,
        v_status, NULL::INT, NULL::INT, v_stock;
      RETURN;
    END IF;
  ELSE
    SELECT n.need_id, n.category_id, n.quantity_needed
    INTO v_need_id, v_need_category, v_need_total
    FROM Request_Needs n
    WHERE n.request_id = p_request_id
      AND (n.category_id IS NULL OR n.category_id = v_supply_category)
      AND n.quantity_needed > COALESCE(
        (SELECT SUM(a.quantity_allocated) FROM Allocations a WHERE a.need_id = n.need_id), 0)
    ORDER BY (n.category_id IS NULL), n.need_id
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT COUNT(*) INTO v_need_count FROM Request_Needs n WHERE n.request_id = p_request_id;
      IF v_need_count = 0 THEN
        RETURN QUERY SELECT FALSE, 'no_item_needs'::TEXT,
          'This request has no item needs. Shelter requests are served by check-in.'::TEXT,
          v_status, NULL::INT, NULL::INT, v_stock;
        RETURN;
      END IF;

      -- Distinguish "this item is wrong for the request" from "everything the
      -- request asked for is already covered", including the case where a
      -- concurrent allocation just met the last unit of need.
      SELECT n.need_id INTO v_need_id
      FROM Request_Needs n
      WHERE n.request_id = p_request_id
        AND (n.category_id IS NULL OR n.category_id = v_supply_category)
      ORDER BY (n.category_id IS NULL), n.need_id
      LIMIT 1;

      IF FOUND THEN
        RETURN QUERY SELECT FALSE, 'need_already_met'::TEXT,
          'This request''s need for this item is already met'::TEXT,
          v_status, v_need_id, 0, v_stock;
      ELSE
        RETURN QUERY SELECT FALSE, 'no_matching_need'::TEXT,
          'This item does not match any remaining need on the request'::TEXT,
          v_status, NULL::INT, NULL::INT, v_stock;
      END IF;
      RETURN;
    END IF;
  END IF;

  IF v_need_category IS NOT NULL AND v_supply_category IS DISTINCT FROM v_need_category THEN
    RETURN QUERY SELECT FALSE, 'need_mismatch'::TEXT,
      'This stock does not match the requested supply category'::TEXT,
      v_status, v_need_id, NULL::INT, v_stock;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(a.quantity_allocated), 0) INTO v_need_allocated
  FROM Allocations a
  WHERE a.need_id = v_need_id;

  v_remaining := v_need_total - v_need_allocated;

  IF v_remaining <= 0 THEN
    RETURN QUERY SELECT FALSE, 'need_already_met'::TEXT,
      'This need is already met'::TEXT,
      v_status, v_need_id, 0, v_stock;
    RETURN;
  END IF;

  IF p_qty > v_remaining THEN
    RETURN QUERY SELECT FALSE, 'exceeds_remaining_need'::TEXT,
      format('Only %s still needed for this request', v_remaining)::TEXT,
      v_status, v_need_id, v_remaining, v_stock;
    RETURN;
  END IF;

  IF v_stock < p_qty THEN
    RETURN QUERY SELECT FALSE, 'insufficient_stock'::TEXT,
      format('Only %s left in stock at this shelter', v_stock)::TEXT,
      v_status, v_need_id, v_remaining, v_stock;
    RETURN;
  END IF;

  INSERT INTO Allocations(request_id, supply_id, quantity_allocated, need_id, allocated_by)
  VALUES (p_request_id, p_supply_id, p_qty, v_need_id, p_allocated_by);

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE COALESCE(alloc.total, 0) >= n.quantity_needed),
         COUNT(*) FILTER (WHERE COALESCE(alloc.total, 0) > 0)
  INTO v_need_count, v_met_count, v_started_count
  FROM Request_Needs n
  LEFT JOIN LATERAL (
    SELECT SUM(a.quantity_allocated) AS total
    FROM Allocations a WHERE a.need_id = n.need_id
  ) alloc ON TRUE
  WHERE n.request_id = p_request_id;

  v_next_status := CASE
    WHEN v_need_count > 0 AND v_met_count = v_need_count THEN 'fulfilled'
    WHEN v_started_count > 0 THEN 'partially_fulfilled'
    ELSE 'pending'
  END;

  UPDATE Aid_Requests SET status = v_next_status WHERE request_id = p_request_id;

  RETURN QUERY SELECT TRUE, 'ok'::TEXT,
    format('Allocated %s of supply %s to request %s', p_qty, p_supply_id, p_request_id)::TEXT,
    v_next_status::VARCHAR, v_need_id, v_remaining - p_qty, v_stock - p_qty;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 3. TRIGGERS
-- ============================================================

-- 3.1 Deduct stock for every allocation and reject a negative balance.
CREATE OR REPLACE FUNCTION deduct_supply_on_allocation() RETURNS TRIGGER AS $$
BEGIN
  UPDATE Supplies
  SET quantity = quantity - NEW.quantity_allocated
  WHERE supply_id = NEW.supply_id
    AND quantity >= NEW.quantity_allocated;

  IF NOT FOUND THEN
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

CREATE OR REPLACE VIEW Critical_Supply_Shortage AS
SELECT s.shelter_id, sh.name AS shelter_name, s.item_name, s.quantity,
       s.reorder_threshold, s.supply_id, s.unit, s.category_id,
       c.name AS category_name
FROM Supplies s
JOIN Shelters sh ON s.shelter_id = sh.shelter_id
LEFT JOIN Supply_Categories c ON c.category_id = s.category_id
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

-- Allocation lookups: needs per request, and allocations per need/request
-- (both are on the hot path of allocate_supply and get_priority_queue).
CREATE INDEX idx_request_needs_request ON Request_Needs(request_id);
CREATE INDEX idx_allocations_need ON Allocations(need_id);
CREATE INDEX idx_allocations_request ON Allocations(request_id);


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
