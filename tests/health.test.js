const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const db = require('../config/db');
const app = require('../app');

const originalQuery = db.query;

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
});

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
                headers: res.headers,
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

test('GET /health returns standard success payload', async function () {
  const res = await request('/health');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.ok, true);
  assert.equal(res.body.data.service, 'vi-vi-vu-api');
  assert.equal(res.body.error, null);
  assert.ok(res.body.meta.requestId);
  assert.equal(res.headers['x-request-id'], res.body.meta.requestId);
});

test('GET / returns service metadata as JSON', async function () {
  const res = await request('/');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.ok, true);
  assert.equal(res.body.data.service, 'vi-vi-vu-api');
  assert.equal(res.body.data.health, '/health');
  assert.equal(res.body.error, null);
});

test('unknown routes return standard error payload', async function () {
  const res = await request('/missing-route');

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.equal(res.body.error.message, 'Route not found');
  assert.ok(res.body.meta.requestId);
});

test('GET /api/v1/me requires an access token', async function () {
  const res = await request('/api/v1/me');

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.code, 'AUTH_REQUIRED');
});

test('GET /api/v1/me reads only the authenticated token subject', async function () {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  const token = jwt.sign(
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
  const queries = [];

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    queries.push({ sql: normalized, params });

    if (normalized.includes('from users')) {
      assert.equal(params[0], userA);

      return {
        rowCount: 1,
        rows: [
          {
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
          },
        ],
      };
    }

    if (normalized.includes('from user_settings')) {
      assert.equal(params[0], userA);

      return {
        rowCount: 1,
        rows: [
          {
            theme: 'system',
            dailyReminderEnabled: false,
            budgetWarningEnabled: true,
            debtReminderEnabled: true,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    if (normalized.includes('from ledgers')) {
      assert.equal(params[0], userA);

      return {
        rowCount: 1,
        rows: [{ id: 'ledger-a', name: 'Sổ Chính', isDefault: true }],
      };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };

  const res = await request(`/api/v1/me?userId=${userB}`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.user.id, userA);
  assert.ok(queries.every((query) => !query.params.includes(userB)));
});

test('POST /api/v1/auth/google validates idToken', async function () {
  const res = await request('/api/v1/auth/google', {
    method: 'POST',
    body: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/email/register validates required fields', async function () {
  const res = await request('/api/v1/auth/email/register', {
    method: 'POST',
    body: {
      email: 'not-an-email',
      password: 'short',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/email/verify validates OTP shape', async function () {
  const res = await request('/api/v1/auth/email/verify', {
    method: 'POST',
    body: {
      email: 'user@example.com',
      otpCode: 'abc',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('GET /openapi.json exposes documented routes', async function () {
  const res = await request('/openapi.json');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.openapi, '3.0.3');
  assert.equal(res.body.info.title, 'Ví Vi Vu API');
  assert.ok(res.body.paths['/api/v1/auth/email/register']);
  assert.ok(res.body.paths['/api/v1/auth/email/verify']);
  assert.ok(res.body.paths['/api/v1/auth/email/login']);
  assert.ok(res.body.paths['/api/v1/auth/google']);
  assert.ok(res.body.paths['/api/v1/me']);
  assert.ok(res.body.paths['/api/v1/ledgers']);
  assert.ok(res.body.paths['/api/v1/categories']);
  assert.ok(res.body.paths['/api/v1/payment-accounts']);
  assert.ok(res.body.paths['/api/v1/transactions']);
  assert.ok(res.body.paths['/api/v1/transactions/summary']);
  assert.ok(res.body.paths['/api/v1/transactions/calendar']);
  assert.ok(res.body.paths['/api/v1/analytics/overview']);
  assert.ok(res.body.paths['/api/v1/analytics/category-breakdown']);
  assert.ok(res.body.paths['/api/v1/analytics/daily-spending']);
  assert.ok(res.body.paths['/api/v1/analytics/monthly-trend']);
  assert.ok(res.body.paths['/api/v1/analytics/fluctuation']);
  assert.ok(res.body.paths['/api/v1/budgets']);
  assert.ok(res.body.paths['/api/v1/goals']);
  assert.ok(res.body.paths['/api/v1/debts']);
  assert.ok(res.body.paths['/api/v1/challenges']);
  assert.ok(res.body.paths['/api/v1/shopping-plans']);
  assert.ok(res.body.paths['/api/v1/shopping-items/{id}']);
  assert.ok(res.body.paths['/api/v1/ai/transaction-preview']);
  assert.ok(res.body.paths['/api/v1/ai/chat']);
  assert.ok(res.body.paths['/api/v1/ai/receipt-scan']);
});

test('GET /docs serves interactive API documentation shell', async function () {
  const res = await request('/docs');

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Ví Vi Vu API Docs/);
  assert.match(res.body, /\/openapi\.json/);
});
