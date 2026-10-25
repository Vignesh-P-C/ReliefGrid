const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /api/events — public list of still-active disaster events, used by the
// portal to let a requester associate their submission with the right
// disaster instead of leaving it unassigned (Audit #42).
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT event_id, name, region, severity
       FROM Disaster_Events
       WHERE end_date IS NULL OR end_date >= CURRENT_DATE
       ORDER BY start_date DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch events' });
  }
});

module.exports = router;
