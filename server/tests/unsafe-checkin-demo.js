/**
 * ReliefGrid — the "before" half of the concurrency centerpiece (Module 6).
 *
 * `concurrency-test.js` only ever exercises the SAFE `checkin_to_shelter()`
 * function. Nothing in the server, seed, or migrations ever calls an unsafe
 * version, so there was no script that actually reproduces the lost-update
 * bug the talk describes. This script does: it runs the textbook
 * read-then-write race directly in SQL (no `FOR UPDATE`, matching the
 * `checkin_unsafe` sketch in knowledge.md section 7.3), then runs the exact
 * same scenario through the real `checkin_to_shelter()` function so the two
 * outcomes sit side by side.
 *
 * Direct SQL only, no API server needed — same style as
 * isolation-level-test.js and deadlock-test.js. Run only on a disposable
 * database; this script resets and overwrites the target shelter's capacity.
 *
 *   DATABASE_URL=postgresql://... node tests/unsafe-checkin-demo.js
 *
 * Scenario (matches concurrency-test.js exactly, for a fair comparison):
 * 5 "groups" of 2 people each, fired at once, against a shelter with room
 * for 3. At most 1 group should ever fit.
 */

require('dotenv').config();
const { Client } = require('pg');

const SHELTER_ID = process.env.TEST_SHELTER_ID || 6;
const GROUP_SIZE = 2;
const GROUPS = 5;

function newClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resetShelter() {
  const client = newClient();
  await client.connect();
  await client.query(
    'UPDATE Shelters SET capacity_total = 3, capacity_occupied = 0 WHERE shelter_id = $1',
    [SHELTER_ID]
  );
  await client.end();
}

// The textbook lost-update bug: read, decide, then write the literal value
// computed from that (by-then possibly stale) read — no lock held across the
// gap. The sleep between read and write is what reliably opens the race
// window; without it, 5 queries this fast can incidentally serialize anyway
// and hide the bug.
async function unsafeCheckin(label, numPeople) {
  const client = newClient();
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT capacity_occupied, capacity_total FROM Shelters WHERE shelter_id = $1',
      [SHELTER_ID]
    );
    const { capacity_occupied: occ, capacity_total: tot } = rows[0];

    await sleep(200); // widen the window: every group reads before anyone writes

    if (occ + numPeople > tot) {
      console.log(`${label}: read occupied=${occ}/${tot} -> REJECTED (no room by its own stale read)`);
      return { label, accepted: false };
    }

    await client.query('UPDATE Shelters SET capacity_occupied = $2 WHERE shelter_id = $1', [
      SHELTER_ID,
      occ + numPeople,
    ]);
    console.log(`${label}: read occupied=${occ}/${tot} -> ACCEPTED, wrote occupied=${occ + numPeople}`);
    return { label, accepted: true };
  } finally {
    await client.end();
  }
}

async function safeCheckin(label, numPeople) {
  const client = newClient();
  await client.connect();
  try {
    const { rows } = await client.query('SELECT checkin_to_shelter($1, $2) AS outcome', [
      SHELTER_ID,
      numPeople,
    ]);
    console.log(`${label}: checkin_to_shelter() -> ${rows[0].outcome}`);
    return { label, outcome: rows[0].outcome };
  } finally {
    await client.end();
  }
}

async function main() {
  console.log(`=== UNSAFE: ${GROUPS} groups of ${GROUP_SIZE}, shelter ${SHELTER_ID} (capacity 3), no locking ===\n`);
  await resetShelter();

  const unsafeResults = await Promise.all(
    Array.from({ length: GROUPS }, (_, i) => unsafeCheckin(`Group ${String.fromCharCode(65 + i)}`, GROUP_SIZE))
  );
  const acceptedCount = unsafeResults.filter((r) => r.accepted).length;

  const finalUnsafe = await (async () => {
    const client = newClient();
    await client.connect();
    const { rows } = await client.query(
      'SELECT capacity_total, capacity_occupied FROM Shelters WHERE shelter_id = $1',
      [SHELTER_ID]
    );
    await client.end();
    return rows[0];
  })();

  console.log(
    `\n${acceptedCount} of ${GROUPS} groups were told "yes" (${acceptedCount * GROUP_SIZE} people in total), ` +
      `but the database only recorded capacity_occupied = ${finalUnsafe.capacity_occupied} ` +
      `(capacity_total = ${finalUnsafe.capacity_total}).`
  );
  if (acceptedCount * GROUP_SIZE !== finalUnsafe.capacity_occupied) {
    console.log(
      `LOST UPDATE confirmed: ${acceptedCount * GROUP_SIZE} people were promised a bed, ` +
        `only ${finalUnsafe.capacity_occupied} are actually recorded as checked in.`
    );
  } else {
    console.log('No lost update this run (timing-dependent) — rerun, or shorten/lengthen the sleep in unsafeCheckin().');
  }

  console.log(`\n=== SAFE: the same scenario through checkin_to_shelter() ===\n`);
  await resetShelter();

  const safeResults = await Promise.all(
    Array.from({ length: GROUPS }, (_, i) => safeCheckin(`Group ${String.fromCharCode(65 + i)}`, GROUP_SIZE))
  );
  const safeOkCount = safeResults.filter((r) => r.outcome === 'ok').length;

  const finalSafe = await (async () => {
    const client = newClient();
    await client.connect();
    const { rows } = await client.query(
      'SELECT capacity_total, capacity_occupied FROM Shelters WHERE shelter_id = $1',
      [SHELTER_ID]
    );
    await client.end();
    return rows[0];
  })();

  console.log(
    `\n${safeOkCount} of ${GROUPS} groups got in (${safeOkCount * GROUP_SIZE} people), ` +
      `capacity_occupied = ${finalSafe.capacity_occupied} / capacity_total = ${finalSafe.capacity_total}. ` +
      `${safeOkCount * GROUP_SIZE === finalSafe.capacity_occupied ? 'Matches exactly — no lost update.' : 'MISMATCH — investigate.'}`
  );
}

main().catch((err) => {
  console.error('Unsafe check-in demo failed:', err);
  process.exit(1);
});
