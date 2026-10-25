const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { describeDatabaseError } = require('../lib/databaseErrors');

const router = express.Router();

const MAX_NEEDS_PER_REQUEST = 10;
const MAX_NEED_QUANTITY = 100000;

const toPositiveInteger = (value) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

// Returns { needs } or { error }.
function normaliseNeeds(rawNeeds) {
  if (rawNeeds === undefined || rawNeeds === null) return { needs: [] };
  if (!Array.isArray(rawNeeds)) return { error: 'needs must be a list' };
  if (rawNeeds.length > MAX_NEEDS_PER_REQUEST) {
    return { error: `At most ${MAX_NEEDS_PER_REQUEST} needs can be submitted with one request` };
  }

  const needs = [];
  for (const raw of rawNeeds) {
    if (!raw || typeof raw !== 'object') return { error: 'Each need must be an object' };

    const quantityNeeded = toPositiveInteger(raw.quantity_needed);
    if (quantityNeeded === null || quantityNeeded > MAX_NEED_QUANTITY) {
      return { error: `Each need requires a quantity_needed from 1 to ${MAX_NEED_QUANTITY}` };
    }

    const categoryId = raw.category_id === undefined || raw.category_id === null
      ? null
      : toPositiveInteger(raw.category_id);
    if (raw.category_id !== undefined && raw.category_id !== null && categoryId === null) {
      return { error: 'need category_id must be a positive whole number when provided' };
    }

    const itemLabel = typeof raw.item_label === 'string' && raw.item_label.trim() !== ''
      ? raw.item_label.trim().slice(0, 100)
      : null;

    // A need has to name either a supply category or a free-text item.
    if (categoryId === null && itemLabel === null) {
      return { error: 'Each need requires a category_id or an item_label' };
    }

    needs.push({ categoryId, itemLabel, quantityNeeded });
  }

  return { needs };
}

// GET /api/aid-requests/queue — wraps get_priority_queue()
router.get('/queue', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM get_priority_queue()');
    const canViewSensitiveRequestData = ['Admin', 'ShelterCoordinator'].includes(req.user.role);
    res.json(result.rows.map((request) => {
      const latitude = request.latitude === null ? null : Number(request.latitude);
      const longitude = request.longitude === null ? null : Number(request.longitude);
      const hasCoordinates = latitude !== null || longitude !== null;
      const validCoordinates = latitude !== null && longitude !== null
        && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
        && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;

      return {
        ...request,
        phone: canViewSensitiveRequestData ? request.phone : null,
        latitude: canViewSensitiveRequestData && validCoordinates ? latitude : null,
        longitude: canViewSensitiveRequestData && validCoordinates ? longitude : null,
        location_status: !canViewSensitiveRequestData
          ? 'restricted'
          : validCoordinates ? 'available' : hasCoordinates ? 'invalid' : 'missing',
        nearest_shelter_name: canViewSensitiveRequestData && validCoordinates ? request.nearest_shelter_name : null,
        nearest_shelter_distance_km: canViewSensitiveRequestData && validCoordinates && request.nearest_shelter_distance_km !== null
          ? Number(request.nearest_shelter_distance_km)
          : null,
        nearest_shelter_available_space: canViewSensitiveRequestData && validCoordinates
          ? request.nearest_shelter_available_space
          : null,
      };
    }));
  } catch (err) {
    const migration = describeDatabaseError(err);
    if (migration) return res.status(migration.status).json({ message: migration.message });
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch priority queue' });
  }
});

