const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const notificationRepository = require('../modules/notifications/notificationRepository');
const pushService = require('../modules/notifications/pushService');

const originalQuery = db.query;
const originalSendExpoNotification = pushService.sendExpoNotification;

const userId = '11111111-1111-4111-8111-111111111111';
const deviceId = '22222222-2222-4222-8222-222222222222';
const notificationId = '33333333-3333-4333-8333-333333333333';

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function device(overrides = {}) {
  return {
    id: deviceId,
    userId,
    platform: 'ios',
    expoPushToken: 'ExponentPushToken[active]',
    isActive: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function notification(overrides = {}) {
  return {
    id: notificationId,
    userId,
    type: 'daily_reminder',
    title: 'Reminder',
    body: 'Track today',
    payload: JSON.stringify({ date: '2026-06-01' }),
    eventKey: 'daily_reminder:1:2026-06-01',
    sentAt: null,
    readAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function installQueryHandler(handler) {
  const queries = [];

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    queries.push({ sql: normalized, params });
    return handler(normalized, params);
  };

  return queries;
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
  pushService.sendExpoNotification = originalSendExpoNotification;
});

test('registerDeviceToken upserts an active Expo token', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('insert into device_tokens')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], 'android');
      assert.equal(params[2], 'ExponentPushToken[new]');

      return {
        rowCount: 1,
        rows: [device({ platform: 'android', expoPushToken: 'ExponentPushToken[new]' })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const registered = await notificationRepository.registerDeviceToken(userId, {
    platform: 'android',
    expoPushToken: 'ExponentPushToken[new]',
  });

  assert.equal(registered.platform, 'android');
  assert.equal(registered.isActive, true);
});

test('deactivateDeviceToken and markNotificationRead throw typed not-found errors', async function () {
  installQueryHandler(async function handleQuery(sql) {
    if (sql.includes('update device_tokens') || sql.includes('update notification_events')) {
      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  await assert.rejects(() => notificationRepository.deactivateDeviceToken(userId, deviceId), {
    code: 'DEVICE_TOKEN_NOT_FOUND',
    status: 404,
  });
  await assert.rejects(
    () => notificationRepository.markNotificationRead(userId, notificationId),
    {
      code: 'NOTIFICATION_NOT_FOUND',
      status: 404,
    }
  );
});

test('markNotificationRead maps JSON payload strings and invalid JSON safely', async function () {
  let invalid = false;

  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update notification_events')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], notificationId);

      const row = invalid
        ? notification({ payload: '{not-json' })
        : notification({ payload: '{"ok":true}' });

      invalid = true;
      return { rowCount: 1, rows: [row] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const read = await notificationRepository.markNotificationRead(userId, notificationId);
  const invalidPayload = await notificationRepository.markNotificationRead(userId, notificationId);

  assert.deepEqual(read.payload, { ok: true });
  assert.equal(invalidPayload.payload, null);
});

test('sendEvents pushes to active tokens, deactivates inactive tokens, and marks sent', async function () {
  const sentEvents = [];
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from device_tokens') && sql.includes('is_active = true')) {
      assert.equal(params[0], userId);

      return {
        rowCount: 2,
        rows: [
          device(),
          device({ id: 'inactive-device', expoPushToken: 'ExponentPushToken[inactive]' }),
        ],
      };
    }

    if (sql.includes('where expo_push_token = any')) {
      assert.deepEqual(params[0], ['ExponentPushToken[inactive]']);

      return { rowCount: 1, rows: [] };
    }

    if (sql.includes('set sent_at = coalesce')) {
      assert.equal(params[0], notificationId);

      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  pushService.sendExpoNotification = async function sendExpoNotification(tokens, event) {
    sentEvents.push({ tokens, event });

    return {
      attempted: true,
      inactiveTokens: ['ExponentPushToken[inactive]'],
    };
  };

  await notificationRepository.sendEvents([
    notification({ payload: '{"date":"2026-06-01"}' }),
  ]);

  assert.equal(sentEvents[0].tokens.length, 2);
  assert.deepEqual(sentEvents[0].event.payload, { date: '2026-06-01' });
  assert.ok(queries.some((query) => query.sql.includes('where expo_push_token = any')));
  assert.ok(queries.some((query) => query.sql.includes('set sent_at = coalesce')));
});

test('sendPendingNotificationEvents fetches enabled pending events and dispatches them', async function () {
  const pushed = [];

  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from notification_events n') && sql.includes('left join user_settings')) {
      assert.equal(params[0], 5);

      return {
        rowCount: 1,
        rows: [notification({ type: 'budget_threshold', payload: { threshold: 80 } })],
      };
    }

    if (sql.includes('from device_tokens')) {
      return { rowCount: 1, rows: [device()] };
    }

    if (sql.includes('where expo_push_token = any')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('set sent_at = coalesce')) {
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  pushService.sendExpoNotification = async function sendExpoNotification(tokens, event) {
    pushed.push({ tokens, event });

    return { attempted: true, inactiveTokens: [] };
  };

  const sent = await notificationRepository.sendPendingNotificationEvents(5);

  assert.equal(sent[0].type, 'budget_threshold');
  assert.equal(pushed[0].event.payload.threshold, 80);
});

test('createBudgetThresholdEvents inserts threshold events and dispatches returned rows', async function () {
  const pushed = [];

  installQueryHandler(async function handleQuery(sql) {
    if (sql.includes('with budget_status as')) {
      return {
        rowCount: 1,
        rows: [
          notification({
            type: 'budget_threshold',
            payload: JSON.stringify({ threshold: 100, spentAmountVnd: 1200000 }),
          }),
        ],
      };
    }

    if (sql.includes('from device_tokens')) {
      return { rowCount: 1, rows: [device()] };
    }

    if (sql.includes('where expo_push_token = any')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('set sent_at = coalesce')) {
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  pushService.sendExpoNotification = async function sendExpoNotification(tokens, event) {
    pushed.push(event);

    return { attempted: true, inactiveTokens: [] };
  };

  const events = await notificationRepository.createBudgetThresholdEvents();

  assert.equal(events[0].payload.threshold, 100);
  assert.equal(pushed[0].type, 'budget_threshold');
});

test('createDebtReminderEvents marks overdue debts and returns due plus overdue events', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update debts')) {
      assert.equal(params[0], '2026-06-07');

      return { rowCount: 1, rows: [] };
    }

    if (sql.includes("'debt_due'")) {
      assert.equal(params[0], '2026-06-07');

      return {
        rowCount: 1,
        rows: [
          notification({
            id: 'due-id',
            type: 'debt_due',
            payload: JSON.stringify({ dueDate: '2026-06-07' }),
          }),
        ],
      };
    }

    if (sql.includes("'debt_overdue'")) {
      assert.equal(params[0], '2026-06-07');

      return {
        rowCount: 1,
        rows: [
          notification({
            id: 'overdue-id',
            type: 'debt_overdue',
            payload: JSON.stringify({ dueDate: '2026-06-01' }),
          }),
        ],
      };
    }

    if (sql.includes('from device_tokens')) {
      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const events = await notificationRepository.createDebtReminderEvents('2026-06-07');

  assert.deepEqual(
    events.map((event) => event.type),
    ['debt_due', 'debt_overdue']
  );
  assert.equal(events[0].payload.dueDate, '2026-06-07');
  assert.ok(queries.some((query) => query.sql.includes('update debts')));
});
