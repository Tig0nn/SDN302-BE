const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const db = require('../config/db');
const app = require('../app');
const notificationRepository = require('../modules/notifications/notificationRepository');

const originalQuery = db.query;
const originalFetch = global.fetch;

const userA = '11111111-1111-4111-8111-111111111111';
const deviceTokenId = '22222222-2222-4222-8222-222222222222';
const notificationId = '33333333-3333-4333-8333-333333333333';
const expoPushToken = 'ExponentPushToken[test-token]';

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

function deviceTokenRow(overrides = {}) {
  return {
    id: deviceTokenId,
    userId: userA,
    platform: 'ios',
    expoPushToken,
    isActive: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function notificationRow(overrides = {}) {
  return {
    id: notificationId,
    userId: userA,
    type: 'daily_reminder',
    title: 'Nhac ghi chep chi tieu',
    body: 'Dung quen cap nhat thu chi hom nay.',
    payload: { date: '2026-06-03' },
    eventKey: `daily_reminder:${userA}:2026-06-03`,
    sentAt: null,
    readAt: null,
    createdAt: '2026-06-03T00:00:00.000Z',
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

function installQueryHandler(handler) {
  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    if (normalized.includes('from users')) {
      assert.equal(params[0], userA);
      return { rowCount: 1, rows: [userRow()] };
    }

    return handler(normalized, params);
  };
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
  global.fetch = originalFetch;
});

test('POST /api/v1/devices registers an Expo push token for the authenticated user', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('insert into device_tokens')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], 'ios');
      assert.equal(params[2], expoPushToken);

      return { rowCount: 1, rows: [deviceTokenRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/devices', {
    method: 'POST',
    body: {
      platform: 'ios',
      expoPushToken,
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.deviceToken.expoPushToken, expoPushToken);
  assert.equal(res.body.data.deviceToken.isActive, true);
});

test('DELETE /api/v1/devices/:id deactivates only the authenticated user token', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update device_tokens') && sql.includes('set is_active = false')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], deviceTokenId);

      return {
        rowCount: 1,
        rows: [deviceTokenRow({ isActive: false })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/devices/${deviceTokenId}`, {
    method: 'DELETE',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.deviceToken.id, deviceTokenId);
  assert.equal(res.body.data.deviceToken.isActive, false);
});

test('GET /api/v1/notifications lists notification history with unread filter', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('select count(*)::int as count')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], true);

      return { rowCount: 1, rows: [{ count: 1 }] };
    }

    if (sql.includes('from notification_events')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], true);
      assert.equal(params[2], 20);
      assert.equal(params[3], 0);

      return { rowCount: 1, rows: [notificationRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/notifications?unreadOnly=true');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.notifications[0].id, notificationId);
  assert.equal(res.body.data.pagination.total, 1);
});

test('PATCH /api/v1/notifications/:id/read marks a notification read by owner scope', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update notification_events')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], notificationId);

      return {
        rowCount: 1,
        rows: [
          notificationRow({
            readAt: '2026-06-03T10:00:00.000Z',
          }),
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/notifications/${notificationId}/read`, {
    method: 'PATCH',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.notification.id, notificationId);
  assert.ok(res.body.data.notification.readAt);
});

test('daily reminder job filters out users who disabled the preference', async function () {
  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    if (normalized.includes('insert into notification_events')) {
      assert.equal(params[0], '2026-06-03');
      assert.ok(normalized.includes('daily_reminder_enabled = true'));
      assert.ok(normalized.includes('on conflict'));

      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };

  const events =
    await notificationRepository.createDailyReminderEvents('2026-06-03');

  assert.deepEqual(events, []);
});

test('Expo DeviceNotRegistered errors deactivate the push token', async function () {
  const queries = [];

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    queries.push({ sql: normalized, params });

    if (normalized.includes('from device_tokens')) {
      return { rowCount: 1, rows: [deviceTokenRow()] };
    }

    if (
      normalized.includes('update device_tokens') &&
      normalized.includes('expo_push_token = any')
    ) {
      assert.deepEqual(params[0], [expoPushToken]);

      return { rowCount: 1, rows: [] };
    }

    if (normalized.includes('update notification_events')) {
      assert.equal(params[0], notificationId);

      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };
  global.fetch = async function fakeFetch() {
    return {
      ok: true,
      async json() {
        return {
          data: [
            {
              status: 'error',
              details: {
                error: 'DeviceNotRegistered',
              },
            },
          ],
        };
      },
    };
  };

  await notificationRepository.sendEvents([notificationRow()]);

  assert.ok(
    queries.some(
      (query) =>
        query.sql.includes('update device_tokens') &&
        query.sql.includes('expo_push_token = any')
    )
  );
});
