const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const db = require('../config/db');
const app = require('../app');

const originalQuery = db.query;
const originalGetPool = db.getPool;

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const ledgerId = '33333333-3333-4333-8333-333333333333';
const categoryId = '44444444-4444-4444-8444-444444444444';
const subcategoryId = '55555555-5555-4555-8555-555555555555';

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function authToken() {
  return jwt.sign(
    {
      sub: userA,
      email: 'user-a@example.com',
    },
    process.env.JWT_SECRET,
    {
      expiresIn: 60,
      issuer: 'vi-vi-vu-api',
      audience: 'vi-vi-vu-mobile',
    }
  );
}

function userRow() {
  return {
    id: userA,
    googleSub: 'google-user-a',
    email: 'user-a@example.com',
    displayName: 'User A',
    avatarUrl: null,
    emailVerifiedAt: '2026-06-01T00:00:00.000Z',
    locale: 'vi-VN',
    timezone: 'Asia/Ho_Chi_Minh',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function request(path, options = {}) {
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', function onListen() {
      const address = server.address();
      const body = options.body ? JSON.stringify(options.body) : null;

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: options.method || 'GET',
          headers: {
            authorization: `Bearer ${authToken()}`,
            ...(body
              ? {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(body),
                }
              : {}),
            ...(options.headers || {}),
          },
        },
        function onResponse(res) {
          let raw = '';

          res.setEncoding('utf8');
          res.on('data', function onData(chunk) {
            raw += chunk;
          });
          res.on('end', function onEnd() {
            server.close(function onClose() {
              resolve({
                statusCode: res.statusCode,
                body:
                  raw && res.headers['content-type']?.includes('application/json')
                    ? JSON.parse(raw)
                    : raw,
              });
            });
          });
        }
      );

      req.on('error', function onError(err) {
        server.close(function onClose() {
          reject(err);
        });
      });

      if (body) {
        req.write(body);
      }

      req.end();
    });
  });
}

function installQueryHandler(handler) {
  const queries = [];

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    queries.push({ sql: normalized, params });

    if (normalized.includes('from users')) {
      assert.equal(params[0], userA);
      return { rowCount: 1, rows: [userRow()] };
    }

    return handler(normalized, params);
  };

  return queries;
}

function installClientHandler(handler) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      queries.push({ sql: normalized, params });

      if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
        return { rowCount: 0, rows: [] };
      }

      return handler(normalized, params);
    },
    release() {},
  };

  db.getPool = function getFakePool() {
    return {
      connect: async function connect() {
        return client;
      },
    };
  };

  return queries;
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
  db.getPool = originalGetPool;
});

test('GET /api/v1/ledgers lists only authenticated user ledgers', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);

      return {
        rowCount: 1,
        rows: [
          {
            id: ledgerId,
            name: 'Main ledger',
            isDefault: true,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/ledgers?userId=${userB}`);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.ledgers[0].id, ledgerId);
  assert.ok(queries.every((query) => !query.params.includes(userB)));
});

test('DELETE /api/v1/ledgers/:id rejects deleting the last ledger', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected query: ${sql}`);
  });

  const clientQueries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      clientQueries.push({ sql: normalized, params });

      if (normalized === 'begin' || normalized === 'rollback') {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('select id, is_default')) {
        assert.equal(params[0], userA);
        assert.equal(params[1], ledgerId);

        return { rowCount: 1, rows: [{ id: ledgerId, isDefault: true }] };
      }

      if (normalized.includes('select count(*)::int as count')) {
        assert.equal(params[0], userA);

        return { rowCount: 1, rows: [{ count: 1 }] };
      }

      throw new Error(`Unexpected client query: ${normalized}`);
    },
    release() {},
  };

  db.getPool = function getFakePool() {
    return {
      connect: async function connect() {
        return client;
      },
    };
  };

  const res = await request(`/api/v1/ledgers/${ledgerId}`, { method: 'DELETE' });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'LAST_LEDGER_DELETE_NOT_ALLOWED');
  assert.equal(clientQueries.at(-1).sql, 'rollback');
});

