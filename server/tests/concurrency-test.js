/**
 * ReliefGrid — overbooking concurrency test.
 *
 * Fires 5 simultaneous check-in requests against a shelter with room for 3
 * (see seed.sql, shelter_id 1: capacity_total = 3). Proves checkin_to_shelter()
 * never lets capacity_occupied exceed capacity_total, even under concurrent load.
 *
 * Usage:
 *   1. Make sure the server is running (npm run dev) and seed.sql has been run.
 *   2. Log in as any user, copy the JWT, set it as TEST_TOKEN below or via env var.
 *   3. node tests/concurrency-test.js
 */

require('dotenv').config();

const API_URL = process.env.API_URL || 'http://localhost:5000';
const TEST_TOKEN = process.env.TEST_TOKEN || 'PASTE_A_VALID_JWT_HERE';
const SHELTER_ID = process.env.TEST_SHELTER_ID || 1;

async function attemptCheckin(numPeople, label) {
  const res = await fetch(`${API_URL}/api/shelters/${SHELTER_ID}/checkin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_TOKEN}`,
    },
    body: JSON.stringify({ num_people: numPeople }),
  });
  const body = await res.json();
  console.log(`${label} -> status ${res.status}:`, body);
  return { label, status: res.status, body };
}

async function main() {
  console.log(`Firing 5 concurrent check-ins (2 people each) against shelter ${SHELTER_ID}...\n`);

  const results = await Promise.all([
    attemptCheckin(2, 'Group A'),
    attemptCheckin(2, 'Group B'),
    attemptCheckin(2, 'Group C'),
    attemptCheckin(2, 'Group D'),
    attemptCheckin(2, 'Group E'),
  ]);

  const successCount = results.filter(r => r.status === 200).length;
  const rejectedCount = results.filter(r => r.status === 409).length;

  console.log(`\nSummary: ${successCount} succeeded, ${rejectedCount} rejected.`);
  console.log('Now confirm in SQL that capacity_occupied never exceeded capacity_total:');
  console.log(`  SELECT capacity_total, capacity_occupied FROM Shelters WHERE shelter_id = ${SHELTER_ID};`);
}

main().catch(err => {
  console.error('Test script failed:', err);
  process.exit(1);
});
