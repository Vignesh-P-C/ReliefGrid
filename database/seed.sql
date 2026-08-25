-- ============================================================
-- ReliefGrid — seed data
-- Run this AFTER schema.sql. Gives you enough rows to test
-- find_nearest_shelters(), checkin_to_shelter(), the priority
-- queue, the shortage view, and the recursive CTE.
-- ============================================================

INSERT INTO Disaster_Events (name, type, region, severity, start_date) VALUES
  ('Cauvery Flood 2026', 'flood', 'Tamil Nadu', 4, '2026-08-01'),
  ('Nilgiris Landslide 2026', 'landslide', 'Tamil Nadu', 3, '2026-08-10');

INSERT INTO Users (name, phone, email, password_hash, role) VALUES
  ('Priya Raman', '9000000001', 'priya@reliefgrid.org', 'REPLACE_WITH_BCRYPT_HASH', 'Admin'),
  ('Arjun Nair', '9000000002', 'arjun@reliefgrid.org', 'REPLACE_WITH_BCRYPT_HASH', 'ShelterCoordinator'),
  ('Divya Suresh', '9000000003', 'divya@reliefgrid.org', 'REPLACE_WITH_BCRYPT_HASH', 'ShelterCoordinator'),
  ('Karthik Iyer', '9000000004', 'karthik@reliefgrid.org', 'REPLACE_WITH_BCRYPT_HASH', 'Volunteer');

INSERT INTO Shelters (event_id, name, address, latitude, longitude, capacity_total, capacity_occupied, contact_number, coordinator_id, status) VALUES
  (1, 'Government High School Shelter', 'Trichy Rd, Trichy', 10.7905, 78.7047, 3, 0, '9111111111', 2, 'active'),
  (1, 'Community Hall Shelter', 'Anna Nagar, Trichy', 10.8020, 78.6900, 50, 12, '9111111112', 3, 'active'),
  (2, 'Nilgiris Relief Camp', 'Ooty Rd, Coonoor', 11.3500, 76.8000, 30, 5, '9111111113', 3, 'active');

INSERT INTO Supply_Categories (name) VALUES
  ('Food'), ('Water'), ('Medical'), ('Bedding');

INSERT INTO Supplies (shelter_id, category_id, item_name, quantity, unit, reorder_threshold) VALUES
  (1, 1, 'Rice packets', 40, 'packets', 20),
  (1, 2, 'Water bottles', 8, 'bottles', 30),   -- deliberately below threshold, feeds the shortage view
  (2, 1, 'Rice packets', 200, 'packets', 50),
  (2, 3, 'First aid kits', 15, 'kits', 5),
  (3, 4, 'Blankets', 60, 'pieces', 20);

INSERT INTO Volunteers (user_id, skills, availability) VALUES
  (4, 'First aid, logistics', 'weekends');

-- Top-level task + two child tasks, to test the recursive CTE
INSERT INTO Volunteer_Tasks (shelter_id, volunteer_id, parent_task_id, description, status, priority) VALUES
  (1, 1, NULL, 'Set up medical tent', 'in_progress', 1);
INSERT INTO Volunteer_Tasks (shelter_id, volunteer_id, parent_task_id, description, status, priority) VALUES
  (1, 1, 1, 'Stock medical tent with first aid kits', 'pending', 2),
  (1, 1, 1, 'Assign a volunteer to staff the tent', 'pending', 2);

INSERT INTO Aid_Requests (event_id, requester_name, phone, latitude, longitude, request_type, num_people, urgency_level, status) VALUES
  (1, 'Ramesh Kumar', '9222222221', 10.7910, 78.7050, 'shelter', 2, 5, 'pending'),
  (1, 'Lakshmi Devi', '9222222222', 10.8000, 78.6890, 'shelter', 4, 3, 'pending'),
  (2, 'Suresh Babu', '9222222223', 11.3480, 76.7990, 'medical', 1, 4, 'pending');

-- ------------------------------------------------------------
-- Quick sanity checks — run these after seeding
-- ------------------------------------------------------------
-- SELECT * FROM find_nearest_shelters(10.7905, 78.7047, 2, 5);
-- SELECT checkin_to_shelter(1, 2);          -- should succeed (0 -> 2 of 3)
-- SELECT checkin_to_shelter(1, 2);          -- should FAIL (2+2 > 3)
-- SELECT * FROM get_priority_queue();
-- SELECT * FROM Shelter_Live_Status;
-- SELECT * FROM Critical_Supply_Shortage;   -- should show the low water bottles row
