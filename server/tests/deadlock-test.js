/**
 * ReliefGrid — Engineered Deadlock Demo (Module 6)
 *
 * Deliberately triggers a real Postgres deadlock by having two sessions
 * lock two shelters in opposite order, then shows Postgres's deadlock
 * detector aborting one of them.
 *
 *   node tests/deadlock-test.js
 *
 * Scenario:
 *   Session A: locks shelter_id = 1, pauses, then tries to lock shelter_id = 2
 *   Session B: locks shelter_id = 2, pauses, then tries to lock shelter_id = 1
 *
 * Each session's first lock succeeds. Each session's second lock request
 * then blocks, waiting on the other session's held lock — a circular wait.
 * Postgres's deadlock detector (deadlock_timeout, default 1s) notices this
 * and aborts one transaction with SQLSTATE 40P01 ("deadlock detected"),
 * letting the other proceed.
 *
 * Prevention discussed in the report: always acquire locks in a consistent
 * order (e.g. always lock the lower shelter_id first) — that alone
 * eliminates this whole class of deadlock, since a circular wait becomes
 * impossible if every transaction requests resources in the same order.
 */

require('dotenv').config();
const { Client } = require('pg');

const SHELTER_LOW = process.env.TEST_SHELTER_LOW || 1;
const SHELTER_HIGH = process.env.TEST_SHELTER_HIGH || 2;

function newClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sessionA(client) {
  await client.query('BEGIN');
  await client.query('UPDATE Shelters SET capacity_occupied = capacity_occupied + 1 WHERE shelter_id = $1', [SHELTER_LOW]);
  console.log(`Session A: locked shelter ${SHELTER_LOW}`);

  // Give Session B time to grab its first lock before A asks for the second.
  await sleep(300);

  console.log(`Session A: requesting lock on shelter ${SHELTER_HIGH}...`);
  await client.query('UPDATE Shelters SET capacity_occupied = capacity_occupied + 1 WHERE shelter_id = $1', [SHELTER_HIGH]);
  await client.query('COMMIT');
  console.log('Session A: got both locks and committed successfully');
}

async function sessionB(client) {
  await client.query('BEGIN');
  await client.query('UPDATE Shelters SET capacity_occupied = capacity_occupied + 1 WHERE shelter_id = $1', [SHELTER_HIGH]);
  console.log(`Session B: locked shelter ${SHELTER_HIGH}`);

  await sleep(300);

  console.log(`Session B: requesting lock on shelter ${SHELTER_LOW}...`);
  await client.query('UPDATE Shelters SET capacity_occupied = capacity_occupied + 1 WHERE shelter_id = $1', [SHELTER_LOW]);
  await client.query('COMMIT');
  console.log('Session B: got both locks and committed successfully');
}

async function main() {
  const clientA = newClient();
  const clientB = newClient();
  await clientA.connect();
  await clientB.connect();

  console.log(`Locking shelters ${SHELTER_LOW} and ${SHELTER_HIGH} in opposite order from two sessions...\n`);

  const results = await Promise.allSettled([
    sessionA(clientA).catch((err) => { throw { session: 'A', err }; }),
    sessionB(clientB).catch((err) => { throw { session: 'B', err }; }),
  ]);

  console.log('\n--- Results ---');
  results.forEach((r, i) => {
    const label = i === 0 ? 'Session A' : 'Session B';
    if (r.status === 'fulfilled') {
      console.log(`${label}: completed successfully`);
    } else {
      const reason = r.reason;
      const err = reason?.err || reason;
      console.log(`${label}: FAILED -> [${err.code}] ${err.message}`);
    }
  });

  // Roll back whichever session didn't already commit/abort cleanly.
  await clientA.query('ROLLBACK').catch(() => {});
  await clientB.query('ROLLBACK').catch(() => {});
  await clientA.end();
  await clientB.end();

  console.log('\nOne session should show "deadlock detected" (SQLSTATE 40P01) above — ' +
    "that's Postgres's deadlock detector breaking the circular wait by aborting one transaction. " +
    'The other session should have completed successfully.');
}

main().catch((err) => {
  console.error('Deadlock demo script failed:', err);
  process.exit(1);
});