// PATCH /api/aid-requests/:requestId/priority — staff-only triage review
router.patch('/:requestId/priority', requireAuth, requireRole('Admin', 'ShelterCoordinator'), async (req, res) => {
  const requestId = Number(req.params.requestId);
  const { reviewed_priority } = req.body;

  if (!Number.isSafeInteger(requestId) || requestId < 1) {
    return res.status(400).json({ message: 'requestId must be a positive whole number' });
  }
  if (!Number.isInteger(reviewed_priority) || reviewed_priority < 1 || reviewed_priority > 5) {
    return res.status(400).json({ message: 'reviewed_priority must be a whole number from 1 to 5' });
  }

  try {
    const result = await pool.query(
      `UPDATE Aid_Requests
       SET reviewed_priority = $1, reviewed_by = $2, reviewed_at = now()
       WHERE request_id = $3 AND status = 'pending'
       RETURNING request_id, reviewed_priority, reviewed_by, reviewed_at`,
      [reviewed_priority, req.user.user_id, requestId]
    );

    if (result.rowCount === 0) {
      const existing = await pool.query('SELECT status FROM Aid_Requests WHERE request_id = $1', [requestId]);
      if (existing.rowCount === 0) {
        return res.status(404).json({ message: 'Request not found' });
      }
      return res.status(409).json({ message: 'Only pending requests can be reviewed' });
    }

    req.app.get('io').emit('aid-request-reviewed', { request_id: requestId });
    return res.json(result.rows[0]);
  } catch (err) {
    const migration = describeDatabaseError(err);
    if (migration) return res.status(migration.status).json({ message: migration.message });
    console.error(err);
    return res.status(500).json({ message: 'Failed to save priority review' });
  }
});

// POST /api/aid-requests — submitted from the public portal, no auth required
router.post('/', async (req, res) => {
  const { event_id, requester_name, phone, latitude, longitude, request_type, num_people, urgency_level } = req.body;

  if (!requester_name || !phone || !num_people || !urgency_level) {
    return res.status(400).json({ message: 'requester_name, phone, num_people, and urgency_level are required' });
  }

  const { needs, error: needsError } = normaliseNeeds(req.body.needs);
  if (needsError) {
    return res.status(400).json({ message: needsError });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO Aid_Requests (event_id, requester_name, phone, latitude, longitude, request_type, num_people, urgency_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [event_id || null, requester_name, phone, latitude || null, longitude || null, request_type || null, num_people, urgency_level]
    );
    const request = result.rows[0];

    let savedNeeds = [];
    if (needs.length > 0) {
      // A named category is a real request; a free-text item is an estimate,
      // because it does not pin the request to a stock category.
      const inserted = await client.query(
        `INSERT INTO Request_Needs (request_id, category_id, item_label, quantity_needed, is_estimate)
         SELECT $1, n.category_id, n.item_label, n.quantity_needed, n.category_id IS NULL
         FROM unnest($2::int[], $3::text[], $4::int[]) AS n(category_id, item_label, quantity_needed)
         RETURNING need_id, category_id, item_label, quantity_needed, is_estimate`,
        [request.request_id, needs.map((need) => need.categoryId), needs.map((need) => need.itemLabel), needs.map((need) => need.quantityNeeded)]
      );
      savedNeeds = inserted.rows;
    } else if ((request_type || '').trim().toLowerCase() !== 'shelter') {
      // No items named: record an explicit estimate so the request can still
      // be served. Shelter-only requests get no item need — a bed is served by
      // check-in, not by allocating stock.
      const inserted = await client.query(
        `INSERT INTO Request_Needs (request_id, item_label, quantity_needed, is_estimate)
         VALUES ($1, $2, $3, TRUE)
         RETURNING need_id, category_id, item_label, quantity_needed, is_estimate`,
        [request.request_id, `Unspecified relief items for ${num_people} people`, Number(num_people)]
      );
      savedNeeds = inserted.rows;
    }

    await client.query('COMMIT');

    // Requester contact details must never be broadcast to anonymous socket clients.
    req.app.get('io').emit('new-aid-request', { request_id: request.request_id });
    res.status(201).json({ ...request, needs: savedNeeds });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23503') {
      return res.status(400).json({ message: 'One of the selected supply categories does not exist' });
    }
    const migration = describeDatabaseError(err);
    if (migration) return res.status(migration.status).json({ message: migration.message });
    console.error(err);
    res.status(500).json({ message: 'Failed to submit request' });
  } finally {
    client.release();
  }
});

module.exports = router;
