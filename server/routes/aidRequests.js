const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

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

  try {
    const result = await pool.query(
      `INSERT INTO Aid_Requests (event_id, requester_name, phone, latitude, longitude, request_type, num_people, urgency_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [event_id || null, requester_name, phone, latitude || null, longitude || null, request_type || null, num_people, urgency_level]
    );
    // Requester contact details must never be broadcast to anonymous socket clients.
    req.app.get('io').emit('new-aid-request', { request_id: result.rows[0].request_id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to submit request' });
  }
});

module.exports = router;
