-- ============================================================
-- ReliefGrid — seed data
-- Run this AFTER schema.sql. Gives you enough rows to test
-- find_nearest_shelters(), checkin_to_shelter(), the priority
-- queue, the shortage view, and the recursive CTE.
--
-- Per Review 1 feedback: grounded in real, cited data wherever
-- possible. Every block below is tagged REAL / DERIVED / FABRICATED
-- inline. Full citations for every REAL and DERIVED number are in
-- database/DATA_SOURCES.md — cite that file directly in the report.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Disaster_Events — REAL
-- Source: EnviStats India 2020, Central Statistics Office (CSO),
-- MoSPI, Govt. of India — Table 1.9 "India's major natural
-- disasters since 1990". type/region/(death toll, where given)
-- are taken directly from that table.
-- `severity` (1-5) is OUR OWN bucketing of the death toll -- not
-- in the source, flagged FABRICATED (editorial judgment).
-- Where the source table gives only a year, we used the
-- well-documented public date for that disaster instead of
-- Jan 1 (noted per row below).
-- ------------------------------------------------------------
INSERT INTO Disaster_Events (name, type, region, severity, start_date) VALUES
  ('Andhra Pradesh & Tamil Nadu Cyclone 1990', 'Cyclone', 'Andhra Pradesh and Tamil Nadu', 3, '1990-01-01'),      -- 928 deaths (CSO); exact date not in source
  ('Uttarkashi Earthquake 1991', 'Earthquake', 'Uttar Kashi, Uttar Pradesh', 3, '1991-10-20'),                    -- 768 deaths (CSO); date is the well-known public date, not from CSO table
  ('Central India Floods 1993', 'Floods', '12 states incl. Assam, Bihar, Gujarat, Punjab, Rajasthan, UP (CSO lists all 12)', 4, '1993-01-01'), -- 1,643 deaths (CSO); exact date not in source; full 12-state list is in DATA_SOURCES.md, truncated here to fit VARCHAR(100)
  ('Andhra Pradesh Cyclone 1996', 'Cyclone', 'Andhra Pradesh', 3, '1996-11-06'),                                  -- 1,058 deaths (CSO); date is the well-known public landfall date
  ('Odisha Super Cyclone 1999', 'Cyclone', 'Odisha', 5, '1999-10-29'),                                            -- 9,887 deaths (CSO); date is the well-known public landfall date
  ('Gujarat Earthquake 2001', 'Earthquake', 'Gujarat', 5, '2001-01-26'),                                          -- 20,000+ deaths (CSO); Republic Day, widely documented date
  ('Indian Ocean Tsunami 2004', 'Tsunami', 'Andaman & Nicobar Islands, Andhra Pradesh, Tamil Nadu, Puducherry', 5, '2004-12-26'), -- 10,749+ deaths (CSO); globally known date
  ('Kosi Floods 2008', 'Floods', 'North Bihar', 4, '2008-08-18'),                                                 -- 527 deaths (CSO); well-documented breach date
  ('Uttarakhand Floods & Landslides 2013', 'Floods', 'Uttarakhand and Himachal Pradesh', 5, '2013-06-16'),        -- 4,094 deaths (CSO); well-documented date
  ('Cyclone Phailin 2013', 'Cyclone', 'Odisha and Andhra Pradesh', 2, '2013-10-12'),                              -- 23 deaths (CSO, low due to mass evacuation); well-documented landfall date
  ('Cyclone Hudhud 2014', 'Cyclone', 'Andhra Pradesh & Odisha', 3, '2014-10-12'),                                 -- death toll N.A. in CSO source; date is the well-known landfall date
  ('Kerala Floods 2018', 'Floods and Heavy Rains', 'Kerala', 5, '2018-08-08'),                                    -- 474 deaths per KSMDA Joint Needs Assessment (see DATA_SOURCES.md); date is when incessant rainfall began (NDRF report)
  ('Bihar, Maharashtra & Kerala Floods 2019', 'Floods and Heavy Rains', 'Bihar, Maharashtra and Kerala', 3, '2019-01-01'); -- death toll N.A. in CSO source; exact date not in source

-- Two extra, explicitly-fabricated events kept from the original seed
-- so we still have more than one event to test find_nearest_shelters()
-- across event boundaries with. Never claimed to be real.
INSERT INTO Disaster_Events (name, type, region, severity, start_date) VALUES
  ('Cauvery Flood 2026 (fabricated)', 'flood', 'Tamil Nadu', 4, '2026-08-01'),
  ('Nilgiris Landslide 2026 (fabricated)', 'landslide', 'Tamil Nadu', 3, '2026-08-10');

