const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/supplies/shortages — wraps Critical_Supply_Shortage view
router.get('/shortages', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM Critical_Supply_Shortage ORDER BY shelter_id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch shortages' });
  }
});

// POST /api/supplies/allocate — wraps allocate_supply(), the atomic transaction function
router.post('/allocate', requireAuth, async (req, res) => {
  const { request_id, supply_id, quantity } = req.body;
  if (!request_id || !supply_id || !quantity) {
    return res.status(400).json({ message: 'request_id, supply_id, and quantity are required' });
  }

  try {
    const result = await pool.query(
      'SELECT allocate_supply($1, $2, $3) AS success',
      [request_id, supply_id, quantity]
    );
    if (result.rows[0].success) {
      req.app.get('io').emit('supply-allocated', { request_id, supply_id, quantity });
      return res.json({ success: true });
    }
    res.status(409).json({ success: false, message: 'Insufficient stock for this allocation' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Allocation failed' });
  }
});

module.exports = router;
