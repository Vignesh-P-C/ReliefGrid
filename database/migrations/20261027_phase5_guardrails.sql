-- Phase 5 — Guardrails (Audit #46–#52)
--
-- Three database changes, all backwards-compatible:
--   1. Shelter_Capacity_Log records who changed occupancy and what they did,
--      so "who admitted these people?" has an answer (Audit #51).
--   2. Volunteer_Tasks.status is constrained to the states the app understands
--      (Audit #52). Aid_Requests.status and Shelters.status were constrained by
--      migrations 3 and 4.
--   3. Shelter_Live_Status exposes the shelter's assigned coordinator, so the
--      dashboard can scope its controls to shelters a coordinator owns instead
--      of offering a button that the API now refuses (Audit #48).
--
-- checkin_to_shelter()/checkout_from_shelter() take the acting user as an
-- optional third argument, so the existing two-argument calls — the test
-- scripts, the runbook's verification queries, anyone in psql — keep working
-- unchanged and simply record an unknown actor.

-- ------------------------------------------------------------
-- 1. Accountability on capacity changes (Audit #51)
-- ------------------------------------------------------------

ALTER TABLE Shelter_Capacity_Log
  ADD COLUMN IF NOT EXISTS changed_by INT REFERENCES Users(user_id),
  ADD COLUMN IF NOT EXISTS change_type VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shelter_capacity_log_change_type_allowed'
      AND conrelid = 'shelter_capacity_log'::regclass
  ) THEN
    ALTER TABLE Shelter_Capacity_Log
      ADD CONSTRAINT shelter_capacity_log_change_type_allowed
      CHECK (change_type IS NULL OR change_type IN ('checkin', 'checkout', 'correction'));
  END IF;
END;
$$;

-- The trigger fires AFTER the UPDATE and cannot see the caller's arguments, so
-- the actor travels with the transaction as a transaction-local setting that
-- the functions below set. Unset (direct SQL, a psql UPDATE) reads as NULL
-- rather than failing the write.
CREATE OR REPLACE FUNCTION log_capacity_change() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO Shelter_Capacity_Log(shelter_id, capacity_occupied, changed_by, change_type)
  VALUES (
    NEW.shelter_id,
    NEW.capacity_occupied,
    NULLIF(current_setting('reliefgrid.changed_by', true), '')::int,
    NULLIF(current_setting('reliefgrid.change_type', true), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS checkin_to_shelter(INT, INT, INT);
-- The two-argument form is replaced by the defaulted third argument below.
DROP FUNCTION IF EXISTS checkin_to_shelter(INT, INT);

CREATE FUNCTION checkin_to_shelter(p_shelter_id INT, p_num_people INT, p_changed_by INT DEFAULT NULL) RETURNS VARCHAR AS $$
DECLARE
  occ INT; tot INT; shelter_status VARCHAR;
BEGIN
  IF p_num_people IS NULL OR p_num_people <= 0 THEN
    RETURN 'invalid_quantity';
  END IF;

  -- Transaction-local context for trg_log_capacity (Audit #51). Set before the
  -- UPDATE so the trigger can attribute the row it writes.
  PERFORM set_config('reliefgrid.changed_by', COALESCE(p_changed_by::text, ''), true);
  PERFORM set_config('reliefgrid.change_type', 'checkin', true);

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

DROP FUNCTION IF EXISTS checkout_from_shelter(INT, INT, INT);
DROP FUNCTION IF EXISTS checkout_from_shelter(INT, INT);

CREATE FUNCTION checkout_from_shelter(p_shelter_id INT, p_num_people INT, p_changed_by INT DEFAULT NULL) RETURNS VARCHAR AS $$
DECLARE
  occ INT;
BEGIN
  IF p_num_people IS NULL OR p_num_people <= 0 THEN
    RETURN 'invalid_quantity';
  END IF;

  PERFORM set_config('reliefgrid.changed_by', COALESCE(p_changed_by::text, ''), true);
  PERFORM set_config('reliefgrid.change_type', 'checkout', true);

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

-- ------------------------------------------------------------
-- 2. Volunteer_Tasks.status (Audit #52)
-- ------------------------------------------------------------

DO $$
DECLARE
  normalised_count INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'volunteer_tasks_status_allowed'
      AND conrelid = 'volunteer_tasks'::regclass
  ) THEN
    -- Normalise before adding the CHECK so a stray value cannot fail the deploy.
    -- Unknown states become 'pending' — the conservative "not done" reading,
    -- rather than claiming a task is finished.
    WITH normalised AS (
      UPDATE Volunteer_Tasks SET status = 'pending'
      WHERE status IS NULL
         OR status NOT IN ('pending', 'in_progress', 'done', 'blocked', 'cancelled')
      RETURNING task_id
    )
    SELECT count(*) INTO normalised_count FROM normalised;

    IF normalised_count > 0 THEN
      RAISE NOTICE 'Normalised % Volunteer_Tasks.status row(s) to pending — set the real state afterwards.', normalised_count;
    END IF;

    ALTER TABLE Volunteer_Tasks
      ADD CONSTRAINT volunteer_tasks_status_allowed
      CHECK (status IN ('pending', 'in_progress', 'done', 'blocked', 'cancelled'));
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 3. The shelter's coordinator on the live-status view (Audit #48)
-- ------------------------------------------------------------

-- Appended after the existing columns: CREATE OR REPLACE VIEW can add columns
-- at the end, never reorder or remove them.
CREATE OR REPLACE VIEW Shelter_Live_Status AS
SELECT s.shelter_id, s.name, s.capacity_total, s.capacity_occupied,
  ROUND(100.0 * s.capacity_occupied / NULLIF(s.capacity_total,0), 1) AS occupancy_pct,
  CASE WHEN s.capacity_occupied >= s.capacity_total THEN 'full'
       WHEN s.capacity_occupied >= 0.9 * s.capacity_total THEN 'near-full'
       ELSE 'available' END AS status,
  s.event_id, e.name AS event_name,
  (s.status = 'active') AS is_active,
  s.coordinator_id
FROM Shelters s
LEFT JOIN Disaster_Events e ON e.event_id = s.event_id;
