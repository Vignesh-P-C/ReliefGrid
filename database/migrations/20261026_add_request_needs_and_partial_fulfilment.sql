-- ============================================================
-- ReliefGrid — Phase 2: allocation integrity
--
-- Adds an item-level model of what a request actually needs, links
-- every allocation to the need it satisfies, and rewrites
-- allocate_supply() so a request stays open until its need is met.
--
-- Apply order (see database/migrations/README.md):
--   1. 20261016_add_supply_id_to_shortage_view.sql
--   2. 20261025_add_aid_request_triage.sql
--   3. this file
--
-- Safe to re-run: every statement is either idempotent or guarded.
-- ============================================================

-- ------------------------------------------------------------
-- 1. REQUEST NEEDS — what the requester actually asked for
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS Request_Needs (
  need_id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES Aid_Requests(request_id) ON DELETE CASCADE,
  -- NULL only for an estimate: the requester did not name a supply type,
  -- so any compatible item may be allocated against it.
  category_id INT REFERENCES Supply_Categories(category_id),
  item_label VARCHAR(100),
  quantity_needed INT NOT NULL CHECK (quantity_needed > 0),
  is_estimate BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT request_needs_named_or_estimated CHECK (is_estimate OR category_id IS NOT NULL),
  CONSTRAINT request_needs_label_not_blank CHECK (item_label IS NULL OR btrim(item_label) <> '')
);

CREATE INDEX IF NOT EXISTS idx_request_needs_request ON Request_Needs(request_id);

-- Backfill open requests created before this migration. A named supply
-- category is used when the request type maps onto one; otherwise the need
-- is recorded as an explicit estimate rather than pretending to know.
INSERT INTO Request_Needs (request_id, category_id, item_label, quantity_needed, is_estimate)
SELECT r.request_id,
  c.category_id,
  CASE
    WHEN c.category_id IS NOT NULL THEN c.name || ' for ' || r.num_people || ' people'
    ELSE 'Unspecified relief items for ' || COALESCE(r.num_people, 1) || ' people'
  END,
  GREATEST(COALESCE(r.num_people, 1), 1),
  c.category_id IS NULL
FROM Aid_Requests r
LEFT JOIN Supply_Categories c ON lower(c.name) = lower(btrim(r.request_type))
WHERE r.status IN ('pending', 'partially_fulfilled')
  AND COALESCE(btrim(r.request_type), '') <> 'shelter'
  AND NOT EXISTS (SELECT 1 FROM Request_Needs n WHERE n.request_id = r.request_id);

-- ------------------------------------------------------------
-- 2. ALLOCATION ATTRIBUTION — which need, and who decided
-- ------------------------------------------------------------

ALTER TABLE Allocations
  ADD COLUMN IF NOT EXISTS need_id INT REFERENCES Request_Needs(need_id),
  ADD COLUMN IF NOT EXISTS allocated_by INT REFERENCES Users(user_id);

CREATE INDEX IF NOT EXISTS idx_allocations_need ON Allocations(need_id);
CREATE INDEX IF NOT EXISTS idx_allocations_request ON Allocations(request_id);

-- ------------------------------------------------------------
-- 3. REQUEST STATUS — represent partial fulfilment explicitly
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aid_requests_status_allowed'
      AND conrelid = 'aid_requests'::regclass
  ) THEN
    -- Existing rows only ever used 'pending' and 'fulfilled'; cancel any
    -- unexpected value rather than letting the constraint fail the deploy.
    UPDATE Aid_Requests SET status = 'pending'
    WHERE status IS NULL OR status NOT IN ('pending', 'partially_fulfilled', 'fulfilled', 'cancelled');

    ALTER TABLE Aid_Requests
      ADD CONSTRAINT aid_requests_status_allowed
      CHECK (status IN ('pending', 'partially_fulfilled', 'fulfilled', 'cancelled'));
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 4. SHORTAGE VIEW — expose the fields the allocation UI needs
--
-- Supersedes the view created by 20261016. Appending columns keeps this
-- a valid CREATE OR REPLACE for databases that already have that version.
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW Critical_Supply_Shortage AS
SELECT s.shelter_id, sh.name AS shelter_name, s.item_name, s.quantity,
       s.reorder_threshold, s.supply_id, s.unit, s.category_id,
       c.name AS category_name
FROM Supplies s
JOIN Shelters sh ON s.shelter_id = sh.shelter_id
LEFT JOIN Supply_Categories c ON c.category_id = s.category_id
WHERE s.quantity <= s.reorder_threshold;

-- ------------------------------------------------------------
-- 5. allocate_supply() — request-aware, partial-aware allocation
--
-- Returns a domain result instead of a bare boolean so the API can tell
-- "no stock" apart from "already fulfilled" and answer with the right
-- status code. Locks the request row first, then the supply row, so
-- concurrent allocations of one request serialise (consistent lock order
-- also removes the deadlock risk of locking them in the other order).
-- ------------------------------------------------------------

-- Return type changes, so the old signatures must go explicitly.
DROP FUNCTION IF EXISTS allocate_supply(INT, INT, INT);

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

  -- Lock the request first: this serialises every allocation for the same
  -- request, so two coordinators cannot both pass the eligibility check.
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
    -- No need chosen: pick the first unmet need this item can satisfy,
    -- preferring a named category over an estimate.
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

  -- The allocation trigger deducts stock and aborts the whole call if the
  -- balance would go negative, so this insert stays atomic with the update.
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

-- ------------------------------------------------------------
-- 6. get_priority_queue() — carry status and per-need progress
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS get_priority_queue();

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
