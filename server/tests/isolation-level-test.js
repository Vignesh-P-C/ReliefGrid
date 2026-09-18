/**
 * ReliefGrid — Isolation Level Demo (Module 6)
 *
 * Runs the SAME concurrent scenario twice — once under READ COMMITTED
 * (Postgres's default) and once under SERIALIZABLE — against the same
 * shelter row, and shows the different outcome. This is meant to be run
 * directly, on its own, without the Express server running:
 *
 *   node tests/isolation-level-test.js
 *
 * Requires DATABASE_URL in server/.env (or a local test DB — see README).
 *
 * Scenario, both runs:
 *   Session A: opens a transaction, reads Shelters.capacity_occupied for
 *              shelter_id = 1, then (after B has fully committed) tries
 *              to update that same row based on the value it read, then commits.
 *   Session B: opens a transaction, updates the same row, commits immediately
 *              — fully interleaved between A's read and A's write.
 *
 * Under READ COMMITTED, A's later statements simply see B's committed
 * change and proceed — no error, but A's UPDATE is based on a value that
 * was already stale by the time it read it.
 *
 * Under SERIALIZABLE, Postgres's SSI (serializable snapshot isolation)
 * detects that A's transaction, if allowed to commit, would not be
 * equivalent to running A and B one-after-another in some order — so it
 * aborts A with a serialization_failure (SQLSTATE 40001) at COMMIT time.
 */

require('dotenv').config();
const { Client } = require('pg');

const SHELTER_ID = process.env.TEST_SHELTER_ID || 1;

function newClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  });
}

async function resetShelter(clientForSetup) {
  await clientForSetup.query('UPDATE Shelters SET capacity_occupied = 0 WHERE shelter_id = $1', [SHELTER_ID]);
}

async function runScenario(isolationLevel) {
  const clientA = newClient();
  const clientB = newClient();
  await clientA.connect();
  await clientB.connect();

  console.log(`\n=== Running under ${isolationLevel} ===`);

  const beginSQL = isolationLevel === 'SERIALIZABLE'
    ? 'BEGIN ISOLATION LEVEL SERIALIZABLE'
    : 'BEGIN ISOLATION LEVEL READ COMMITTED';

  await clientA.query(beginSQL);
  const readResult = await clientA.query(
    'SELECT capacity_occupied FROM Shelters WHERE shelter_id = $1',
    [SHELTER_ID]
  );
  const occBeforeA = readResult.rows[0].capacity_occupied;
  console.log(`Session A: opened transaction, read capacity_occupied = ${occBeforeA} (not yet committed)`);

  // Session B runs fully in between A's read and A's write/commit.
  await clientB.query(beginSQL);
  await clientB.query(
    'UPDATE Shelters SET capacity_occupied = capacity_occupied + 1 WHERE shelter_id = $1',
    [SHELTER_ID]
  );
  await clientB.query('COMMIT');
  console.log('Session B: updated the same row and committed (while A was still open)');

  // Session A now writes based on the value it read earlier, and commits.
  try {
    await clientA.query(
      'UPDATE Shelters SET capacity_occupied = $2 WHERE shelter_id = $1',
      [SHELTER_ID, occBeforeA + 1]
    );
    await clientA.query('COMMIT');
    console.log(`Session A: COMMIT succeeded. Final capacity_occupied is now based on A's stale read.`);
  } catch (err) {
    console.log(`Session A: COMMIT FAILED as expected -> [${err.code}] ${err.message}`);
    await clientA.query('ROLLBACK').catch(() => {});
  }

  const finalResult = await clientB.query('SELECT capacity_occupied FROM Shelters WHERE shelter_id = $1', [SHELTER_ID]);
  console.log(`Final capacity_occupied in DB: ${finalResult.rows[0].capacity_occupied}`);

  await clientA.end();
  await clientB.end();
}

async function main() {
  const setupClient = newClient();
  await setupClient.connect();
  await resetShelter(setupClient);
  await setupClient.end();

  await runScenario('READ COMMITTED');

  const resetClient = newClient();
  await resetClient.connect();
  await resetShelter(resetClient);
  await resetClient.end();

  await runScenario('SERIALIZABLE');

  console.log('\nSummary: under READ COMMITTED, Session A committed without error even though ' +
    "its write was based on a value B had already changed. Under SERIALIZABLE, Postgres " +
    'detected the conflict and rejected Session A\'s commit, forcing the application to retry it.');
}

main().catch((err) => {
  console.error('Isolation-level demo failed:', err);
  process.exit(1);
});
