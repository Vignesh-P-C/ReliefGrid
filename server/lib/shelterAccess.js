const pool = require('../db');

// Shelter-level authorization (Audit #48). Until Phase 5 any coordinator could
// act on any shelter's capacity and stock, even one another team runs in a
// different district. The rule now: an Admin may act on any shelter, a
// ShelterCoordinator only on the shelters assigned to them through
// Shelters.coordinator_id.
//
// Returns null when the action is allowed, or a { status, message } pair the
// route should answer with, so every write route reports the refusal the same
// way.

async function shelterAccessDenial(user, shelterId) {
  if (!user) return { status: 401, message: 'Authentication required' };
  if (user.role === 'Admin') return null;

  const result = await pool.query('SELECT coordinator_id FROM Shelters WHERE shelter_id = $1', [shelterId]);
  if (result.rowCount === 0) {
    return { status: 404, message: 'No shelter exists with this ID' };
  }
  if (result.rows[0].coordinator_id !== user.user_id) {
    return {
      status: 403,
      message: 'You are not the assigned coordinator for this shelter. Ask an Admin to assign you, or to make the change.',
    };
  }
  return null;
}

// Allocating spends stock held at a shelter, so it is scoped the same way.
async function allocationAccessDenial(user, supplyId) {
  if (!user) return { status: 401, message: 'Authentication required' };
  if (user.role === 'Admin') return null;

  const result = await pool.query('SELECT shelter_id FROM Supplies WHERE supply_id = $1', [supplyId]);
  if (result.rowCount === 0) {
    return { status: 404, message: 'No stock item exists with this ID' };
  }
  const shelterId = result.rows[0].shelter_id;
  if (shelterId === null) {
    return { status: 403, message: 'This stock item is not held at a shelter, so only an Admin can allocate it' };
  }
  return shelterAccessDenial(user, shelterId);
}

module.exports = { shelterAccessDenial, allocationAccessDenial };
