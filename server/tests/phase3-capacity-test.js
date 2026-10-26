/**
 * ReliefGrid — Phase 3 "Capacity truth" integration test (Audit #19-#22, #25).
 *
 * Exercises the real HTTP API against a disposable local Postgres (never
 * Render/Supabase). Loads a small deterministic fixture set, then asserts
 * every acceptance criterion from issues #62-#66.
 *
 * Usage:
 *   1. docker run --rm -d -e POSTGRES_PASSWORD=test -e POSTGRES_DB=reliefgrid_test -p 5433:5432 postgres:16
 *   2. TEST_DATABASE_URL=postgresql://postgres:test@localhost:5433/reliefgrid_test node tests/setup-test-db.js
 *   3. DATABASE_URL=postgresql://postgres:test@localhost:5433/reliefgrid_test JWT_SECRET=test-secret PORT=5057 node index.js   (separate terminal)
 *   4. API_URL=http://localhost:5057 TEST_DATABASE_URL=postgresql://postgres:test@localhost:5433/reliefgrid_test npm run test:phase3
 */

const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const API_URL = process.env.API_URL || 'http://localhost:5057';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:5433/reliefgrid_test';

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS - ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL - ${label}${detail ? ` (${detail})` : ''}`);
  }
}

async function loadFixtures() {
  const client = new Client({ connectionString: TEST_DATABASE_URL, ssl: false });
  await client.connect();

  await client.query(
    `INSERT INTO Disaster_Events (event_id, name, type, region, severity, start_date)
     VALUES (1, 'Test Flood Event', 'flood', 'Test Region', 3, '2026-01-01')`
  );
  await client.query(
    `INSERT INTO Shelters (shelter_id, event_id, name, address, latitude, longitude, capacity_total, capacity_occupied, contact_number, status) VALUES
       (1, 1, 'Active Shelter',   '1 Test Rd', 10.0, 76.0, 5, 3, '1111111111', 'active'),
       (2, 1, 'Inactive Shelter', '2 Test Rd', 10.1, 76.1, 5, 2, '2222222222', 'inactive'),
       (3, 1, 'Full Shelter',     '3 Test Rd', 10.2, 76.2, 2, 2, '3333333333', 'active'),
       (4, 1, 'Race Shelter',     '4 Test Rd', 10.3, 76.3, 3, 2, '4444444444', 'active')`
  );

  const adminHash = await bcrypt.hash('AdminPass123', 10);
  const volunteerHash = await bcrypt.hash('VolPass123', 10);
  await client.query(
    `INSERT INTO Users (name, phone, password_hash, role) VALUES
       ('Test Admin', '9000000001', $1, 'Admin'),
       ('Test Volunteer', '9000000002', $2, 'Volunteer')`,
    [adminHash, volunteerHash]
  );

  // Explicit PKs above don't advance the SERIAL sequences, so the next
  // plain INSERT (e.g. POST /api/shelters in the tests below) would try to
  // reuse shelter_id 1 and collide. Resync every sequence to its table's max.
  await client.query("SELECT setval('shelters_shelter_id_seq', (SELECT MAX(shelter_id) FROM Shelters))");
  await client.query("SELECT setval('disaster_events_event_id_seq', (SELECT MAX(event_id) FROM Disaster_Events))");
  await client.query("SELECT setval('users_user_id_seq', (SELECT MAX(user_id) FROM Users))");

  await client.end();
}

async function login(phone, password) {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const body = await res.json();
  if (res.status !== 200) throw new Error(`login failed for ${phone}: ${JSON.stringify(body)}`);
  return body.token;
}

async function req(method, path, token, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

async function main() {
  console.log('Loading fixtures...');
  await loadFixtures();

  console.log('Logging in as Admin and Volunteer...');
  const adminToken = await login('9000000001', 'AdminPass123');
  const volunteerToken = await login('9000000002', 'VolPass123');

  console.log('\n-- Audit #22: event-/status-aware live board --');
  {
    const { status, data } = await req('GET', '/api/shelters');
    check('GET /shelters returns 200', status === 200, status);
    const active = data.find((s) => s.shelter_id === 1);
    const inactive = data.find((s) => s.shelter_id === 2);
    check('active shelter has event_id/event_name/is_active=true', active && active.event_id === 1 && active.event_name === 'Test Flood Event' && active.is_active === true);
    check('inactive shelter reports is_active=false', inactive && inactive.is_active === false);
  }

  console.log('\n-- Audit #22: ranked view excludes inactive shelters --');
  {
    const { status, data } = await req('GET', '/api/shelters/ranked');
    check('GET /shelters/ranked returns 200', status === 200);
    check('ranked list excludes the inactive shelter', !data.some((s) => s.shelter_id === 2));
    check('ranked list still includes active shelters', data.some((s) => s.shelter_id === 1));
  }

  console.log('\n-- Audit #21: unknown shelter ID on check-in --');
  {
    const { status, data } = await req('POST', '/api/shelters/9999/checkin', volunteerToken, { num_people: 1 });
    check('check-in to unknown shelter returns 404', status === 404, status);
    check('response is not a false success', data?.success !== true);
  }

  console.log('\n-- Audit #20: check-in blocked on inactive shelter --');
  {
    const { status, data } = await req('POST', '/api/shelters/2/checkin', volunteerToken, { num_people: 1 });
    check('check-in to inactive shelter returns 409', status === 409, status);
    check('message mentions closed/inactive', /inactive|closed/i.test(data?.message || ''));
  }

  console.log('\n-- check-in blocked when full --');
  {
    const { status, data } = await req('POST', '/api/shelters/3/checkin', volunteerToken, { num_people: 1 });
    check('check-in to full shelter returns 409', status === 409, status);
    check('message mentions space', /space/i.test(data?.message || ''));
  }

  console.log('\n-- Audit #19: check-in then check-out on an active shelter --');
  {
    const before = (await req('GET', '/api/shelters')).data.find((s) => s.shelter_id === 1);
    const checkinResult = await req('POST', '/api/shelters/1/checkin', volunteerToken, { num_people: 1 });
    check('valid check-in succeeds', checkinResult.status === 200 && checkinResult.data?.success === true, checkinResult.status);

    const afterCheckin = (await req('GET', '/api/shelters')).data.find((s) => s.shelter_id === 1);
    check('occupancy increased by 1 after check-in', afterCheckin.capacity_occupied === before.capacity_occupied + 1);

    const overCheckout = await req('POST', '/api/shelters/1/checkout', volunteerToken, { num_people: 999 });
    check('check-out exceeding occupancy returns 409', overCheckout.status === 409, overCheckout.status);

    const checkoutResult = await req('POST', '/api/shelters/1/checkout', volunteerToken, { num_people: 1 });
    check('valid check-out succeeds', checkoutResult.status === 200 && checkoutResult.data?.success === true, checkoutResult.status);

    const afterCheckout = (await req('GET', '/api/shelters')).data.find((s) => s.shelter_id === 1);
    check('occupancy back to original after check-out', afterCheckout.capacity_occupied === before.capacity_occupied);

    const unknownCheckout = await req('POST', '/api/shelters/9999/checkout', volunteerToken, { num_people: 1 });
    check('check-out of unknown shelter returns 404', unknownCheckout.status === 404, unknownCheckout.status);
  }

  console.log('\n-- Audit #25: shelter management is role-gated --');
  {
    const asVolunteer = await req('POST', '/api/shelters', volunteerToken, {
      name: 'New Shelter', latitude: 11, longitude: 77, capacity_total: 10,
    });
    check('Volunteer cannot create a shelter (403)', asVolunteer.status === 403, asVolunteer.status);

    const asVolunteerGet = await req('GET', '/api/shelters/1', volunteerToken);
    check('Volunteer cannot read the full shelter record (403)', asVolunteerGet.status === 403, asVolunteerGet.status);
  }

  console.log('\n-- Audit #25: shelter create/edit as Admin --');
  let newShelterId;
  {
    const missingCapacity = await req('POST', '/api/shelters', adminToken, { name: 'Bad Shelter', latitude: 11, longitude: 77 });
    check('create without capacity_total returns 400', missingCapacity.status === 400, missingCapacity.status);

    const created = await req('POST', '/api/shelters', adminToken, {
      name: 'New Shelter', latitude: 11, longitude: 77, capacity_total: 10, contact_number: '9999999999',
    });
    check('Admin can create a shelter (201)', created.status === 201, created.status);
    newShelterId = created.data?.shelter_id;

    const listed = await req('GET', '/api/shelters');
    check('new shelter appears on the live board', listed.data.some((s) => s.shelter_id === newShelterId));

    const fullRecord = await req('GET', `/api/shelters/${newShelterId}`, adminToken);
    check('Admin can read the full shelter record', fullRecord.status === 200 && fullRecord.data.contact_number === '9999999999');
  }

  console.log('\n-- Audit #25: capacity_total cannot drop below current occupancy --');
  {
    await req('POST', `/api/shelters/${newShelterId}/checkin`, volunteerToken, { num_people: 4 });
    const shrink = await req('PATCH', `/api/shelters/${newShelterId}`, adminToken, { capacity_total: 2 });
    check('reducing capacity_total below occupancy returns 409', shrink.status === 409, shrink.status);

    const badStatus = await req('PATCH', `/api/shelters/${newShelterId}`, adminToken, { status: 'closed-ish' });
    check('invalid status value returns 400', badStatus.status === 400, badStatus.status);

    const validEdit = await req('PATCH', `/api/shelters/${newShelterId}`, adminToken, { status: 'inactive' });
    check('valid edit (closing the shelter) returns 200', validEdit.status === 200 && validEdit.data.status === 'inactive', validEdit.status);

    const unknownPatch = await req('PATCH', '/api/shelters/9999', adminToken, { status: 'inactive' });
    check('editing an unknown shelter returns 404', unknownPatch.status === 404, unknownPatch.status);
  }

  console.log('\n-- A closed shelter can still be emptied --');
  {
    // newShelterId was closed (status -> inactive) in the block above while it
    // still had 4 people checked in. Closing it must not freeze that occupancy.
    const checkinWhileClosed = await req('POST', `/api/shelters/${newShelterId}/checkin`, volunteerToken, { num_people: 1 });
    check('check-in is still blocked once closed', checkinWhileClosed.status === 409, checkinWhileClosed.status);

    const checkoutWhileClosed = await req('POST', `/api/shelters/${newShelterId}/checkout`, volunteerToken, { num_people: 4 });
    check('check-out still works on a closed shelter', checkoutWhileClosed.status === 200 && checkoutWhileClosed.data?.success === true, checkoutWhileClosed.status);

    const emptied = (await req('GET', '/api/shelters')).data.find((s) => s.shelter_id === newShelterId);
    check('closed shelter is now fully emptied', emptied?.capacity_occupied === 0, emptied);
  }

  console.log('\n-- Non-numeric shelter IDs are rejected, not 500 --');
  {
    const checkin = await req('POST', '/api/shelters/abc/checkin', volunteerToken, { num_people: 1 });
    check('check-in with a non-numeric id returns 400', checkin.status === 400, checkin.status);

    const checkout = await req('POST', '/api/shelters/abc/checkout', volunteerToken, { num_people: 1 });
    check('check-out with a non-numeric id returns 400', checkout.status === 400, checkout.status);

    const get = await req('GET', '/api/shelters/abc', adminToken);
    check('GET with a non-numeric id returns 400', get.status === 400, get.status);

    const patch = await req('PATCH', '/api/shelters/abc', adminToken, { status: 'inactive' });
    check('PATCH with a non-numeric id returns 400', patch.status === 400, patch.status);
  }

  console.log('\n-- Audit #25: status validation rejects an empty string, not a silent default --');
  {
    const created = await req('POST', '/api/shelters', adminToken, {
      name: 'Empty Status Shelter', latitude: 12, longitude: 78, capacity_total: 5, status: '',
    });
    check('creating a shelter with status: "" returns 400', created.status === 400, created.status);

    const patched = await req('PATCH', `/api/shelters/1`, adminToken, { status: '' });
    check('editing a shelter with status: "" returns 400', patched.status === 400, patched.status);
  }

  console.log('\n-- The SQL functions reject a non-positive num_people even if called directly --');
  {
    const client = new Client({ connectionString: TEST_DATABASE_URL, ssl: false });
    await client.connect();

    const before = (await client.query('SELECT capacity_occupied FROM Shelters WHERE shelter_id = 1')).rows[0];
    const zero = (await client.query('SELECT checkin_to_shelter(1, 0) AS outcome')).rows[0].outcome;
    check('checkin_to_shelter(id, 0) is rejected', zero === 'invalid_quantity', zero);
    const negativeCheckin = (await client.query('SELECT checkin_to_shelter(1, -5) AS outcome')).rows[0].outcome;
    check('checkin_to_shelter(id, -5) is rejected (would otherwise decrement on "check-in")', negativeCheckin === 'invalid_quantity', negativeCheckin);
    const negativeCheckout = (await client.query('SELECT checkout_from_shelter(1, -5) AS outcome')).rows[0].outcome;
    check('checkout_from_shelter(id, -5) is rejected (would otherwise increment on "check-out")', negativeCheckout === 'invalid_quantity', negativeCheckout);

    const after = (await client.query('SELECT capacity_occupied FROM Shelters WHERE shelter_id = 1')).rows[0];
    check('occupancy is unchanged by all three rejected calls', after.capacity_occupied === before.capacity_occupied, { before, after });

    await client.end();
  }

  console.log('\n-- Concurrent check-in and check-out on the same shelter serialize safely --');
  {
    // Shelter 4 starts at 2/3. A concurrent checkin(2) and checkout(1) race:
    // whichever the row lock admits first decides the outcome, but both
    // orderings are internally consistent (no lost update, no overbooking):
    //   checkout then checkin: 2-1=1, then 1+2=3 (<=3, succeeds)   -> final 3, both succeed
    //   checkin then checkout: 2+2=4 (>3, rejected), then 2-1=1    -> final 1, checkin rejected
    const [checkinResult, checkoutResult] = await Promise.all([
      req('POST', '/api/shelters/4/checkin', volunteerToken, { num_people: 2 }),
      req('POST', '/api/shelters/4/checkout', volunteerToken, { num_people: 1 }),
    ]);
    check('check-out never fails in this race (never exceeds occupancy)', checkoutResult.status === 200, checkoutResult.status);

    const final = (await req('GET', '/api/shelters')).data.find((s) => s.shelter_id === 4);
    const consistentWithSerialOrder = (checkinResult.status === 200 && final.capacity_occupied === 3)
      || (checkinResult.status === 409 && final.capacity_occupied === 1);
    check(
      'final occupancy matches one of the two valid serial orderings, not a corrupted value',
      consistentWithSerialOrder,
      { checkinStatus: checkinResult.status, finalOccupied: final?.capacity_occupied }
    );
    check('occupancy never exceeded capacity_total under concurrent load', final.capacity_occupied <= 3, final);
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
