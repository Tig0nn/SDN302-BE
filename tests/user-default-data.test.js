const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const { systemCategories, paymentAccounts } = require('../db/seed-data/system');

const originalGetPool = db.getPool;

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function countDefaultCategories() {
  return systemCategories.reduce(
    (total, group) =>
      total +
      group.categories.reduce(
        (groupTotal, category) =>
          groupTotal + 1 + category.subcategories.length,
        0
      ),
    0
  );
}

function createFakeClient(options = {}) {
  const queries = [];
  let nextId = 1;
  let released = false;

  return {
    queries,
    get released() {
      return released;
    },
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      queries.push({ sql: normalized, params });

      if (options.failOn && normalized.includes(options.failOn)) {
        throw new Error('forced query failure');
      }

      if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith('select id from ledgers')) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith('select id from categories')) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith('select id from payment_accounts')) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('returning id')) {
        const id = `generated-${nextId}`;

        nextId += 1;
        return { rowCount: 1, rows: [{ id }] };
      }

      return { rowCount: 0, rows: [] };
    },
    release() {
      released = true;
    },
  };
}

function loadUserRepositoryWithClient(client) {
  db.getPool = function getFakePool() {
    return {
      connect: async function connect() {
        return client;
      },
    };
  };

  delete require.cache[require.resolve('../modules/users/userRepository')];
  return require('../modules/users/userRepository');
}

test.afterEach(function cleanup() {
  db.getPool = originalGetPool;
  delete require.cache[require.resolve('../modules/users/userRepository')];
});

test('ensureDefaultUserData creates settings, ledger, categories, and payment accounts', async function () {
  const userId = '11111111-1111-4111-8111-111111111111';
  const client = createFakeClient();
  const userRepository = loadUserRepositoryWithClient(client);

  await userRepository.ensureDefaultUserData(userId);

  assert.equal(client.queries[0].sql, 'begin');
  assert.equal(client.queries.at(-1).sql, 'commit');
  assert.equal(client.released, true);
  assert.ok(client.queries.some((query) => query.sql.includes('insert into user_settings')));
  assert.ok(client.queries.some((query) => query.sql.includes('insert into ledgers')));

  const categoryInserts = client.queries.filter((query) =>
    query.sql.includes('insert into categories')
  );
  const paymentAccountInserts = client.queries.filter((query) =>
    query.sql.includes('insert into payment_accounts')
  );

  assert.equal(categoryInserts.length, countDefaultCategories());
  assert.equal(paymentAccountInserts.length, paymentAccounts.length);
  assert.ok(categoryInserts.every((query) => query.params[0] === userId));
  assert.ok(paymentAccountInserts.every((query) => query.params[0] === userId));
});

test('ensureDefaultUserData rolls back when default data creation fails', async function () {
  const client = createFakeClient({ failOn: 'insert into payment_accounts' });
  const userRepository = loadUserRepositoryWithClient(client);

  await assert.rejects(
    () => userRepository.ensureDefaultUserData('11111111-1111-4111-8111-111111111111'),
    /forced query failure/
  );

  assert.equal(client.queries[0].sql, 'begin');
  assert.equal(client.queries.at(-1).sql, 'rollback');
  assert.equal(client.released, true);
});
