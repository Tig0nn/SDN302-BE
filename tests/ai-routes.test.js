const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const db = require('../config/db');
const app = require('../app');

const originalQuery = db.query;
const originalFetch = global.fetch;

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const ledgerId = '33333333-3333-4333-8333-333333333333';
const expenseCategoryId = '44444444-4444-4444-8444-444444444444';
const incomeCategoryId = '55555555-5555-4555-8555-555555555555';

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

function handleCategoryQuery(sql, params) {
  if (sql.includes('from categories c')) {
    assert.equal(params[0], userA);

    if (params[1] === 'expense') {
      return {
        rowCount: 1,
        rows: [
          {
            id: expenseCategoryId,
            userId: null,
            type: 'expense',
            name: 'An uong',
            parentId: null,
            icon: 'utensils',
            color: '#EF4444',
            isSystem: true,
            sortOrder: 1,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    return {
      rowCount: 1,
      rows: [
        {
          id: incomeCategoryId,
          userId: null,
          type: 'income',
          name: 'Thu nhap',
          parentId: null,
          icon: 'wallet',
          color: '#22C55E',
          isSystem: true,
          sortOrder: 1,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    };
  }

  throw new Error(`Unexpected query: ${sql}`);
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
  global.fetch = originalFetch;
});

test('POST /api/v1/ai/transaction-preview parses breakfast expense shorthand', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    return handleCategoryQuery(sql, params);
  });

  const res = await request('/api/v1/ai/transaction-preview', {
    method: 'POST',
    body: {
      text: '\u0102n s\u00e1ng 30',
      currentDate: '2026-06-01',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.preview.type, 'expense');
  assert.equal(res.body.data.preview.amountVnd, 30000);
  assert.equal(res.body.data.preview.categoryId, expenseCategoryId);
  assert.equal(res.body.data.preview.categoryName, 'An uong');
  assert.equal(res.body.data.preview.transactionDate, '2026-06-01');
  assert.deepEqual(res.body.data.missingFields, []);
});

test('POST /api/v1/ai/transaction-preview parses salary income in millions', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    return handleCategoryQuery(sql, params);
  });

  const res = await request('/api/v1/ai/transaction-preview', {
    method: 'POST',
    body: {
      text: 'l\u01b0\u01a1ng v\u1ec1 15 tri\u1ec7u',
      currentDate: '2026-06-01',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.preview.type, 'income');
  assert.equal(res.body.data.preview.amountVnd, 15000000);
  assert.equal(res.body.data.preview.categoryId, incomeCategoryId);
  assert.equal(res.body.data.preview.categoryName, 'Thu nhap');
});

test('POST /api/v1/ai/transaction-preview asks for missing amount', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    return handleCategoryQuery(sql, params);
  });

  const res = await request('/api/v1/ai/transaction-preview', {
    method: 'POST',
    body: {
      text: '\u0102n s\u00e1ng',
      currentDate: '2026-06-01',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.preview.amountVnd, null);
  assert.deepEqual(res.body.data.missingFields, ['amountVnd']);
  assert.match(res.body.data.clarification, /so tien/);
});

test('POST /api/v1/ai/chat requires BYOK Gemini key', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/ai/chat', {
    method: 'POST',
    body: {
      ledgerId,
      message: 'thang nay con bao nhieu',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'GEMINI_KEY_REQUIRED');
});

test('POST /api/v1/ai/chat fetches backend balance before Gemini response', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('totalincomevnd')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], '2026-06-01');
      assert.equal(params[3], '2026-06-30');

      return {
        rowCount: 1,
        rows: [
          {
            totalIncomeVnd: '100000',
            totalExpenseVnd: '30000',
            balanceVnd: '70000',
            transactionCount: 2,
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });
  const fetchCalls = [];

  global.fetch = async function fakeFetch(url, options) {
    fetchCalls.push({ url, options });
    assert.equal(options.headers['x-goog-api-key'], 'test-gemini-key');
    assert.ok(!options.body.includes('test-gemini-key'));

    return {
      ok: true,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [{ text: 'So du hien tai la 70000 VND.' }],
              },
            },
          ],
        };
      },
    };
  };

  const res = await request('/api/v1/ai/chat', {
    method: 'POST',
    headers: {
      'x-gemini-api-key': 'test-gemini-key',
    },
    body: {
      ledgerId,
      message: 'thang nay con bao nhieu',
      currentDate: '2026-06-15',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.message, 'So du hien tai la 70000 VND.');
  assert.equal(res.body.data.toolName, 'getBalance');
  assert.equal(res.body.data.toolResult.summary.balanceVnd, 70000);
  assert.ok(queries.some((query) => query.sql.includes('totalincomevnd')));
  assert.equal(fetchCalls.length, 1);
});