INSERT INTO Users (name, phone, email, password_hash, role) VALUES
  ('Priya Raman', '9000000001', 'priya@reliefgrid.org', 'REPLACE_WITH_BCRYPT_HASH', 'Admin'),
  ('Arjun Nair', '9000000002', 'arjun@reliefgrid.org', 'REPLACE_WITH_BCRYPT_HASH', 'ShelterCoordinator'),
  ('Divya Suresh', '9000000003', 'divya@reliefgrid.org', 'REPLACE_WITH_BCRYPT_HASH', 'ShelterCoordinator'),
  ('Karthik Iyer', '9000000004', 'karthik@reliefgrid.org', 'REPLACE_WITH_BCRYPT_HASH', 'Volunteer');

-- ------------------------------------------------------------
-- 2. Shelters — REAL headcounts, anchored on Kerala Floods 2018
-- Sources report how many people WERE sheltered, not a camp's
-- designed maximum. capacity_occupied = the real reported
-- headcount (REAL). capacity_total = that headcount + a small
-- (~5-8%) headroom buffer we added (DERIVED/FABRICATED) so every
-- real shelter still has nonzero available_space and shows up in
-- find_nearest_shelters()/checkin_to_shelter() demos — without
-- this buffer every real row here would read as 100% full and
-- silently disappear from those queries, which we caught by
-- actually running find_nearest_shelters() against this data.
-- Town-centre coordinates are approximate (FABRICATED at the
-- exact-address level — real camp GPS isn't public). Full
-- citations in DATA_SOURCES.md.
-- ------------------------------------------------------------
INSERT INTO Shelters (event_id, name, address, latitude, longitude, capacity_total, capacity_occupied, contact_number, coordinator_id, status) VALUES
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Kerala Floods 2018'),
   'Kalady Ashram School Relief Camp', 'Kalady, Ernakulam district, Kerala', 10.1667, 76.4333, 3000, 2800, '9111100001', 2, 'active'), -- REAL occupied: ~2,800 people, Chinmaya Mission field report; total = occupied + buffer
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Kerala Floods 2018'),
   'Ernakulam District Relief Camps (aggregate, 64 camps)', 'Ernakulam district, Kerala', 9.9816, 76.2999, 9500, 9000, '9111100002', 3, 'active'), -- REAL occupied: 9,000 people / 64 camps, ACT Alliance; total = occupied + buffer
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Kerala Floods 2018'),
   'Idukki District Relief Camps (aggregate)', 'Idukki district, Kerala', 9.8534, 76.9628, 3700, 3521, '9111100003', 3, 'active'), -- REAL occupied: 3,521 people, ACT Alliance; total = occupied + buffer
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Kerala Floods 2018'),
   'Wayanad District Relief Camps (aggregate, 87 camps)', 'Wayanad district, Kerala', 11.6085, 76.0851, 6400, 6111, '9111100004', 2, 'active'), -- REAL occupied: 6,111 people / 87 camps, TheNewsMinute; total = occupied + buffer
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Kerala Floods 2018'),
   'Alappuzha District Relief Camps (aggregate)', 'Alappuzha district, Kerala', 9.4981, 76.3388, 125000, 118000, '9111100005', 3, 'active'); -- REAL total: 1.25 lakh reported (Eastern Mirror/PTI), used as-is; occupied backed off from that same real total to create headroom

-- Fabricated shelters for the fabricated 2026 events, kept from the
-- original seed so cross-event queries still have >1 event to test.
INSERT INTO Shelters (event_id, name, address, latitude, longitude, capacity_total, capacity_occupied, contact_number, coordinator_id, status) VALUES
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Cauvery Flood 2026 (fabricated)'),
   'Government High School Shelter (fabricated)', 'Trichy Rd, Trichy', 10.7905, 78.7047, 3, 0, '9111111111', 2, 'active'),
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Cauvery Flood 2026 (fabricated)'),
   'Community Hall Shelter (fabricated)', 'Anna Nagar, Trichy', 10.8020, 78.6900, 50, 12, '9111111112', 3, 'active'),
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Nilgiris Landslide 2026 (fabricated)'),
   'Nilgiris Relief Camp (fabricated)', 'Ooty Rd, Coonoor', 11.3500, 76.8000, 30, 5, '9111111113', 3, 'active');

INSERT INTO Supply_Categories (name) VALUES
  ('Food'), ('Water'), ('Medical'), ('Bedding');

-- Supplies — FABRICATED throughout (no dataset records historical
-- stock levels; this exists to feed the shortage-detection view).
INSERT INTO Supplies (shelter_id, category_id, item_name, quantity, unit, reorder_threshold) VALUES
  ((SELECT shelter_id FROM Shelters WHERE name = 'Kalady Ashram School Relief Camp'), 1, 'Rice packets', 400, 'packets', 100),
  ((SELECT shelter_id FROM Shelters WHERE name = 'Kalady Ashram School Relief Camp'), 2, 'Water bottles', 80, 'bottles', 150), -- deliberately below threshold, feeds the shortage view
  ((SELECT shelter_id FROM Shelters WHERE name = 'Ernakulam District Relief Camps (aggregate, 64 camps)'), 1, 'Rice packets', 1200, 'packets', 300),
  ((SELECT shelter_id FROM Shelters WHERE name = 'Ernakulam District Relief Camps (aggregate, 64 camps)'), 3, 'First aid kits', 60, 'kits', 20),
  ((SELECT shelter_id FROM Shelters WHERE name = 'Wayanad District Relief Camps (aggregate, 87 camps)'), 4, 'Blankets', 500, 'pieces', 150);

