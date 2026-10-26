-- Phase 3 — Capacity truth (Audit #19, #20, #21, #22)
-- Safe checkout, status-aware check-in, explicit not-found handling,
-- and event-/status-aware live totals.

-- Restrict Shelters.status to the two values the app actually understands.
-- (checkin_to_shelter() below treats anything else as inactive, but a CHECK
-- stops a typo'd status from silently behaving like "inactive".)
DO $$
DECLARE
  normalised_count INT;
BEGIN
  -- Either name means the rule is already enforced: schema.sql names it
  -- shelters_status_valid from now on, but databases created from an older
  -- schema.sql carry the auto-generated shelters_status_check.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'shelters'::regclass
      AND contype = 'c'
      AND conname IN ('shelters_status_valid', 'shelters_status_check')
  ) THEN
    -- The column had no constraint before this migration, so an existing row
    -- could hold something other than 'active'/'inactive'. Normalise first so
    -- the ALTER below cannot fail a deploy — but normalise *closed*: an
    -- unknown or typo'd status was already invisible to find_nearest_shelters()
    -- and rejected by checkin_to_shelter(), so flipping it to 'active' would
    -- newly publish a shelter to the public portal that nobody has confirmed
    -- is operating. Coordinators can reopen a row deliberately.
    WITH normalised AS (
      UPDATE Shelters SET status = 'inactive'
      WHERE status IS NULL OR status NOT IN ('active', 'inactive')
      RETURNING shelter_id
    )
    SELECT count(*) INTO normalised_count FROM normalised;

    IF normalised_count > 0 THEN
      RAISE NOTICE 'Normalised % Shelters.status row(s) to inactive — reopen any of them that are actually operating.', normalised_count;
    END IF;

    ALTER TABLE Shelters
      ADD CONSTRAINT shelters_status_valid CHECK (status IN ('active', 'inactive'));
  END IF;
END;
$$;

-- checkin_to_shelter() used to return BOOLEAN, which couldn't distinguish
-- "not enough space" from "no such shelter" or "shelter is closed". It now
-- returns one of: 'ok', 'not_found', 'inactive', 'full'.
DROP FUNCTION IF EXISTS checkin_to_shelter(INT, INT);

CREATE FUNCTION checkin_to_shelter(p_shelter_id INT, p_num_people INT) RETURNS VARCHAR AS $$
DECLARE
  occ INT; tot INT; shelter_status VARCHAR;
BEGIN
  IF p_num_people IS NULL OR p_num_people <= 0 THEN
    RETURN 'invalid_quantity';
  END IF;

  SELECT capacity_occupied, capacity_total, status INTO occ, tot, shelter_status
  FROM Shelters WHERE shelter_id = p_shelter_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF shelter_status IS DISTINCT FROM 'active' THEN
    RETURN 'inactive';
  END IF;

  IF occ + p_num_people > tot THEN
    RETURN 'full';
  END IF;

  UPDATE Shelters SET capacity_occupied = occ + p_num_people WHERE shelter_id = p_shelter_id;
  RETURN 'ok';
END;
$$ LANGUAGE plpgsql;

-- New counterpart to checkin_to_shelter(): decrements occupancy under the
-- same row lock, never letting it go negative. Returns 'ok', 'not_found',
-- or 'exceeds_occupancy'.
CREATE OR REPLACE FUNCTION checkout_from_shelter(p_shelter_id INT, p_num_people INT) RETURNS VARCHAR AS $$
DECLARE
  occ INT;
BEGIN
  IF p_num_people IS NULL OR p_num_people <= 0 THEN
    RETURN 'invalid_quantity';
  END IF;

  SELECT capacity_occupied INTO occ
  FROM Shelters WHERE shelter_id = p_shelter_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF p_num_people > occ THEN
    RETURN 'exceeds_occupancy';
  END IF;

  UPDATE Shelters SET capacity_occupied = occ - p_num_people WHERE shelter_id = p_shelter_id;
  RETURN 'ok';
END;
$$ LANGUAGE plpgsql;

-- Shelter_Live_Status now carries event context and the active/inactive
-- lifecycle flag so the dashboard can scope totals to one event and active
-- shelters only. New columns are appended at the end (CREATE OR REPLACE VIEW
-- cannot reorder or remove existing columns).
CREATE OR REPLACE VIEW Shelter_Live_Status AS
SELECT s.shelter_id, s.name, s.capacity_total, s.capacity_occupied,
  ROUND(100.0 * s.capacity_occupied / NULLIF(s.capacity_total,0), 1) AS occupancy_pct,
  CASE WHEN s.capacity_occupied >= s.capacity_total THEN 'full'
       WHEN s.capacity_occupied >= 0.9 * s.capacity_total THEN 'near-full'
       ELSE 'available' END AS status,
  s.event_id, e.name AS event_name,
  (s.status = 'active') AS is_active
FROM Shelters s
LEFT JOIN Disaster_Events e ON e.event_id = s.event_id;
