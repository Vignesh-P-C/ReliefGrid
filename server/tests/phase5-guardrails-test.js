/**
 * ReliefGrid — Phase 5 guardrails contract (Audit #46–#52).
 *
 * Covers: session restore (/auth/me), role and shelter-scope enforcement on the
 * write routes, the Socket.IO handshake, the CORS allowlist and security
 * headers, login throttling, and the two database changes — the capacity-log
 * actor and the Volunteer_Tasks.status constraint.
 *
 * Setup (all commands from `server/`):
 *   1. docker run --rm -d -e POSTGRES_PASSWORD=test -e POSTGRES_DB=reliefgrid_test -p 5433:5432 postgres:16
 *   2. TEST_DATABASE_URL=postgresql://postgres:test@localhost:5433/reliefgrid_test node tests/setup-test-db.js
 *   3. DATABASE_URL=postgresql://postgres:test@localhost:5433/reliefgrid_test JWT_SECRET=test-secret PORT=5059 node index.js
 *   4. API_URL=http://localhost:5059 TEST_DATABASE_URL=postgresql://postgres:test@localhost:5433/reliefgrid_test npm run test:phase5
 *
 * Step 3 must run with the same JWT_SECRET the tests use below.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

const API_URL = process.env.API_URL || 'http://localhost:5059';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:5433/reliefgrid_test';
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const PASSWORD = 'Guardrails1';

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS - ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL - ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
  }
}

// Shelter 1 is owned by coordinator 2; shelter 2 has no coordinator. Coordinator
// 3 therefore owns nothing, which is the case the scoping has to refuse.
async function loadFixtures() {
  const client = new Client({ connectionString: TEST_DATABASE_URL, ssl: false });
  await client.connect();

  await client.query('DELETE FROM Shelter_Capacity_Log');
  await client.query('DELETE FROM Allocations');
  await client.query('DELETE FROM Request_Needs');
  await client.query('DELETE FROM Aid_Requests');
  await client.query('DELETE FROM Volunteer_Tasks');
  await client.query('DELETE FROM Volunteers');
  await client.query('DELETE FROM Supplies');
  await client.query("DELETE FROM Supply_Categories WHERE name = 'Food'");
  await client.query('DELETE FROM Shelters');
  await client.query('DELETE FROM Users');

  const hash = await bcrypt.hash(PASSWORD, 10);
  await client.query(
    `INSERT INTO Users (user_id, name, phone, password_hash, role) VALUES
       (1, 'Admin One',     '9000000001', $1, 'Admin'),
       (2, 'Coord Two',     '9000000002', $1, 'ShelterCoordinator'),
       (3, 'Coord Three',   '9000000003', $1, 'ShelterCoordinator'),
       (4, 'Volunteer Four','9000000004', $1, 'Volunteer')`,
    [hash]
  );

  await client.query(
    `INSERT INTO Shelters (shelter_id, name, latitude, longitude, capacity_total, capacity_occupied, contact_number, coordinator_id, status) VALUES
       (1, 'Owned Camp',      10.00, 76.00, 100, 10, '9111111111', 2,    'active'),
       (2, 'Unassigned Camp', 10.10, 76.10,  50,  0, '9222222222', NULL, 'active')`
  );

  await client.query("INSERT INTO Supply_Categories (category_id, name) VALUES (1, 'Food')");
  await client.query(
    `INSERT INTO Supplies (supply_id, shelter_id, category_id, item_name, quantity, unit, reorder_threshold) VALUES
       (1, 1, 1, 'Rice packets', 100, 'packets', 10),
       (2, 2, 1, 'Rice packets', 100, 'packets', 10)`
  );

  await client.query(
    `INSERT INTO Aid_Requests (request_id, requester_name, phone, request_type, num_people, urgency_level, status)
     VALUES (1, 'Test Requester', '9333333333', 'food', 2, 3, 'pending')`
  );
  await client.query(
    `INSERT INTO Request_Needs (need_id, request_id, category_id, item_label, quantity_needed)
     VALUES (1, 1, 1, 'Food for 2 people', 2)`
  );
  await client.query(
    `INSERT INTO Volunteer_Tasks (task_id, shelter_id, description, status, priority)
     VALUES (1, 1, 'Phase 5 fixture task', 'pending', 2)`
  );

  for (const [sequence, table, column] of [
    ['users_user_id_seq', 'Users', 'user_id'],
    ['shelters_shelter_id_seq', 'Shelters', 'shelter_id'],
    ['supplies_supply_id_seq', 'Supplies', 'supply_id'],
    ['aid_requests_request_id_seq', 'Aid_Requests', 'request_id'],
    ['request_needs_need_id_seq', 'Request_Needs', 'need_id'],
    ['volunteer_tasks_task_id_seq', 'Volunteer_Tasks', 'task_id'],
    ['supply_categories_category_id_seq', 'Supply_Categories', 'category_id'],
  ]) {
    await client.query(`SELECT setval('${sequence}', (SELECT COALESCE(MAX(${column}), 1) FROM ${table}))`);
  }

  await client.end();
}

async function query(sql, params) {
  const client = new Client({ connectionString: TEST_DATABASE_URL, ssl: false });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function req(method, path, token, body, extraHeaders) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders || {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data, headers: res.headers };
}

async function login(phone, password = PASSWORD) {
  const { status, data } = await req('POST', '/api/auth/login', null, { phone, password });
  if (status !== 200) throw new Error(`login failed for ${phone}: ${status} ${JSON.stringify(data)}`);
  return data.token;
}

// The engine.io polling handshake, as a browser's Socket.IO client performs it:
// open a session, send the CONNECT packet with (or without) a token, then read
// the next poll for the answer.
async function socketHandshake(token) {
  const open = await fetch(`${API_URL}/socket.io/?EIO=4&transport=polling`);
  const openBody = await open.text();
  const sid = (openBody.match(/"sid":"([^"]+)"/) || [])[1];
  if (!sid) return { sid: null, answer: openBody };

  await fetch(`${API_URL}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: `40${JSON.stringify(token ? { token } : {})}`,
  });
  const poll = await fetch(`${API_URL}/socket.io/?EIO=4&transport=polling&sid=${sid}`);
  return { sid, answer: await poll.text() };
}

async function main() {
  console.log('Loading fixtures...');
  await loadFixtures();

  const adminToken = await login('9000000001');
  const ownerToken = await login('9000000002');
  const strangerToken = await login('9000000003');
  const volunteerToken = await login('9000000004');

  console.log('\n-- Audit #46: /auth/me restores the session --');
  {
    const { status, data } = await req('GET', '/api/auth/me', adminToken);
    check('GET /auth/me returns 200 with a valid token', status === 200, status);
    check('it reports the account and role', data?.user_id === 1 && data?.role === 'Admin', data);

    const anonymous = await req('GET', '/api/auth/me', null);
    check('it returns 401 without a token', anonymous.status === 401, anonymous.status);

    const malformed = await req('GET', '/api/auth/me', 'not-a-jwt');
    check('it returns 401 for a malformed token', malformed.status === 401, malformed.status);

    const deletedUser = jwt.sign({ user_id: 999999, role: 'Admin', name: 'Gone' }, JWT_SECRET, { expiresIn: '1h' });
    const gone = await req('GET', '/api/auth/me', deletedUser);
    check('a valid token for a deleted account returns 401', gone.status === 401, gone.status);
  }

  console.log('\n-- Audit #47: check-in and allocation are staff-only --');
  {
    const volunteerCheckin = await req('POST', '/api/shelters/1/checkin', volunteerToken, { num_people: 1 });
    check('a Volunteer cannot check anyone in (403)', volunteerCheckin.status === 403, volunteerCheckin.status);

    const volunteerCheckout = await req('POST', '/api/shelters/1/checkout', volunteerToken, { num_people: 1 });
    check('a Volunteer cannot check anyone out (403)', volunteerCheckout.status === 403, volunteerCheckout.status);

    const volunteerAllocate = await req('POST', '/api/supplies/allocate', volunteerToken, { request_id: 1, supply_id: 1, quantity: 1 });
    check('a Volunteer cannot allocate stock (403)', volunteerAllocate.status === 403, volunteerAllocate.status);

    const before = await query('SELECT capacity_occupied FROM Shelters WHERE shelter_id = 1');
    check('refused check-in did not change occupancy', before.rows[0].capacity_occupied === 10, before.rows[0]);

    const staffCheckin = await req('POST', '/api/shelters/1/checkin', ownerToken, { num_people: 3 });
    check('the shelter owner can check people in', staffCheckin.status === 200, staffCheckin.data);
    const after = await query('SELECT capacity_occupied FROM Shelters WHERE shelter_id = 1');
    check('occupancy rose by exactly the checked-in count', after.rows[0].capacity_occupied === 13, after.rows[0]);
  }

  console.log('\n-- Audit #48: writes are scoped to the assigned coordinator --');
  {
    const strangerCheckin = await req('POST', '/api/shelters/1/checkin', strangerToken, { num_people: 1 });
    check('a coordinator who does not own the shelter is refused (403)', strangerCheckin.status === 403, strangerCheckin.status);

    const unassignedCheckin = await req('POST', '/api/shelters/2/checkin', ownerToken, { num_people: 1 });
    check('the owner of shelter 1 is refused on unassigned shelter 2 (403)', unassignedCheckin.status === 403, unassignedCheckin.status);

    const strangerPatch = await req('PATCH', '/api/shelters/1', strangerToken, { capacity_total: 120 });
    check('a non-owner cannot edit the shelter (403)', strangerPatch.status === 403, strangerPatch.status);

    const ownerPatch = await req('PATCH', '/api/shelters/1', ownerToken, { contact_number: '9133333333' });
    check('the owner can edit their own shelter', ownerPatch.status === 200, ownerPatch.data);
    check('the edit was applied', ownerPatch.data?.contact_number === '9133333333', ownerPatch.data?.contact_number);

    const reassign = await req('PATCH', '/api/shelters/1', ownerToken, { coordinator_id: 3 });
    check('a coordinator cannot reassign a shelter (403)', reassign.status === 403, reassign.status);

    const adminReassign = await req('PATCH', '/api/shelters/2', adminToken, { coordinator_id: 3 });
    check('an Admin can assign a shelter to a coordinator', adminReassign.status === 200, adminReassign.data);
    const strangerNowOwns = await req('POST', '/api/shelters/2/checkin', strangerToken, { num_people: 1 });
    check('the newly assigned coordinator can now check in there', strangerNowOwns.status === 200, strangerNowOwns.data);

    const adminCheckinAnywhere = await req('POST', '/api/shelters/2/checkin', adminToken, { num_people: 1 });
    check('an Admin is not scoped', adminCheckinAnywhere.status === 200, adminCheckinAnywhere.data);

    // Allocation spends stock held at a shelter, so it is scoped the same way.
    const strangerAllocate = await req('POST', '/api/supplies/allocate', strangerToken, { request_id: 1, supply_id: 1, quantity: 1, need_id: 1 });
    check('allocating another shelter\'s stock is refused (403)', strangerAllocate.status === 403, strangerAllocate.status);

    const ownerAllocate = await req('POST', '/api/supplies/allocate', ownerToken, { request_id: 1, supply_id: 1, quantity: 1, need_id: 1 });
    check('the owner can allocate their own stock', ownerAllocate.status === 200 && ownerAllocate.data?.success === true, ownerAllocate.data);

    const adminAllocate = await req('POST', '/api/supplies/allocate', adminToken, { request_id: 1, supply_id: 2, quantity: 1, need_id: 1 });
    check('an Admin can allocate from any shelter (not refused)', adminAllocate.status !== 403 && adminAllocate.status !== 401, adminAllocate.status);
  }

  console.log('\n-- Audit #51: capacity changes name the actor --');
  {
    const log = await query(
      `SELECT changed_by, change_type, capacity_occupied
       FROM Shelter_Capacity_Log
       WHERE shelter_id = 1
       ORDER BY log_id DESC
       LIMIT 1`
    );
    check('a check-in writes a capacity-log row', log.rowCount === 1, log.rows);
    check('the row names the signed-in user', log.rows[0]?.changed_by === 2, log.rows[0]);
    check("the row records the kind of change ('checkin')", log.rows[0]?.change_type === 'checkin', log.rows[0]);

    const checkout = await req('POST', '/api/shelters/1/checkout', ownerToken, { num_people: 1 });
    check('check-out succeeds', checkout.status === 200, checkout.data);
    const afterCheckout = await query(
      `SELECT changed_by, change_type FROM Shelter_Capacity_Log
       WHERE shelter_id = 1 ORDER BY log_id DESC LIMIT 1`
    );
    check("a check-out is logged as 'checkout' by the same actor",
      afterCheckout.rows[0]?.change_type === 'checkout' && afterCheckout.rows[0]?.changed_by === 2,
      afterCheckout.rows[0]);

    // Direct SQL has no actor to attribute: the column stays NULL rather than
    // blocking the write.
    await query('UPDATE Shelters SET capacity_occupied = capacity_occupied + 1 WHERE shelter_id = 2');
    const direct = await query(
      `SELECT changed_by FROM Shelter_Capacity_Log WHERE shelter_id = 2 ORDER BY log_id DESC LIMIT 1`
    );
    check('a change made outside the API logs a NULL actor', direct.rows[0]?.changed_by === null, direct.rows[0]);
  }

  console.log('\n-- Audit #52: Volunteer_Tasks.status is constrained --');
  {
    let rejected = false;
    let code = null;
    try {
      await query("INSERT INTO Volunteer_Tasks (shelter_id, description, status) VALUES (1, 'bad status', 'nonsense')");
    } catch (err) {
      rejected = true;
      code = err.code;
    }
    check('an unknown task status is rejected by the database', rejected && code === '23514', code);

    let allowed = true;
    try {
      await query("INSERT INTO Volunteer_Tasks (shelter_id, description, status) VALUES (1, 'ok status', 'in_progress')");
    } catch (err) {
      allowed = false;
    }
    check('a real status is still accepted', allowed);
  }

  console.log('\n-- Audit #48: the board reports the shelter owner --');
  {
    const { status, data } = await req('GET', '/api/shelters', ownerToken);
    check('GET /shelters returns 200', status === 200, status);
    const owned = Array.isArray(data) && data.find((shelter) => shelter.shelter_id === 1);
    check('the view carries coordinator_id for every shelter',
      Array.isArray(data) && data.every((shelter) => 'coordinator_id' in shelter),
      Array.isArray(data) ? Object.keys(data[0] || {}) : data);
    check('shelter 1 reports its assigned coordinator', owned?.coordinator_id === 2, owned?.coordinator_id);
  }

  console.log('\n-- Audit #49: Socket.IO refuses an anonymous client --');
  {
    const anonymous = await socketHandshake(null);
    check('an unauthenticated handshake reaches the server', Boolean(anonymous.sid), anonymous.answer);
    check('the connection is refused as unauthorized', /unauthorized/i.test(anonymous.answer), anonymous.answer);

    const authenticated = await socketHandshake(adminToken);
    check('an authenticated handshake is accepted', /"sid"/.test(authenticated.answer), authenticated.answer);
    check('it is not refused', !/unauthorized/i.test(authenticated.answer), authenticated.answer);
  }

  console.log('\n-- Audit #50: CORS allowlist, security headers, login throttling --');
  {
    const foreign = await req('GET', '/health', null, undefined, { Origin: 'https://evil.example' });
    check('a foreign Origin gets no CORS approval', foreign.headers.get('access-control-allow-origin') === null,
      foreign.headers.get('access-control-allow-origin'));

    const allowed = await req('GET', '/health', null, undefined, { Origin: 'http://localhost:5173' });
    check('a known origin is approved', allowed.headers.get('access-control-allow-origin') === 'http://localhost:5173',
      allowed.headers.get('access-control-allow-origin'));

    const preflight = await req('OPTIONS', '/api/shelters', null, undefined, {
      Origin: 'https://evil.example',
      'Access-Control-Request-Method': 'POST',
    });
    check('a foreign preflight is not approved', preflight.headers.get('access-control-allow-origin') === null,
      preflight.headers.get('access-control-allow-origin'));

    const health = await req('GET', '/health');
    check('security headers are set', health.headers.get('x-content-type-options') === 'nosniff'
      && health.headers.get('x-frame-options') === 'DENY'
      && health.headers.get('referrer-policy') === 'no-referrer', {
      nosniff: health.headers.get('x-content-type-options'),
      frame: health.headers.get('x-frame-options'),
      referrer: health.headers.get('referrer-policy'),
    });
    check('the server does not advertise itself', health.headers.get('x-powered-by') === null,
      health.headers.get('x-powered-by'));

    // Throttling is keyed by number + caller, so brute-forcing one account must
    // not lock a different account out.
    let throttled = null;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const failed = await req('POST', '/api/auth/login', null, { phone: '9000000004', password: 'wrong-password' });
      if (failed.status === 429) { throttled = { attempt, response: failed }; break; }
    }
    check('repeated failures are throttled with 429', throttled !== null, throttled);
    check('the 429 carries Retry-After', throttled !== null && Number(throttled.response.headers.get('retry-after')) > 0,
      throttled && throttled.response.headers.get('retry-after'));

    const stillLocked = await req('POST', '/api/auth/login', null, { phone: '9000000004', password: PASSWORD });
    check('the correct password is refused while the lock holds', stillLocked.status === 429, stillLocked.status);

    const otherAccount = await req('POST', '/api/auth/login', null, { phone: '9000000001', password: PASSWORD });
    check('a different account is unaffected', otherAccount.status === 200, otherAccount.status);
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
