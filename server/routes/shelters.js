const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/shelters — live status board (wraps Shelter_Live_Status view)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM Shelter_Live_Status ORDER BY shelter_id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch shelters' });
  }
});

// GET /api/shelters/nearest?lat=..&lon=..&people=.. — wraps find_nearest_shelters()
router.get('/nearest', async (req, res) => {
  const { lat, lon, people } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ message: 'lat and lon query params are required' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM find_nearest_shelters($1, $2, $3, 5)',
      [lat, lon, people || 1]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to find nearest shelters' });
  }
});

// GET /api/shelters/ranked — occupancy ranking within each event, window function
// Inactive/closed shelters are excluded so rankings only reflect operating capacity (Audit #22).
router.get('/ranked', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.shelter_id, s.name, s.event_id, e.name AS event_name,
        ROUND(100.0 * s.capacity_occupied / NULLIF(s.capacity_total,0), 1) AS occupancy_pct,
        RANK() OVER (
          PARTITION BY s.event_id
          ORDER BY s.capacity_occupied::float / NULLIF(s.capacity_total,0) DESC
        ) AS occupancy_rank
      FROM Shelters s
      LEFT JOIN Disaster_Events e ON e.event_id = s.event_id
      WHERE s.status = 'active'
      ORDER BY s.event_id, occupancy_rank
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch ranked shelters' });
  }
});

const isPositiveInteger = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  && Number.isInteger(Number(value))
  && Number(value) > 0;

// checkin_to_shelter()/checkout_from_shelter() return a status code instead of a
// boolean so missing shelters, closed shelters, and capacity limits each get a
// distinguishable response (Audit #20, #21).
const CAPACITY_RESULT_RESPONSES = {
  not_found: { status: 404, message: 'No shelter exists with this ID' },
  inactive: { status: 409, message: 'This shelter is closed/inactive and cannot accept check-ins' },
  full: { status: 409, message: 'Not enough space in this shelter' },
  exceeds_occupancy: { status: 409, message: 'Cannot check out more people than are currently checked in' },
  invalid_quantity: { status: 400, message: 'num_people must be a positive whole number' },
};

// POST /api/shelters/:id/checkin — wraps checkin_to_shelter(), the concurrency-safe function
router.post('/:id/checkin', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { num_people } = req.body;

  if (!isPositiveInteger(id)) {
    return res.status(400).json({ message: 'shelter id must be a positive whole number' });
  }
  if (!isPositiveInteger(num_people)) {
    return res.status(400).json({ message: 'num_people must be a positive whole number' });
  }

  try {
    const result = await pool.query('SELECT checkin_to_shelter($1, $2) AS outcome', [id, num_people]);
    const outcome = result.rows[0].outcome;
    if (outcome === 'ok') {
      req.app.get('io').emit('shelter-updated', { shelterId: Number(id) });
      return res.json({ success: true });
    }
    const response = CAPACITY_RESULT_RESPONSES[outcome] || { status: 500, message: 'Check-in failed' };
    res.status(response.status).json({ success: false, message: response.message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Check-in failed' });
  }
});

// POST /api/shelters/:id/checkout — wraps checkout_from_shelter(), the check-in counterpart (Audit #19)
router.post('/:id/checkout', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { num_people } = req.body;

  if (!isPositiveInteger(id)) {
    return res.status(400).json({ message: 'shelter id must be a positive whole number' });
  }
  if (!isPositiveInteger(num_people)) {
    return res.status(400).json({ message: 'num_people must be a positive whole number' });
  }

  try {
    const result = await pool.query('SELECT checkout_from_shelter($1, $2) AS outcome', [id, num_people]);
    const outcome = result.rows[0].outcome;
    if (outcome === 'ok') {
      req.app.get('io').emit('shelter-updated', { shelterId: Number(id) });
      return res.json({ success: true });
    }
    const response = CAPACITY_RESULT_RESPONSES[outcome] || { status: 500, message: 'Check-out failed' };
    res.status(response.status).json({ success: false, message: response.message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Check-out failed' });
  }
});

const SHELTER_UPDATABLE_FIELDS = ['name', 'address', 'latitude', 'longitude', 'capacity_total', 'contact_number', 'coordinator_id', 'event_id', 'status'];
const isValidCoordinate = (value, min, max) => typeof value !== 'undefined' && value !== null && value !== ''
  && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
const isNonNegativeInteger = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  && Number.isInteger(Number(value)) && Number(value) >= 0;
const isValidStatus = (value) => value === undefined || value === null || value === 'active' || value === 'inactive';
// Matches Shelters.name/contact_number column limits in schema.sql, so an
// overlong value is a 400 here instead of a 22001 string-data-right-truncation 500.
const NAME_MAX_LENGTH = 150;
const CONTACT_NUMBER_MAX_LENGTH = 15;

// POST /api/shelters — open a new shelter (Audit #25)
router.post('/', requireAuth, requireRole('Admin', 'ShelterCoordinator'), async (req, res) => {
  const { name, latitude, longitude, capacity_total, address, contact_number, coordinator_id, event_id, status } = req.body;

  if (typeof name !== 'string' || name.trim() === '' || name.trim().length > NAME_MAX_LENGTH) {
    return res.status(400).json({ message: `name is required and must be ${NAME_MAX_LENGTH} characters or fewer` });
  }
  if (!isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180)) {
    return res.status(400).json({ message: 'latitude and longitude must be valid coordinates' });
  }
  if (!isNonNegativeInteger(capacity_total)) {
    return res.status(400).json({ message: 'capacity_total must be a non-negative whole number' });
  }
  if (!isValidStatus(status)) {
    return res.status(400).json({ message: "status must be 'active' or 'inactive'" });
  }
  if (typeof contact_number === 'string' && contact_number.trim().length > CONTACT_NUMBER_MAX_LENGTH) {
    return res.status(400).json({ message: `contact_number must be ${CONTACT_NUMBER_MAX_LENGTH} characters or fewer` });
  }

  try {
    const result = await pool.query(
      `INSERT INTO Shelters(name, latitude, longitude, capacity_total, address, contact_number, coordinator_id, event_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'active'))
       RETURNING *`,
      [name.trim(), latitude, longitude, Number(capacity_total), address || null, contact_number ? contact_number.trim() : null, coordinator_id || null, event_id || null, status || null]
    );
    req.app.get('io').emit('shelter-updated', { shelterId: result.rows[0].shelter_id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ message: 'event_id or coordinator_id does not reference an existing record' });
    }
    console.error(err);
    res.status(500).json({ message: 'Failed to create shelter' });
  }
});

