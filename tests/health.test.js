const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const db = require('../config/db');
const env = require('../config/env');
const app = require('../app');
const auditRepository = require('../modules/security/auditRepository');
const authService = require('../modules/auth/authService');
const metrics = require('../modules/observability/metrics');
const rateLimit = require('../middlewares/rateLimit');

const originalQuery = db.query;
const originalRateLimitMax = env.RATE_LIMIT_MAX;
const originalRateLimitWindowMs = env.RATE_LIMIT_WINDOW_MS;
const originalChangePassword = authService.changePassword;

function meUserRow(userId, overrides = {}) {
  return {
    id: userId,
    googleSub: null,
    email: 'user-a@example.com',
    displayName: 'User A',
    avatarUrl: null,
    emailVerifiedAt: '2026-06-01T00:00:00.000Z',
    locale: 'vi-VN',
    timezone: 'Asia/Ho_Chi_Minh',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function meAuthToken(userId) {
  return jwt.sign(
    { sub: userId, email: 'user-a@example.com' },
    process.env.JWT_SECRET,
    { expiresIn: 60, issuer: 'vi-vi-vu-api', audience: 'vi-vi-vu-mobile' }
  );
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

test.afterEach(async function cleanup() {
  db.query = originalQuery;
  env.RATE_LIMIT_MAX = originalRateLimitMax;
  env.RATE_LIMIT_WINDOW_MS = originalRateLimitWindowMs;
  authService.changePassword = originalChangePassword;
  await metrics.resetMetrics();
  await rateLimit.resetRateLimit();
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

test('GET /health/db returns database server time', async function () {
  db.query = async function fakeQuery(sql) {
    assert.equal(normalizeSql(sql), 'select now() as server_time');

    return {
      rowCount: 1,
      rows: [{ server_time: '2026-06-01T00:00:00.000Z' }],
    };
  };

  const res = await request('/health/db');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.ok, true);
  assert.equal(res.body.data.server_time, '2026-06-01T00:00:00.000Z');
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

test('PATCH /api/v1/me updates profile and settings before returning fresh payload', async function () {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  const ledgerId = '33333333-3333-4333-8333-333333333333';
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
  let userLookupCount = 0;

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    if (normalized.includes('from users')) {
      assert.equal(params[0], userA);
      userLookupCount += 1;

      return {
        rowCount: 1,
        rows: [
          {
            id: userA,
            googleSub: 'google-user-a',
            email: 'user-a@example.com',
            displayName: userLookupCount === 1 ? 'User A' : 'Updated User',
            avatarUrl: null,
            emailVerifiedAt: '2026-06-01T00:00:00.000Z',
            locale: 'en-US',
            timezone: 'UTC',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      };
    }

    if (normalized.includes('update users')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], true);
      assert.equal(params[2], 'Updated User');
      assert.equal(params[3], false);
      assert.equal(params[4], null);
      assert.equal(params[5], true);
      assert.equal(params[6], 'en-US');
      assert.equal(params[7], true);
      assert.equal(params[8], 'UTC');

      return {
        rowCount: 1,
        rows: [],
      };
    }

    if (normalized.includes('update user_settings')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], 'dark');
      assert.equal(params[2], false);
      assert.equal(params[3], true);
      assert.equal(params[4], false);

      return {
        rowCount: 1,
        rows: [],
      };
    }

    if (normalized.includes('from user_settings')) {
      assert.equal(params[0], userA);

      return {
        rowCount: 1,
        rows: [
          {
            theme: 'dark',
            dailyReminderEnabled: false,
            budgetWarningEnabled: true,
            debtReminderEnabled: false,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      };
    }

    if (normalized.includes('from ledgers')) {
      assert.equal(params[0], userA);

      return {
        rowCount: 1,
        rows: [{ id: ledgerId, name: 'Main ledger', isDefault: true }],
      };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };

  const res = await request(`/api/v1/me?userId=${userB}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: {
      displayName: 'Updated User',
      locale: 'en-US',
      timezone: 'UTC',
      settings: {
        theme: 'dark',
        dailyReminderEnabled: false,
        budgetWarningEnabled: true,
        debtReminderEnabled: false,
      },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.user.displayName, 'Updated User');
  assert.equal(res.body.data.settings.theme, 'dark');
  assert.equal(res.body.data.defaultLedger.id, ledgerId);
});

test('POST /api/v1/me/change-password delegates to authService and records an audit event', async function () {
  const userA = '11111111-1111-4111-8111-111111111111';
  const token = meAuthToken(userA);
  const auditEvents = [];

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    if (normalized.includes('from users')) {
      assert.equal(params[0], userA);
      return { rowCount: 1, rows: [meUserRow(userA)] };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };
  auditRepository.recordAuditEvent = async function recordAuditEvent(req, eventType, metadata, userId) {
    auditEvents.push({ eventType, metadata, userId });
  };
  authService.changePassword = async function changePassword(currentUser, payload) {
    assert.equal(currentUser.id, userA);
    assert.deepEqual(payload, {
      currentPassword: 'old-password',
      newPassword: 'brand-new-password',
    });
  };

  const res = await request('/api/v1/me/change-password', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: { currentPassword: 'old-password', newPassword: 'brand-new-password' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { ok: true });
  assert.equal(auditEvents[0].eventType, 'auth.password_changed');
  assert.equal(auditEvents[0].userId, userA);
});

test('POST /api/v1/me/change-password rejects a too-short new password before calling the service', async function () {
  const userA = '11111111-1111-4111-8111-111111111111';
  const token = meAuthToken(userA);
  let called = false;

  db.query = async function fakeQuery(sql, params = []) {
    if (normalizeSql(sql).includes('from users')) {
      assert.equal(params[0], userA);
      return { rowCount: 1, rows: [meUserRow(userA)] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };
  authService.changePassword = async function changePassword() {
    called = true;
  };

  const res = await request('/api/v1/me/change-password', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: { currentPassword: 'old-password', newPassword: 'short' },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.equal(called, false);
});

test('GET /api/v1/me/sessions lists only the authenticated user\'s active sessions', async function () {
  const userA = '11111111-1111-4111-8111-111111111111';
  const token = meAuthToken(userA);
  const sessionId = '33333333-3333-4333-8333-333333333333';

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    if (normalized.includes('from users')) {
      assert.equal(params[0], userA);
      return { rowCount: 1, rows: [meUserRow(userA)] };
    }

    if (normalized.includes('from sessions')) {
      assert.equal(params[0], userA);
      return {
        rowCount: 1,
        rows: [{ id: sessionId, createdAt: '2026-06-01T00:00:00.000Z', expiresAt: '2026-07-01T00:00:00.000Z' }],
      };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };

  const res = await request('/api/v1/me/sessions', {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.sessions.length, 1);
  assert.equal(res.body.data.sessions[0].id, sessionId);
});

test('DELETE /api/v1/me/sessions/:id revokes the session and records an audit event', async function () {
  const userA = '11111111-1111-4111-8111-111111111111';
  const token = meAuthToken(userA);
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const auditEvents = [];

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    if (normalized.includes('from users')) {
      assert.equal(params[0], userA);
      return { rowCount: 1, rows: [meUserRow(userA)] };
    }

    if (normalized.includes('update sessions') && normalized.includes('where id = $2')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], sessionId);
      return { rowCount: 1, rows: [{ id: sessionId }] };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };
  auditRepository.recordAuditEvent = async function recordAuditEvent(req, eventType, metadata, userId) {
    auditEvents.push({ eventType, userId });
  };

  const res = await request(`/api/v1/me/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { ok: true });
  assert.equal(auditEvents[0].eventType, 'auth.session_revoked');
});

test('POST /api/v1/me/sessions/revoke-all revokes every session and records an audit event', async function () {
  const userA = '11111111-1111-4111-8111-111111111111';
  const token = meAuthToken(userA);
  const auditEvents = [];

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    if (normalized.includes('from users')) {
      assert.equal(params[0], userA);
      return { rowCount: 1, rows: [meUserRow(userA)] };
    }

    if (normalized.includes('update sessions') && normalized.includes('where user_id = $1')) {
      assert.equal(params[0], userA);
      return { rowCount: 2, rows: [] };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };
  auditRepository.recordAuditEvent = async function recordAuditEvent(req, eventType, metadata, userId) {
    auditEvents.push({ eventType, userId });
  };

  const res = await request('/api/v1/me/sessions/revoke-all', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { ok: true });
  assert.equal(auditEvents[0].eventType, 'auth.sessions_revoked_all');
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
  assert.ok(res.body.paths['/metrics']);
  assert.ok(res.body.paths['/api/v1/metrics']);
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
  assert.ok(res.body.paths['/api/v1/imports/preview']);
  assert.ok(res.body.paths['/api/v1/imports/{id}/commit']);
  assert.ok(res.body.paths['/api/v1/exports/transactions.csv']);
  assert.ok(res.body.paths['/api/v1/exports/transactions.xlsx']);
  assert.ok(res.body.paths['/api/v1/exports/transactions.pdf']);
  assert.ok(res.body.paths['/api/v1/devices']);
  assert.ok(res.body.paths['/api/v1/devices/{id}']);
  assert.ok(res.body.paths['/api/v1/notifications']);
  assert.ok(res.body.paths['/api/v1/notifications/{id}/read']);
  assert.ok(res.body.paths['/api/v1/sync/changes']);
  assert.ok(res.body.paths['/api/v1/sync/mutations']);
});

test('GET /metrics returns HTTP counters and DB pool stats', async function () {
  await metrics.resetMetrics();
  await rateLimit.resetRateLimit();

  await request('/health');

  const res = await request('/metrics');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.error, null);
  assert.ok(res.body.data.http.requestCount >= 1);
  assert.ok('errorRate' in res.body.data.http);
  assert.ok('p95' in res.body.data.http.latencyMs);
  assert.equal(typeof res.body.data.db.configured, 'boolean');
  assert.equal(typeof res.body.data.db.totalCount, 'number');
});

test('global rate limit returns a standard 429 response', async function () {
  env.RATE_LIMIT_MAX = 1;
  env.RATE_LIMIT_WINDOW_MS = 60_000;
  await rateLimit.resetRateLimit();

  const first = await request('/health');
  const second = await request('/health');

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(second.body.error.code, 'RATE_LIMIT_EXCEEDED');
  assert.ok(second.headers['retry-after']);
});

test('audit repository redacts sensitive metadata before insert', async function () {
  let capturedParams;

  db.query = async function fakeQuery(sql, params = []) {
    assert.match(normalizeSql(sql), /insert into audit_events/);
    capturedParams = params;

    return { rowCount: 1, rows: [] };
  };

  await auditRepository.createAuditEvent({
    eventType: 'test.event',
    metadata: {
      apiKey: 'secret-api-key',
      refreshToken: 'secret-refresh-token',
      nested: {
        password: 'secret-password',
        safe: 'kept',
      },
    },
  });

  const metadata = JSON.parse(capturedParams[5]);

  assert.equal(metadata.apiKey, '[REDACTED]');
  assert.equal(metadata.refreshToken, '[REDACTED]');
  assert.equal(metadata.nested.password, '[REDACTED]');
  assert.equal(metadata.nested.safe, 'kept');
});

test('GET /docs serves interactive API documentation shell', async function () {
  const res = await request('/docs');

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Ví Vi Vu API Docs/);
  assert.match(res.body, /\/openapi\.json/);
});
