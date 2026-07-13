const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const db = require('../config/db');
const app = require('../app');

const originalQuery = db.query;

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const ledgerId = '33333333-3333-4333-8333-333333333333';
const categoryId = '44444444-4444-4444-8444-444444444444';
const budgetId = '88888888-8888-4888-8888-888888888888';

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

function budgetRow(overrides = {}) {
  return {
    id: budgetId,
    userId: userA,
    ledgerId,
    categoryId,
    categoryName: 'Food',
    month: '2026-06-01',
    limitAmountVnd: '100000',
    warningThreshold: 80,
    spentAmountVnd: '120000',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
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

    if (normalized.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    return handler(normalized, params);
  };

  return queries;
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
});

test('GET /api/v1/budgets lists budget progress and exceeded status', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from budgets b') && sql.includes('left join lateral')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], '2026-06-01');

      return { rowCount: 1, rows: [budgetRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(
    `/api/v1/budgets?ledgerId=${ledgerId}&month=2026-06&userId=${userB}`
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.budgets[0].spentAmountVnd, 120000);
  assert.equal(res.body.data.budgets[0].progressPercent, 120);
  assert.equal(res.body.data.budgets[0].status, 'exceeded');
  assert.ok(queries.every((query) => !query.params.includes(userB)));
});

test('GET /api/v1/budgets/:id returns a single budget with progress', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from budgets b') && sql.includes('left join lateral')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], budgetId);

      return { rowCount: 1, rows: [budgetRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/budgets/${budgetId}?userId=${userB}`);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.budget.id, budgetId);
  assert.equal(res.body.data.budget.spentAmountVnd, 120000);
  assert.equal(res.body.data.budget.status, 'exceeded');
  assert.ok(queries.every((query) => !query.params.includes(userB)));
});

test('GET /api/v1/budgets/:id returns 404 for a budget outside the authenticated user scope', async function () {
  installQueryHandler(async function handleQuery(sql) {
    if (sql.includes('from budgets b') && sql.includes('left join lateral')) {
      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/budgets/${budgetId}`);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'BUDGET_NOT_FOUND');
});

test('POST /api/v1/budgets creates a budget and evaluates current alerts', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from categories')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], categoryId);

      return { rowCount: 1, rows: [{ id: categoryId, type: 'expense' }] };
    }

    if (sql.includes('from budgets') && sql.includes('category_id is not distinct')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('insert into budgets')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], categoryId);
      assert.equal(params[3], '2026-06-01');
      assert.equal(params[4], 100000);
      assert.equal(params[5], 80);

      return { rowCount: 1, rows: [{ id: budgetId }] };
    }

    if (sql.includes('insert into notification_events')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], budgetId);

      return { rowCount: 1, rows: [] };
    }

    if (sql.includes('from budgets b') && sql.includes('left join lateral')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], budgetId);

      return { rowCount: 1, rows: [budgetRow({ spentAmountVnd: '90000' })] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/budgets', {
    method: 'POST',
    body: {
      ledgerId,
      categoryId,
      month: '2026-06',
      limitAmountVnd: 100000,
      warningThreshold: 80,
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.budget.status, 'warning');
  assert.ok(queries.some((query) => query.sql.includes('insert into notification_events')));
});

test('POST /api/v1/budgets rejects duplicate budget in same ledger category month', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from categories')) {
      return { rowCount: 1, rows: [{ id: params[1], type: 'expense' }] };
    }

    if (sql.includes('from budgets') && sql.includes('category_id is not distinct')) {
      return { rowCount: 1, rows: [{ id: budgetId }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/budgets', {
    method: 'POST',
    body: {
      ledgerId,
      categoryId,
      month: '2026-06',
      limitAmountVnd: 100000,
    },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'BUDGET_ALREADY_EXISTS');
});

test('DELETE /api/v1/budgets/:id soft deletes through authenticated user scope', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update budgets') && sql.includes('set deleted_at = now()')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], budgetId);

      return { rowCount: 1, rows: [{ id: budgetId }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/budgets/${budgetId}`, {
    method: 'DELETE',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.budget.id, budgetId);
});
