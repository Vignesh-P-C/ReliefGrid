// Turns schema-level failures into an actionable message instead of a generic
// 500. A deployed API running ahead of the database is a deployment problem,
// not a bug in the request — say so.
const MIGRATION_ERROR_CODES = new Set([
  '42703', // undefined_column
  '42P01', // undefined_table
  '42883', // undefined_function
  '42702', // ambiguous_column (a view/function changed shape)
]);

function describeDatabaseError(err) {
  if (err && MIGRATION_ERROR_CODES.has(err.code)) {
    return {
      status: 503,
      message: 'The database is missing a required migration. Apply database/migrations in order, then retry.',
    };
  }
  return null;
}

module.exports = { describeDatabaseError };
