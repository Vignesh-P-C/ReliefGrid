const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { describeDatabaseError } = require('../lib/databaseErrors');

const router = express.Router();

const toPositiveInteger = (value) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

// Allocation outcomes that mean "the request was understood but refused".
const ALLOCATION_CONFLICT_CODES = new Set([
  'request_not_eligible',
  'need_already_met',
  'no_matching_need',
  'no_item_needs',
  'need_mismatch',
  'exceeds_remaining_need',
  'insufficient_stock',
]);

const ALLOCATION_NOT_FOUND_CODES = new Set([
  'request_not_found',
  'supply_not_found',
  'need_not_found',
]);

// GET /api/supplies/categories — reference data, no auth (the public portal
// needs it to describe what a person is asking for).
router.get('/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT category_id, name FROM Supply_Categories ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    const migration = describeDatabaseError(err);
    if (migration) return res.status(migration.status).json({ message: migration.message });
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch supply categories' });
  }
});

// GET /api/supplies/inventory — every stock item, not only the ones in crisis.
// Filters: shelter_id, category_id, q (item or shelter name), limit.
router.get('/inventory', requireAuth, async (req, res) => {
  const shelterId = req.query.shelter_id === undefined ? null : toPositiveInteger(req.query.shelter_id);
  const categoryId = req.query.category_id === undefined ? null : toPositiveInteger(req.query.category_id);
  const search = typeof req.query.q === 'string' && req.query.q.trim() !== '' ? req.query.q.trim().slice(0, 100) : null;
  const limit = Math.min(toPositiveInteger(req.query.limit) ?? 200, 500);

  if (req.query.shelter_id !== undefined && shelterId === null) {
    return res.status(400).json({ message: 'shelter_id must be a positive whole number' });
  }
  if (req.query.category_id !== undefined && categoryId === null) {
    return res.status(400).json({ message: 'category_id must be a positive whole number' });
  }

  try {
    const result = await pool.query(
      `SELECT s.supply_id, s.shelter_id, sh.name AS shelter_name, s.item_name,
              s.quantity, s.unit, s.reorder_threshold, s.category_id, c.name AS category_name,
              (s.quantity <= s.reorder_threshold) AS below_threshold
       FROM Supplies s
       JOIN Shelters sh ON sh.shelter_id = s.shelter_id
       LEFT JOIN Supply_Categories c ON c.category_id = s.category_id
       WHERE ($1::int IS NULL OR s.shelter_id = $1)
         AND ($2::int IS NULL OR s.category_id = $2)
         AND ($3::text IS NULL OR s.item_name ILIKE '%' || $3 || '%' OR sh.name ILIKE '%' || $3 || '%')
       ORDER BY s.shelter_id, s.item_name
       LIMIT $4`,
      [shelterId, categoryId, search, limit]
    );
    res.json(result.rows);
  } catch (err) {
    const migration = describeDatabaseError(err);
    if (migration) return res.status(migration.status).json({ message: migration.message });
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch inventory' });
  }
});

// GET /api/supplies/shortages — wraps Critical_Supply_Shortage view
router.get('/shortages', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM Critical_Supply_Shortage ORDER BY shelter_id');
    res.json(result.rows);
  } catch (err) {
    const migration = describeDatabaseError(err);
    if (migration) return res.status(migration.status).json({ message: migration.message });
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch shortages' });
  }
});

