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
  const isPositiveInteger = (value) => (
    (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    && Number.isInteger(Number(value))
    && Number(value) > 0
  );
  const allocation = { request_id: Number(request_id), supply_id: Number(supply_id), quantity: Number(quantity) };
  if (!isPositiveInteger(request_id) || !isPositiveInteger(supply_id) || !isPositiveInteger(quantity)) {
    return res.status(400).json({ message: 'request_id, supply_id, and quantity must be positive whole numbers' });
  }

  try {
    const result = await pool.query(
      'SELECT allocate_supply($1, $2, $3) AS success',
      [allocation.request_id, allocation.supply_id, allocation.quantity]
    );
    if (result.rows[0].success) {
      req.app.get('io').emit('supply-allocated', allocation);
      return res.json({ success: true });
    }
    res.status(409).json({ success: false, message: 'Insufficient stock for this allocation' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Allocation failed' });
  }
});

module.exports = router;
