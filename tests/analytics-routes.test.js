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

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: options.method || 'GET',
          headers: {
            authorization: `Bearer ${authToken()}`,
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

test('GET /api/v1/analytics/overview returns SQL aggregate cards', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from transactions') && sql.includes('totalincomevnd')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], '2026-06-01');
      assert.equal(params[3], '2026-06-30');

      return {
        rowCount: 1,
        rows: [
          {
            totalIncomeVnd: '15000000',
            totalExpenseVnd: '30000',
            balanceVnd: '14970000',
            transactionCount: 2,
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(
    `/api/v1/analytics/overview?ledgerId=${ledgerId}&dateFrom=2026-06-01&dateTo=2026-06-30&userId=${userB}`
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.overview, {
    totalIncomeVnd: 15000000,
    totalExpenseVnd: 30000,
    balanceVnd: 14970000,
    transactionCount: 2,
  });
  assert.ok(queries.every((query) => !query.params.includes(userB)));
});

test('GET /api/v1/analytics/category-breakdown returns chart percentages', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('with grouped as')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'expense');
      assert.equal(params[5], 5);

      return {
        rowCount: 1,
        rows: [
          {
            categoryId,
            categoryName: 'Food',
            totalAmountVnd: '30000',
            transactionCount: 1,
            percentage: '100.00',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(
    `/api/v1/analytics/category-breakdown?ledgerId=${ledgerId}&type=expense&limit=5`
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.categories[0].totalAmountVnd, 30000);
  assert.equal(res.body.data.categories[0].percentage, 100);
});

test('GET /api/v1/analytics/daily-spending returns expense bars', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('group by transaction_date')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return {
        rowCount: 1,
        rows: [
          {
            date: '2026-06-01',
            totalExpenseVnd: '30000',
            transactionCount: 1,
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/analytics/daily-spending?ledgerId=${ledgerId}`);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.days[0].date, '2026-06-01');
  assert.equal(res.body.data.days[0].totalExpenseVnd, 30000);
});

test('GET /api/v1/analytics/monthly-trend returns income versus expense rows', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes("date_trunc('month'")) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return {
        rowCount: 1,
        rows: [
          {
            month: '2026-06-01',
            totalIncomeVnd: '15000000',
            totalExpenseVnd: '30000',
            balanceVnd: '14970000',
            transactionCount: 2,
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/analytics/monthly-trend?ledgerId=${ledgerId}`);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.months[0].month, '2026-06-01');
  assert.equal(res.body.data.months[0].balanceVnd, 14970000);
});

test('GET /api/v1/analytics/fluctuation returns day-over-day changes', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('with daily as')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return {
        rowCount: 2,
        rows: [
          {
            date: '2026-06-01',
            totalExpenseVnd: '30000',
            previousExpenseVnd: null,
            changeVnd: null,
            changePercent: null,
          },
          {
            date: '2026-06-02',
            totalExpenseVnd: '45000',
            previousExpenseVnd: '30000',
            changeVnd: '15000',
            changePercent: '50.00',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/analytics/fluctuation?ledgerId=${ledgerId}`);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.points[0].changeVnd, null);
  assert.equal(res.body.data.points[1].changeVnd, 15000);
  assert.equal(res.body.data.points[1].changePercent, 50);
});
