/**
 * ReliefGrid — disposable test database loader.
 *
 * Wipes and reloads database/schema.sql into a disposable local Postgres
 * (never Render/Supabase — see database/datasets/README.md). Used by the
 * other test scripts in this directory before each run.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:test@localhost:5433/reliefgrid_test node tests/setup-test-db.js
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:test@localhost:5433/reliefgrid_test';

// This script runs DROP SCHEMA public CASCADE unconditionally. A mistyped or
// leftover TEST_DATABASE_URL pointing at Supabase/Render would wipe it with no
// further confirmation, so refuse to run against anything but a local database.
function assertLocalDatabase(connectionString) {
  if (!/^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1)[:/]/.test(connectionString)) {
    throw new Error(
      `TEST_DATABASE_URL does not look like a local database: ${connectionString.replace(/:\/\/[^@]*@/, '://<redacted>@')}\n` +
      'Refusing to run DROP SCHEMA against anything that is not localhost/127.0.0.1.'
    );
  }
}

async function main() {
  assertLocalDatabase(TEST_DATABASE_URL);
  const client = new Client({ connectionString: TEST_DATABASE_URL, ssl: false });
  await client.connect();

  console.log('Resetting disposable test database...');
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  const schemaSql = fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8');
  await client.query(schemaSql);
  console.log('schema.sql loaded.');

  await client.end();
}

main().catch((err) => {
  console.error('Test DB setup failed:', err);
  process.exit(1);
});
