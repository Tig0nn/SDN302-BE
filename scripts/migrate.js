const fs = require('fs');
const path = require('path');
const db = require('../config/db');

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      id text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

function getMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

async function runMigration(client, file) {
  const migrationId = file.replace(/\.sql$/, '');
  const migrationName = file;
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

  const existing = await client.query(
    'select id from schema_migrations where id = $1',
    [migrationId]
  );

  if (existing.rowCount > 0) {
    console.log(`skip ${migrationName}`);
    return;
  }

  await client.query('begin');

  try {
    await client.query(sql);
    await client.query(
      'insert into schema_migrations (id, name) values ($1, $2)',
      [migrationId, migrationName]
    );
    await client.query('commit');
    console.log(`applied ${migrationName}`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}

async function main() {
  const files = getMigrationFiles();

  if (files.length === 0) {
    console.log('No database migrations found.');
    return;
  }

  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);

    for (const file of files) {
      await runMigration(client, file);
    }
  } finally {
    client.release();
    await db.closePool();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
