-- Phase 4 — Portal trust (Audit #39, #40, #41)
-- find_nearest_shelters() now accounts for household size in its ordering
-- (not its filter), returns shelter location/contact details, and no
-- longer silently drops full shelters from the result set.

DROP FUNCTION IF EXISTS find_nearest_shelters(NUMERIC, NUMERIC, INT, INT);

CREATE FUNCTION find_nearest_shelters(
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
  -- Shelters with enough room for this household sort first; shelters that
  -- are full still appear (flagged via has_space) instead of disappearing.
  ORDER BY has_space DESC, distance_km ASC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;
