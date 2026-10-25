-- Preserve requester-reported urgency while recording the latest staff review.
ALTER TABLE Aid_Requests
  ADD COLUMN IF NOT EXISTS reviewed_priority SMALLINT
    CHECK (reviewed_priority BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS reviewed_by INT REFERENCES Users(user_id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'aid_requests_review_metadata_complete'
      AND conrelid = 'aid_requests'::regclass
  ) THEN
    ALTER TABLE Aid_Requests
      ADD CONSTRAINT aid_requests_review_metadata_complete
      CHECK (
        (reviewed_priority IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
        OR (reviewed_priority IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
      );
  END IF;
END;
$$;

-- The returned columns changed, so replace the old function signature explicitly.
DROP FUNCTION IF EXISTS get_priority_queue();

CREATE OR REPLACE FUNCTION find_nearest_shelters(
  in_lat NUMERIC, in_lon NUMERIC, req_space INT, max_results INT
) RETURNS TABLE(shelter_id INT, name VARCHAR, distance_km NUMERIC, available_space INT) AS $$
BEGIN
  RETURN QUERY
  SELECT s.shelter_id, s.name,
    ROUND((6371 * acos(LEAST(1::double precision, GREATEST(-1::double precision,
      cos(radians(in_lat)) * cos(radians(s.latitude)) *
      cos(radians(s.longitude) - radians(in_lon)) +
      sin(radians(in_lat)) * sin(radians(s.latitude))
    ))))::numeric, 2) AS distance_km,
    (s.capacity_total - s.capacity_occupied) AS available_space
  FROM Shelters s
  WHERE (s.capacity_total - s.capacity_occupied) >= req_space
    AND s.status = 'active'
    AND in_lat BETWEEN -90 AND 90
    AND in_lon BETWEEN -180 AND 180
  ORDER BY distance_km ASC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Waiting requests gain one priority level per complete 24 hours, up to 5.
CREATE FUNCTION get_priority_queue()
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
  nearest_shelter_available_space INT
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
    nearby.available_space
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
  WHERE r.status = 'pending'
  ORDER BY
    LEAST(
      5,
      COALESCE(r.reviewed_priority, r.urgency_level, 1)
        + FLOOR(GREATEST(0, EXTRACT(EPOCH FROM (now() - r.created_at)) / 86400))
    ) DESC,
    r.created_at ASC,
    r.request_id ASC;
$$ LANGUAGE sql STABLE;
