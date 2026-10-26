/**
 * ReliefGrid — allocation integrity test (Phase 2).
 *
 * Exercises allocate_supply() directly against PostgreSQL, so it needs no API
 * server and no JWT — only a database with schema.sql (or all migrations) and
 * seed.sql applied, because it borrows a shelter and two supply categories
 * from the seed data.
 *
 *   DATABASE_URL=postgres://… node tests/allocation-test.js
 *
 * Everything it creates is deleted again at the end, so it is safe to run
 * against a demo database.
 */

require('dotenv').config();
const { Client } = require('pg');

const connection = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
};

const results = [];
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, pass, actual, expected });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

async function allocate(client, requestId, supplyId, quantity, needId = null) {
  const { rows } = await client.query(
    'SELECT * FROM allocate_supply($1, $2, $3, $4, 1)',
    [requestId, supplyId, quantity, needId]
  );
  return rows[0];
}

async function main() {
  const db = new Client(connection);
  const racer = new Client(connection);
  await db.connect();
  await racer.connect();

  const created = { requests: [], supplies: [] };
  try {
    const shelters = await db.query('SELECT shelter_id FROM Shelters ORDER BY shelter_id LIMIT 1');
    if (shelters.rowCount === 0) throw new Error('No shelters found — run seed.sql first');

    const categories = await db.query(
      "SELECT category_id, name FROM Supply_Categories WHERE name IN ('Food', 'Medical') ORDER BY name"
    );
    if (categories.rowCount < 2) throw new Error('Seed supply categories (Food, Medical) are required');
    const [categoryA, categoryB] = categories.rows;

    const shelterId = shelters.rows[0].shelter_id;

    const makeRequest = async (requestType, numPeople, need = null) => {
      const inserted = await db.query(
        `INSERT INTO Aid_Requests (requester_name, phone, request_type, num_people, urgency_level)
         VALUES ('Allocation test (synthetic)', 'ALLOC-TEST', $1, $2, 3)
         RETURNING request_id`,
        [requestType, numPeople]
      );
      const requestId = inserted.rows[0].request_id;
      created.requests.push(requestId);
      if (!need) return { requestId, needId: null };

      const needRow = await db.query(
        `INSERT INTO Request_Needs (request_id, category_id, quantity_needed)
         VALUES ($1, $2, $3) RETURNING need_id`,
        [requestId, need.categoryId, need.quantity]
      );
      return { requestId, needId: needRow.rows[0].need_id };
    };

    const makeSupply = async (categoryId, quantity) => {
      const inserted = await db.query(
        `INSERT INTO Supplies (shelter_id, category_id, item_name, quantity, unit, reorder_threshold)
         VALUES ($1, $2, 'Allocation test item', $3, 'units', 0)
         RETURNING supply_id`,
        [shelterId, categoryId, quantity]
      );
      created.supplies.push(inserted.rows[0].supply_id);
      return inserted.rows[0].supply_id;
    };

    const supplyId = await makeSupply(categoryA.category_id, 10);
    const partial = await makeRequest('food', 5, { categoryId: categoryA.category_id, quantity: 5 });

    // 1. A partial allocation leaves the request open.
    let outcome = await allocate(db, partial.requestId, supplyId, 2, partial.needId);
    check('partial allocation succeeds', outcome.code, 'ok');
    check('partial allocation keeps request open', outcome.request_status, 'partially_fulfilled');
    check('partial allocation reports remaining need', Number(outcome.remaining_need), 3);

    // 2. Allocating past the outstanding need is refused.
    outcome = await allocate(db, partial.requestId, supplyId, 4, partial.needId);
    check('over-allocating the need is refused', outcome.code, 'exceeds_remaining_need');
    check('refused allocation leaves stock untouched', Number(outcome.available_stock), 8);

    // 3. Meeting the need closes the request.
    outcome = await allocate(db, partial.requestId, supplyId, 3, partial.needId);
    check('completing the need fulfils the request', outcome.request_status, 'fulfilled');

    // 4. A fulfilled request cannot receive more.
    outcome = await allocate(db, partial.requestId, supplyId, 1, partial.needId);
    check('fulfilled request rejects further allocation', outcome.code, 'request_not_eligible');

    // 5. A request that does not exist is a not-found, not a crash.
    outcome = await allocate(db, 999999999, supplyId, 1);
    check('missing request is rejected', outcome.code, 'request_not_found');

    // 6. Shelter-only requests have no item need to satisfy.
    const shelterOnly = await makeRequest('shelter', 3);
    outcome = await allocate(db, shelterOnly.requestId, supplyId, 1);
    check('shelter-only request has no item needs', outcome.code, 'no_item_needs');

    // 7. Stock that does not match the requested category is refused.
    const medical = await makeRequest('medical', 2, { categoryId: categoryB.category_id, quantity: 2 });
    outcome = await allocate(db, medical.requestId, supplyId, 1, medical.needId);
    check('wrong category for the need is refused', outcome.code, 'need_mismatch');

    // 8. Stock shortage is reported as such, and nothing is deducted.
    const scarceSupplyId = await makeSupply(categoryA.category_id, 1);
    const largeNeed = await makeRequest('food', 50, { categoryId: categoryA.category_id, quantity: 50 });
    outcome = await allocate(db, largeNeed.requestId, scarceSupplyId, 5, largeNeed.needId);
    check('insufficient stock is reported', outcome.code, 'insufficient_stock');
    const scarce = await db.query('SELECT quantity FROM Supplies WHERE supply_id = $1', [scarceSupplyId]);
    check('rejected allocation does not deduct stock', Number(scarce.rows[0].quantity), 1);
    const createdAllocations = await db.query('SELECT count(*)::int AS n FROM Allocations WHERE supply_id = $1', [scarceSupplyId]);
    check('rejected allocation creates no allocation row', createdAllocations.rows[0].n, 0);

    // 9. Two simultaneous allocations cannot both consume the last unit of need.
    const raceSupplyId = await makeSupply(categoryA.category_id, 5);
    const race = await makeRequest('food', 1, { categoryId: categoryA.category_id, quantity: 1 });
    const raceOutcomes = await Promise.all([
      allocate(db, race.requestId, raceSupplyId, 1, race.needId),
      allocate(racer, race.requestId, raceSupplyId, 1, race.needId),
    ]);
    check('exactly one concurrent allocation succeeds', raceOutcomes.filter((o) => o.success).length, 1);
    const raced = await db.query(
      'SELECT COALESCE(SUM(quantity_allocated), 0)::int AS allocated FROM Allocations WHERE request_id = $1',
      [race.requestId]
    );
    check('concurrent allocation does not over-allocate the need', raced.rows[0].allocated, 1);
    const raceStock = await db.query('SELECT quantity FROM Supplies WHERE supply_id = $1', [raceSupplyId]);
    check('concurrent allocation deducts stock once', Number(raceStock.rows[0].quantity), 4);
  } finally {
    if (created.requests.length > 0) {
      await racer.query('DELETE FROM Allocations WHERE request_id = ANY($1::int[])', [created.requests]).catch(() => {});
      await db.query('DELETE FROM Allocations WHERE request_id = ANY($1::int[])', [created.requests]).catch(() => {});
      await db.query('DELETE FROM Request_Needs WHERE request_id = ANY($1::int[])', [created.requests]).catch(() => {});
      await db.query('DELETE FROM Aid_Requests WHERE request_id = ANY($1::int[])', [created.requests]).catch(() => {});
    }
    if (created.supplies.length > 0) {
      await db.query('DELETE FROM Supplies WHERE supply_id = ANY($1::int[])', [created.supplies]).catch(() => {});
    }
    await db.end();
    await racer.end();
  }

  const failed = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Allocation test failed:', error.message);
  process.exitCode = 1;
});
