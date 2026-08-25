const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

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
router.get('/ranked', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT shelter_id, name, event_id,
        ROUND(100.0 * capacity_occupied / NULLIF(capacity_total,0), 1) AS occupancy_pct,
        RANK() OVER (
          PARTITION BY event_id
          ORDER BY capacity_occupied::float / NULLIF(capacity_total,0) DESC
        ) AS occupancy_rank
      FROM Shelters
      ORDER BY event_id, occupancy_rank
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch ranked shelters' });
  }
});

// POST /api/shelters/:id/checkin — wraps checkin_to_shelter(), the concurrency-safe function
router.post('/:id/checkin', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { num_people } = req.body;

  if (!num_people || num_people <= 0) {
    return res.status(400).json({ message: 'num_people must be a positive number' });
  }

  try {
    const result = await pool.query('SELECT checkin_to_shelter($1, $2) AS success', [id, num_people]);
    if (result.rows[0].success) {
      req.app.get('io').emit('shelter-updated', { shelterId: Number(id) });
      return res.json({ success: true });
    }
    res.status(409).json({ success: false, message: 'Not enough space in this shelter' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Check-in failed' });
  }
});

// GET /api/shelters/:id/tasks — recursive CTE task-dependency tree for a shelter
router.get('/:id/tasks', async (req, res) => {
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