INSERT INTO Volunteers (user_id, skills, availability) VALUES
  (4, 'First aid, logistics', 'weekends'); -- FABRICATED

-- Top-level task + two child tasks, to test the recursive CTE — FABRICATED
INSERT INTO Volunteer_Tasks (shelter_id, volunteer_id, parent_task_id, description, status, priority) VALUES
  ((SELECT shelter_id FROM Shelters WHERE name = 'Kalady Ashram School Relief Camp'), 1, NULL, 'Set up medical tent', 'in_progress', 1);
INSERT INTO Volunteer_Tasks (shelter_id, volunteer_id, parent_task_id, description, status, priority) VALUES
  ((SELECT shelter_id FROM Shelters WHERE name = 'Kalady Ashram School Relief Camp'), 1, (SELECT task_id FROM Volunteer_Tasks WHERE description = 'Set up medical tent'), 'Stock medical tent with first aid kits', 'pending', 2),
  ((SELECT shelter_id FROM Shelters WHERE name = 'Kalady Ashram School Relief Camp'), 1, (SELECT task_id FROM Volunteer_Tasks WHERE description = 'Set up medical tent'), 'Assign a volunteer to staff the tent', 'pending', 2);

-- ------------------------------------------------------------
-- 3. Aid_Requests — real places + real reported need-types,
-- FABRICATED individual identities (no public dataset gives
-- individual request records, nor should one). Coordinates are
-- approximate town centres for real, named localities that
-- contemporaneous reporting singled out during the 2018 floods.
-- Citations for the place/need-type pairing in DATA_SOURCES.md.
-- ------------------------------------------------------------
INSERT INTO Aid_Requests (event_id, requester_name, phone, latitude, longitude, request_type, num_people, urgency_level, status) VALUES
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Kerala Floods 2018'), 'Requester A (fabricated identity)', '9222200001', 10.1075, 76.3516, 'rescue', 4, 5, 'pending'),   -- Aluva, Ernakulam — real flooded locality (Deccan Herald)
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Kerala Floods 2018'), 'Requester B (fabricated identity)', '9222200002', 9.3167, 76.6167, 'rescue', 6, 5, 'pending'),    -- Chengannur, Alappuzha — real cut-off interior area needing boat rescue (Eastern Mirror)
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Kerala Floods 2018'), 'Requester C (fabricated identity)', '9222200003', 9.2333, 76.6833, 'food', 5, 3, 'pending'),      -- Pandalam, Alappuzha — real cut-off area, essentials airdropped (Eastern Mirror)
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Kerala Floods 2018'), 'Requester D (fabricated identity)', '9222200004', 11.2833, 76.2667, 'shelter', 5, 4, 'pending'),  -- Nilambur, Malappuram — real: 300+ families rehabilitated (TheNewsMinute)
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Kerala Floods 2018'), 'Requester E (fabricated identity)', '9222200005', 9.3833, 76.7500, 'water', 3, 3, 'pending');    -- Ranni, Pathanamthitta — real: among first areas hit (TheNewsMinute)

-- Fabricated requests for the fabricated 2026 events, kept from the
-- original seed data.
INSERT INTO Aid_Requests (event_id, requester_name, phone, latitude, longitude, request_type, num_people, urgency_level, status) VALUES
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Cauvery Flood 2026 (fabricated)'), 'Ramesh Kumar (fabricated)', '9222222221', 10.7910, 78.7050, 'shelter', 2, 5, 'pending'),
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Cauvery Flood 2026 (fabricated)'), 'Lakshmi Devi (fabricated)', '9222222222', 10.8000, 78.6890, 'shelter', 4, 3, 'pending'),
  ((SELECT event_id FROM Disaster_Events WHERE name = 'Nilgiris Landslide 2026 (fabricated)'), 'Suresh Babu (fabricated)', '9222222223', 11.3480, 76.7990, 'medical', 1, 4, 'pending');

-- ------------------------------------------------------------
-- Quick sanity checks — run these after seeding
-- ------------------------------------------------------------
-- SELECT * FROM find_nearest_shelters(10.1075, 76.3516, 2, 5); -- near Aluva, should surface Kalady/Ernakulam shelters first
-- SELECT checkin_to_shelter((SELECT shelter_id FROM Shelters WHERE name = 'Alappuzha District Relief Camps (aggregate)'), 2000);  -- should succeed (118000 -> 120000 of 125000)
-- SELECT * FROM get_priority_queue();
-- SELECT * FROM Shelter_Live_Status;
-- SELECT * FROM Critical_Supply_Shortage;   -- should show the low water bottles row at Kalady