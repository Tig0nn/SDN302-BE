const { Pool } = require('pg');
const env = require('./env');

let pool;

function assertDatabaseUrl() {
  try {
    const parsed = new URL(env.DATABASE_URL);

    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      throw new Error('Unsupported protocol');
    }
  } catch (err) {
    const configError = new Error(
      'DATABASE_URL must be a valid PostgreSQL connection string'
    );

    configError.code = 'INVALID_DATABASE_URL';
    configError.status = 500;
    throw configError;
  }
}

function createPool() {
  if (!env.DATABASE_URL) {
    const err = new Error(
      'DATABASE_URL is not set. Add your Supabase connection string to .env'
    );

    err.code = 'DATABASE_URL_MISSING';
    err.status = 500;
    throw err;
  }

  assertDatabaseUrl();

  return new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  });
}

function getPool() {
  if (!pool) {
    pool = createPool();
  }

  return pool;
}

function query() {
  try {
    const currentPool = getPool();

    return currentPool.query.apply(currentPool, arguments);
  } catch (err) {
    return Promise.reject(err);
  }
}

async function closePool() {
  if (!pool) return;

  await pool.end();
  pool = undefined;
}

module.exports = {
  getPool,
  query,
  closePool,
};
