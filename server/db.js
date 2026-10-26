const { Pool } = require('pg');
require('dotenv').config();

// Hosted Postgres (Supabase) requires TLS; a local instance used for
// development and migration testing usually does not speak it at all.
const connectionString = process.env.DATABASE_URL;
const isLocalDatabase = !connectionString || /localhost|127\.0\.0\.1/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
});

module.exports = pool;
