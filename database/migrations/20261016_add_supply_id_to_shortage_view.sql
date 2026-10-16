-- Run once against an existing ReliefGrid database before deploying the
-- coordinator allocation action. The supply ID is required by POST /supplies/allocate.
CREATE OR REPLACE VIEW Critical_Supply_Shortage AS
SELECT s.shelter_id, sh.name AS shelter_name, s.item_name, s.quantity, s.reorder_threshold, s.supply_id
FROM Supplies s JOIN Shelters sh ON s.shelter_id = sh.shelter_id
WHERE s.quantity <= s.reorder_threshold;
