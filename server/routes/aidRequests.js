const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/aid-requests/queue — wraps get_priority_queue()
router.get('/queue', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM get_priority_queue()');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch priority queue' });
  }
});

// POST /api/aid-requests — submitted from the public portal, no auth required
router.post('/', async (req, res) => {
  const { event_id, requester_name, phone, latitude, longitude, request_type, num_people, urgency_level } = req.body;

  if (!requester_name || !phone || !num_people || !urgency_level) {
    return res.status(400).json({ message: 'requester_name, phone, num_people, and urgency_level are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO Aid_Requests (event_id, requester_name, phone, latitude, longitude, request_type, num_people, urgency_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [event_id || null, requester_name, phone, latitude || null, longitude || null, request_type || null, num_people, urgency_level]
    );
    req.app.get('io').emit('new-aid-request', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to submit request' });
  }
});

module.exports = router;
