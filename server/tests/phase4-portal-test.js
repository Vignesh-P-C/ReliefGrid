/**
 * ReliefGrid — Phase 4 "Portal trust" integration test (Audit #34-#36, #39-#42).
 *
 * Exercises the real HTTP API against a disposable local Postgres (never
 * Render/Supabase). Loads a small deterministic fixture set, then asserts
 * every acceptance criterion from issues #67-#74 that's observable over HTTP.
 *
 * Usage:
 *   1. docker run --rm -d -e POSTGRES_PASSWORD=test -e POSTGRES_DB=reliefgrid_test -p 5433:5432 postgres:16
 *   2. TEST_DATABASE_URL=postgresql://postgres:test@localhost:5433/reliefgrid_test node tests/setup-test-db.js
 *   3. DATABASE_URL=postgresql://postgres:test@localhost:5433/reliefgrid_test JWT_SECRET=test-secret PORT=5058 node index.js   (separate terminal)
 *   4. API_URL=http://127.0.0.1:5058 TEST_DATABASE_URL=postgresql://postgres:test@localhost:5433/reliefgrid_test node tests/phase4-portal-test.js
 */

const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const API_URL = process.env.API_URL || 'http://127.0.0.1:5058';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:5433/reliefgrid_test';

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS - ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL - ${label}${detail !== undefined ? ` (${JSON.stringify(detail)})` : ''}`);
  }
}

async function loadFixtures() {
  const client = new Client({ connectionString: TEST_DATABASE_URL, ssl: false });
  await client.connect();

  await client.query(
    `INSERT INTO Disaster_Events (event_id, name, type, region, severity, start_date, end_date) VALUES
       (1, 'Active Test Event', 'flood', 'Test Region', 3, '2026-01-01', NULL),
       (2, 'Past Test Event', 'flood', 'Old Region', 2, '2020-01-01', '2020-02-01')`
  );

  // Shelter B is closer to the reference point (10.0, 76.0) but full; Shelter
  // A has space but is farther away — proves has_space ordering beats raw
  // distance instead of full shelters vanishing from the result (Audit #41).
  await client.query(
    `INSERT INTO Shelters (shelter_id, event_id, name, address, latitude, longitude, capacity_total, capacity_occupied, contact_number, status) VALUES
       (1, 1, 'Shelter With Space', '1 Open Rd', 10.5, 76.5, 10, 2, '1111111111', 'active'),
       (2, 1, 'Full Shelter',       '2 Full Rd', 10.01, 76.01, 2, 2, '2222222222', 'active')`
  );

  const adminHash = await bcrypt.hash('AdminPass123', 10);
  await client.query(
    `INSERT INTO Users (name, phone, password_hash, role) VALUES ('Test Admin', '9000000001', $1, 'Admin')`,
    [adminHash]
  );

  await client.query("SELECT setval('disaster_events_event_id_seq', (SELECT MAX(event_id) FROM Disaster_Events))");
  await client.query("SELECT setval('shelters_shelter_id_seq', (SELECT MAX(shelter_id) FROM Shelters))");
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

const validRequest = () => ({
  requester_name: 'Jane Doe',
  phone: '9876543210',
  request_type: 'shelter',
  num_people: 2,
  urgency_level: 3,
});

async function main() {
  console.log('Loading fixtures...');
  await loadFixtures();
  const adminToken = await login('9000000001', 'AdminPass123');

  console.log('\n-- Audit #42: only active events are listed --');
  {
    const { status, data } = await req('GET', '/api/events');
    check('GET /events returns 200', status === 200, status);
    check('exactly one active event returned', Array.isArray(data) && data.length === 1 && data[0].event_id === 1, data);
  }

  console.log('\n-- Audit #34/#35: aid-request validation --');
  {
    const overlongName = await req('POST', '/api/aid-requests', null, { ...validRequest(), requester_name: 'A'.repeat(101) });
    check('name over 100 chars returns 400', overlongName.status === 400, overlongName.status);

    const overlongPhone = await req('POST', '/api/aid-requests', null, { ...validRequest(), phone: '1'.repeat(16) });
    check('phone over 15 chars returns 400', overlongPhone.status === 400, overlongPhone.status);

    const badPeople = await req('POST', '/api/aid-requests', null, { ...validRequest(), num_people: 0 });
    check('num_people = 0 returns 400', badPeople.status === 400, badPeople.status);

    const badUrgency = await req('POST', '/api/aid-requests', null, { ...validRequest(), urgency_level: 9 });
    check('urgency_level out of 1-5 range returns 400', badUrgency.status === 400, badUrgency.status);

    const badType = await req('POST', '/api/aid-requests', null, { ...validRequest(), request_type: 'alien-abduction' });
    check('unsupported request_type returns 400', badType.status === 400, badType.status);

    const badEventType = await req('POST', '/api/aid-requests', null, { ...validRequest(), event_id: 'not-a-number' });
    check('non-numeric event_id returns 400', badEventType.status === 400, badEventType.status);

    const unknownEvent = await req('POST', '/api/aid-requests', null, { ...validRequest(), event_id: 9999 });
    check('event_id referencing no event returns 400 (not 500)', unknownEvent.status === 400, unknownEvent.status);

    const onlyLatitude = await req('POST', '/api/aid-requests', null, { ...validRequest(), latitude: 10.0 });
    check('latitude without longitude returns 400', onlyLatitude.status === 400, onlyLatitude.status);

    const badCoordinate = await req('POST', '/api/aid-requests', null, { ...validRequest(), latitude: 999, longitude: 76 });
    check('out-of-range latitude returns 400', badCoordinate.status === 400, badCoordinate.status);

    const valid = await req('POST', '/api/aid-requests', null, { ...validRequest(), event_id: 1, latitude: 10.0, longitude: 76.0 });
    check('valid submission returns 201', valid.status === 201, valid.status);
    check('Audit #36: response carries the created request_id', typeof valid.data?.request_id === 'number', valid.data);
  }

  console.log('\n-- Audit #34: registration shares the same name/phone limits --');
  {
    const overlongName = await req('POST', '/api/auth/register', null, { name: 'A'.repeat(101), phone: '9112233445', password: 'secret123' });
    check('volunteer registration: name over 100 chars returns 400', overlongName.status === 400, overlongName.status);

    const overlongPhone = await req('POST', '/api/auth/register', null, { name: 'Normal Name', phone: '1'.repeat(16), password: 'secret123' });
    check('volunteer registration: phone over 15 chars returns 400', overlongPhone.status === 400, overlongPhone.status);

    const staffOverlong = await req('POST', '/api/auth/register/staff', adminToken, { name: 'Staffer', phone: '1'.repeat(16), password: 'secret123', role: 'ShelterCoordinator' });
    check('staff registration: phone over 15 chars returns 400', staffOverlong.status === 400, staffOverlong.status);

    const validVolunteer = await req('POST', '/api/auth/register', null, { name: 'Normal Name', phone: '9112233445', password: 'secret123' });
    check('valid volunteer registration returns 201', validVolunteer.status === 201, validVolunteer.status);
  }

  console.log('\n-- Audit #39/#40/#41: find_nearest_shelters --');
  {
    const { status, data } = await req('GET', '/api/shelters/nearest?lat=10.0&lon=76.0&people=1');
    check('GET /shelters/nearest returns 200', status === 200, status);
    check('both shelters are returned (full one is not hidden)', Array.isArray(data) && data.length === 2, data);

    const withSpace = data.find((s) => s.shelter_id === 1);
    const full = data.find((s) => s.shelter_id === 2);
    check('shelter with space is flagged has_space=true', withSpace?.has_space === true, withSpace);
    check('full shelter is flagged has_space=false', full?.has_space === false, full);
    check('has_space ordering beats raw distance (closer-but-full sorts after farther-with-space)', data[0].shelter_id === 1 && data[1].shelter_id === 2, data.map((s) => s.shelter_id));
    check('results include lat/lon/address/contact_number for map pins and action links', withSpace?.latitude != null && withSpace?.longitude != null && !!withSpace?.address && !!withSpace?.contact_number, withSpace);

    const bigHousehold = await req('GET', '/api/shelters/nearest?lat=10.0&lon=76.0&people=100');
    check('a household bigger than any shelter still gets results (not empty)', Array.isArray(bigHousehold.data) && bigHousehold.data.length === 2, bigHousehold.data);
    check('nothing has space for a household of 100', bigHousehold.data.every((s) => s.has_space === false), bigHousehold.data);
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