// GET /api/supplies/allocations — allocation history with its request, shelter
// and actor. Requester contact details stay restricted to staff roles.
router.get('/allocations', requireAuth, async (req, res) => {
  const requestId = req.query.request_id === undefined ? null : toPositiveInteger(req.query.request_id);
  const shelterId = req.query.shelter_id === undefined ? null : toPositiveInteger(req.query.shelter_id);
  const limit = Math.min(toPositiveInteger(req.query.limit) ?? 50, 200);
  const canViewRequester = ['Admin', 'ShelterCoordinator'].includes(req.user.role);

  if (req.query.request_id !== undefined && requestId === null) {
    return res.status(400).json({ message: 'request_id must be a positive whole number' });
  }
  if (req.query.shelter_id !== undefined && shelterId === null) {
    return res.status(400).json({ message: 'shelter_id must be a positive whole number' });
  }

  try {
    const result = await pool.query(
      `SELECT a.allocation_id, a.request_id, a.supply_id, a.quantity_allocated,
              a.allocated_at, a.need_id,
              s.item_name, s.unit, s.shelter_id, sh.name AS shelter_name,
              s.category_id, c.name AS category_name,
              n.quantity_needed, n.is_estimate,
              r.requester_name, r.phone, r.request_type, r.status AS request_status,
              u.name AS allocated_by_name
       FROM Allocations a
       JOIN Supplies s ON s.supply_id = a.supply_id
       JOIN Shelters sh ON sh.shelter_id = s.shelter_id
       LEFT JOIN Supply_Categories c ON c.category_id = s.category_id
       LEFT JOIN Request_Needs n ON n.need_id = a.need_id
       LEFT JOIN Aid_Requests r ON r.request_id = a.request_id
       LEFT JOIN Users u ON u.user_id = a.allocated_by
       WHERE ($1::int IS NULL OR a.request_id = $1)
         AND ($2::int IS NULL OR s.shelter_id = $2)
       ORDER BY a.allocated_at DESC, a.allocation_id DESC
       LIMIT $3`,
      [requestId, shelterId, limit]
    );

    res.json(result.rows.map((allocation) => ({
      ...allocation,
      quantity_allocated: Number(allocation.quantity_allocated),
      requester_name: canViewRequester ? allocation.requester_name : null,
      phone: canViewRequester ? allocation.phone : null,
    })));
  } catch (err) {
    const migration = describeDatabaseError(err);
    if (migration) return res.status(migration.status).json({ message: migration.message });
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch allocation history' });
  }
});

// POST /api/supplies/allocate — wraps allocate_supply(), the atomic
// transaction function. The function owns eligibility, need matching and
// stock checks, so concurrent allocations cannot overspend either.
router.post('/allocate', requireAuth, requireRole('Admin', 'ShelterCoordinator'), async (req, res) => {
  const { request_id, supply_id, quantity, need_id } = req.body;
  const requestId = toPositiveInteger(request_id);
  const supplyId = toPositiveInteger(supply_id);
  const allocatedQuantity = toPositiveInteger(quantity);
  const needId = need_id === undefined || need_id === null ? null : toPositiveInteger(need_id);

  if (requestId === null || supplyId === null || allocatedQuantity === null) {
    return res.status(400).json({ message: 'request_id, supply_id, and quantity must be positive whole numbers' });
  }
  if (need_id !== undefined && need_id !== null && needId === null) {
    return res.status(400).json({ message: 'need_id must be a positive whole number when provided' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM allocate_supply($1, $2, $3, $4, $5)',
      [requestId, supplyId, allocatedQuantity, needId, req.user.user_id]
    );
    const outcome = result.rows[0];

    if (outcome.success) {
      req.app.get('io').emit('supply-allocated', {
        request_id: requestId,
        supply_id: supplyId,
        quantity: allocatedQuantity,
        need_id: outcome.need_id,
        request_status: outcome.request_status,
      });
      return res.json(outcome);
    }

    const status = ALLOCATION_NOT_FOUND_CODES.has(outcome.code) ? 404
      : ALLOCATION_CONFLICT_CODES.has(outcome.code) ? 409
        : 400;
    return res.status(status).json(outcome);
  } catch (err) {
    const migration = describeDatabaseError(err);
    if (migration) return res.status(migration.status).json({ message: migration.message });
    console.error(err);
    return res.status(500).json({ message: 'Allocation failed' });
  }
});

module.exports = router;
