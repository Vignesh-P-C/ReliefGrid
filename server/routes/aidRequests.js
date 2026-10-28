const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { describeDatabaseError } = require('../lib/databaseErrors');
const { normalisePhone } = require('../lib/phone');

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

// Matches the Users/Aid_Requests column limits in schema.sql so overlong
// input is rejected with a 400 here instead of a 500 from Postgres (Audit #34).
const REQUESTER_NAME_MAX_LENGTH = 100;
const PHONE_MAX_LENGTH = 15;
const SUPPORTED_REQUEST_TYPES = ['shelter', 'medical', 'food', 'rescue'];

// POST /api/aid-requests — submitted from the public portal, no auth required.
// Validates type/range/length before SQL execution so bad input is a 400, not
// a database CHECK-constraint 500 (Audit #35).
router.post('/', async (req, res) => {
  const { event_id, requester_name, phone, latitude, longitude, request_type, num_people, urgency_level } = req.body;

  const trimmedName = typeof requester_name === 'string' ? requester_name.trim() : '';
  // Separators are not part of the number, so they do not count against the
  // column limit, and the stored value stays dialable either way.
  const normalisedPhone = normalisePhone(phone);

  if (!trimmedName || trimmedName.length > REQUESTER_NAME_MAX_LENGTH) {
    return res.status(400).json({ message: `requester_name is required and must be ${REQUESTER_NAME_MAX_LENGTH} characters or fewer` });
  }
  if (normalisedPhone === '' || normalisedPhone.length > PHONE_MAX_LENGTH) {
    return res.status(400).json({ message: `phone is required and must be at most ${PHONE_MAX_LENGTH} digits (spaces, dashes and brackets are ignored)` });
  }
  if (!Number.isInteger(Number(num_people)) || Number(num_people) < 1) {
    return res.status(400).json({ message: 'num_people must be a positive whole number' });
  }
  if (!Number.isInteger(Number(urgency_level)) || Number(urgency_level) < 1 || Number(urgency_level) > 5) {
    return res.status(400).json({ message: 'urgency_level must be a whole number from 1 to 5' });
  }
  if (request_type !== undefined && request_type !== null && !SUPPORTED_REQUEST_TYPES.includes(request_type)) {
    return res.status(400).json({ message: `request_type must be one of: ${SUPPORTED_REQUEST_TYPES.join(', ')}` });
  }
  if (event_id !== undefined && event_id !== null && event_id !== '' && (!Number.isInteger(Number(event_id)) || Number(event_id) < 1)) {
    return res.status(400).json({ message: 'event_id must be a positive whole number' });
  }

  const hasLatitude = latitude !== undefined && latitude !== null && latitude !== '';
  const hasLongitude = longitude !== undefined && longitude !== null && longitude !== '';
  if (hasLatitude !== hasLongitude) {
    return res.status(400).json({ message: 'latitude and longitude must both be provided together' });
  }
  if (hasLatitude) {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      return res.status(400).json({ message: 'latitude and longitude must be valid coordinates' });
    }
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
      [
        event_id ? Number(event_id) : null,
        trimmedName,
        normalisedPhone,
        hasLatitude ? Number(latitude) : null,
        hasLatitude ? Number(longitude) : null,
        request_type || null,
        Number(num_people),
        Number(urgency_level),
      ]
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
      // Two different FKs can fire in this transaction: Aid_Requests.event_id
      // and Request_Needs.category_id. Tell them apart by constraint name
      // instead of guessing, now that both inserts share one transaction.
      if (err.constraint === 'aid_requests_event_id_fkey') {
        return res.status(400).json({ message: 'event_id does not reference an existing disaster event' });
      }
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