test('POST /api/v1/ledgers creates a non-default ledger when one already exists', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('insert into ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], 'Travel');

      return {
        rowCount: 1,
        rows: [
          {
            id: ledgerId,
            name: 'Travel',
            isDefault: false,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/ledgers', {
    method: 'POST',
    body: { name: 'Travel' },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.ledger.name, 'Travel');
  assert.equal(res.body.data.ledger.isDefault, false);
});

test('PATCH /api/v1/ledgers/:id renames an owned ledger', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update ledgers') && sql.includes('set name = $3')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'Renamed');

      return {
        rowCount: 1,
        rows: [
          {
            id: ledgerId,
            name: 'Renamed',
            isDefault: true,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/ledgers/${ledgerId}`, {
    method: 'PATCH',
    body: { name: 'Renamed' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.ledger.name, 'Renamed');
});

test('DELETE /api/v1/ledgers/:id soft deletes and reassigns default ledger', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('select id, is_default')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId, isDefault: true }] };
    }

    if (sql.includes('select count(*)::int as count')) {
      assert.equal(params[0], userA);

      return { rowCount: 1, rows: [{ count: 2 }] };
    }

    if (sql.includes('update ledgers') && sql.includes('set deleted_at = now()')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return {
        rowCount: 1,
        rows: [
          {
            id: ledgerId,
            name: 'Main ledger',
            isDefault: false,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      };
    }

    if (sql.includes('set is_default = true')) {
      assert.equal(params[0], userA);

      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(`/api/v1/ledgers/${ledgerId}`, { method: 'DELETE' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.ledger.isDefault, false);
  assert.ok(clientQueries.some((query) => query.sql === 'commit'));
  assert.ok(clientQueries.some((query) => query.sql.includes('set is_default = true')));
});

test('GET /api/v1/categories returns a grouped two-level tree', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from categories c')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], 'expense');

      return {
        rowCount: 2,
        rows: [
          {
            id: categoryId,
            userId: userA,
            type: 'expense',
            name: 'Food',
            parentId: null,
            icon: 'utensils',
            color: '#EF4444',
            isSystem: true,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
          {
            id: subcategoryId,
            userId: userA,
            type: 'expense',
            name: 'Cafe',
            parentId: categoryId,
            icon: 'coffee',
            color: '#EF4444',
            isSystem: true,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/categories?type=expense');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.categories.length, 2);
  assert.equal(res.body.data.tree[0].id, categoryId);
  assert.equal(res.body.data.tree[0].subcategories[0].id, subcategoryId);
});

test('PATCH /api/v1/categories/:id rejects system category updates', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from categories') && sql.includes('limit 1')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], categoryId);

      return {
        rowCount: 1,
        rows: [
          {
            id: categoryId,
            userId: userA,
            type: 'expense',
            name: 'Food',
            parentId: null,
            icon: 'utensils',
            color: '#EF4444',
            isSystem: true,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/categories/${categoryId}`, {
    method: 'PATCH',
    body: { name: 'Updated' },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'SYSTEM_CATEGORY_READ_ONLY');
});

test('POST /api/v1/categories creates a custom root category', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('select id from categories')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], 'expense');
      assert.equal(params[2], 'Travel');
      assert.equal(params[3], null);
      assert.equal(params[4], null);

      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('insert into categories')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], 'expense');
      assert.equal(params[2], 'Travel');
      assert.equal(params[3], null);
      assert.equal(params[4], 'plane');
      assert.equal(params[5], '#0EA5E9');

      return {
        rowCount: 1,
        rows: [
          {
            id: categoryId,
            userId: userA,
            type: 'expense',
            name: 'Travel',
            parentId: null,
            icon: 'plane',
            color: '#0EA5E9',
            isSystem: false,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/categories', {
    method: 'POST',
    body: {
      type: 'expense',
      name: 'Travel',
      icon: 'plane',
      color: '#0EA5E9',
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.category.name, 'Travel');
  assert.equal(res.body.data.category.isSystem, false);
});

test('POST /api/v1/categories creates a custom subcategory under a matching parent', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('select id from categories')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], 'expense');
      assert.equal(params[2], 'Flights');
      assert.equal(params[3], categoryId);

      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('from categories') && sql.includes('limit 1')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], categoryId);

      return {
        rowCount: 1,
        rows: [
          {
            id: categoryId,
            userId: userA,
            type: 'expense',
            name: 'Travel',
            parentId: null,
            icon: 'plane',
            color: '#0EA5E9',
            isSystem: false,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    if (sql.includes('insert into categories')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], 'expense');
      assert.equal(params[2], 'Flights');
      assert.equal(params[3], categoryId);

      return {
        rowCount: 1,
        rows: [
          {
            id: subcategoryId,
            userId: userA,
            type: 'expense',
            name: 'Flights',
            parentId: categoryId,
            icon: null,
            color: null,
            isSystem: false,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/categories', {
    method: 'POST',
    body: {
      type: 'expense',
      name: 'Flights',
      parentId: categoryId,
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.category.parentId, categoryId);
});

test('PATCH /api/v1/categories/:id updates a custom category', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('select id from categories')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], 'expense');
      assert.equal(params[2], 'Trip');
      assert.equal(params[3], null);
      assert.equal(params[4], categoryId);

      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('from categories') && sql.includes('limit 1')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], categoryId);

      return {
        rowCount: 1,
        rows: [
          {
            id: categoryId,
            userId: userA,
            type: 'expense',
            name: 'Travel',
            parentId: null,
            icon: 'plane',
            color: '#0EA5E9',
            isSystem: false,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    if (sql.includes('update categories') && sql.includes('set name = coalesce')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], categoryId);
      assert.equal(params[2], 'Trip');
      assert.equal(params[3], true);
      assert.equal(params[4], null);
      assert.equal(params[5], true);
      assert.equal(params[6], '#22C55E');

      return {
        rowCount: 1,
        rows: [
          {
            id: categoryId,
            userId: userA,
            type: 'expense',
            name: 'Trip',
            parentId: null,
            icon: null,
            color: '#22C55E',
            isSystem: false,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/categories/${categoryId}`, {
    method: 'PATCH',
    body: {
      name: 'Trip',
      icon: null,
      color: '#22C55E',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.category.name, 'Trip');
  assert.equal(res.body.data.category.icon, null);
});

test('DELETE /api/v1/categories/:id soft deletes a custom category and children', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from categories') && sql.includes('for update')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], categoryId);

      return {
        rowCount: 1,
        rows: [
          {
            id: categoryId,
            userId: userA,
            type: 'expense',
            name: 'Travel',
            parentId: null,
            icon: 'plane',
            color: '#0EA5E9',
            isSystem: false,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    if (sql.includes('update categories') && sql.includes('set deleted_at = now()')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], categoryId);

      return {
        rowCount: 2,
        rows: [
          {
            id: categoryId,
            userId: userA,
            type: 'expense',
            name: 'Travel',
            parentId: null,
            icon: 'plane',
            color: '#0EA5E9',
            isSystem: false,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
          {
            id: subcategoryId,
            userId: userA,
            type: 'expense',
            name: 'Flights',
            parentId: categoryId,
            icon: null,
            color: null,
            isSystem: false,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(`/api/v1/categories/${categoryId}`, {
    method: 'DELETE',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.deletedCategories.length, 2);
  assert.ok(clientQueries.some((query) => query.sql === 'commit'));
});

test('GET /api/v1/payment-accounts lists accounts through authenticated user scope', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from payment_accounts p')) {
      assert.equal(params[0], userA);

      return {
        rowCount: 1,
        rows: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            userId: userA,
            name: 'Cash',
            shortName: 'Cash',
            type: 'cash',
            color: '#64748B',
            isSystem: true,
            sortOrder: 0,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/payment-accounts?userId=${userB}`);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.paymentAccounts[0].type, 'cash');
});