// PATCH /api/shelters/:id — edit, close/reopen, or resize an existing shelter (Audit #25)
router.patch('/:id', requireAuth, requireRole('Admin', 'ShelterCoordinator'), async (req, res) => {
  const { id } = req.params;
  const updates = {};

  for (const field of SHELTER_UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      updates[field] = req.body[field];
    }
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ message: 'No updatable fields were provided' });
  }
  if ('status' in updates && !isValidStatus(updates.status)) {
    return res.status(400).json({ message: "status must be 'active' or 'inactive'" });
  }
  if ('capacity_total' in updates && !isNonNegativeInteger(updates.capacity_total)) {
    return res.status(400).json({ message: 'capacity_total must be a non-negative whole number' });
  }
  if ('latitude' in updates && !isValidCoordinate(updates.latitude, -90, 90)) {
    return res.status(400).json({ message: 'latitude must be a valid coordinate' });
  }
  if ('longitude' in updates && !isValidCoordinate(updates.longitude, -180, 180)) {
    return res.status(400).json({ message: 'longitude must be a valid coordinate' });
  }
  if ('name' in updates) {
    if (typeof updates.name !== 'string' || updates.name.trim() === '' || updates.name.trim().length > NAME_MAX_LENGTH) {
      return res.status(400).json({ message: `name must be a non-empty string of ${NAME_MAX_LENGTH} characters or fewer` });
    }
    updates.name = updates.name.trim();
  }
  if ('contact_number' in updates && updates.contact_number !== null) {
    if (typeof updates.contact_number !== 'string' || updates.contact_number.trim().length > CONTACT_NUMBER_MAX_LENGTH) {
      return res.status(400).json({ message: `contact_number must be ${CONTACT_NUMBER_MAX_LENGTH} characters or fewer` });
    }
    updates.contact_number = updates.contact_number.trim();
  }
  if (!isPositiveInteger(id)) {
    return res.status(400).json({ message: 'shelter id must be a positive whole number' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the row so a concurrent check-in/check-out can't race this capacity_total change.
    const current = await client.query('SELECT capacity_occupied FROM Shelters WHERE shelter_id = $1 FOR UPDATE', [id]);
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No shelter exists with this ID' });
    }
    if ('capacity_total' in updates && Number(updates.capacity_total) < current.rows[0].capacity_occupied) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'capacity_total cannot be reduced below the current occupancy' });
    }

    const columns = Object.keys(updates);
    const setClause = columns.map((col, i) => `${col} = $${i + 2}`).join(', ');
    const values = columns.map((col) => updates[col]);
    const result = await client.query(
      `UPDATE Shelters SET ${setClause} WHERE shelter_id = $1 RETURNING *`,
      [id, ...values]
    );
    await client.query('COMMIT');
    req.app.get('io').emit('shelter-updated', { shelterId: Number(id) });
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') {
      return res.status(400).json({ message: 'event_id or coordinator_id does not reference an existing record' });
    }
    console.error(err);
    res.status(500).json({ message: 'Failed to update shelter' });
  } finally {
    client.release();
  }
});

// GET /api/shelters/:id — full shelter record, used to prefill the edit form (Audit #25)
router.get('/:id', requireAuth, requireRole('Admin', 'ShelterCoordinator'), async (req, res) => {
  const { id } = req.params;
  if (!isPositiveInteger(id)) {
    return res.status(400).json({ message: 'shelter id must be a positive whole number' });
  }
  try {
    const result = await pool.query('SELECT * FROM Shelters WHERE shelter_id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No shelter exists with this ID' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch shelter' });
  }
});

// GET /api/shelters/:id/tasks — recursive CTE task-dependency tree for a shelter
router.get('/:id/tasks', requireAuth, requireRole('Admin', 'ShelterCoordinator'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `WITH RECURSIVE task_tree AS (
         SELECT task_id, parent_task_id, description, status, 1 AS depth
         FROM Volunteer_Tasks
         WHERE parent_task_id IS NULL AND shelter_id = $1
         UNION ALL
         SELECT t.task_id, t.parent_task_id, t.description, t.status, tt.depth + 1
         FROM Volunteer_Tasks t
         JOIN task_tree tt ON t.parent_task_id = tt.task_id
         WHERE t.shelter_id = $1
       )
       SELECT * FROM task_tree ORDER BY depth, task_id`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch task tree' });
  }
});

module.exports = router;
