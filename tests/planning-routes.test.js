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
const goalId = '44444444-4444-4444-8444-444444444444';
const debtId = '55555555-5555-4555-8555-555555555555';
const paymentId = '66666666-6666-4666-8666-666666666666';
const challengeId = '77777777-7777-4777-8777-777777777777';
const checkinId = '88888888-8888-4888-8888-888888888888';

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

function goalRow(overrides = {}) {
  return {
    id: goalId,
    userId: userA,
    ledgerId,
    name: 'Emergency fund',
    targetAmountVnd: '1000',
    currentAmountVnd: '900',
    deadline: '2026-12-31',
    icon: null,
    color: null,
    status: 'active',
    completedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function debtRow(overrides = {}) {
  return {
    id: debtId,
    userId: userA,
    ledgerId,
    direction: 'borrowed',
    counterpartyName: 'Friend',
    amountVnd: '1000',
    remainingAmountVnd: '500',
    dueDate: '2026-05-01',
    note: null,
    status: 'active',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function paymentRow(overrides = {}) {
  return {
    id: paymentId,
    userId: userA,
    debtId,
    amountVnd: '300',
    paidAt: '2026-06-01',
    note: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function challengeRow(overrides = {}) {
  return {
    id: challengeId,
    userId: userA,
    ledgerId,
    name: 'No spend week',
    targetAmountVnd: '500',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    currentAmountVnd: '100',
    streakDays: 1,
    status: 'active',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function checkinRow(overrides = {}) {
  return {
    id: checkinId,
    userId: userA,
    challengeId,
    checkinDate: '2026-06-02',
    amountVnd: '200',
    note: null,
    createdAt: '2026-06-02T00:00:00.000Z',
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

test('GET /api/v1/goals lists goals through authenticated ledger scope', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from goals')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'active');

      return { rowCount: 1, rows: [goalRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/goals?ledgerId=${ledgerId}&status=active&userId=${userB}`);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.goals[0].currentAmountVnd, 900);
  assert.ok(queries.every((query) => !query.params.includes(userB)));
});

test('POST /api/v1/goals creates an active goal', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('insert into goals')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'Emergency fund');
      assert.equal(params[3], 1000);
      assert.equal(params[4], 100);
      assert.equal(params[5], '2026-12-31');
      assert.equal(params[8], 'active');

      return {
        rowCount: 1,
        rows: [goalRow({ currentAmountVnd: '100' })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/goals', {
    method: 'POST',
    body: {
      ledgerId,
      name: 'Emergency fund',
      targetAmountVnd: 1000,
      currentAmountVnd: 100,
      deadline: '2026-12-31',
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.goal.status, 'active');
  assert.equal(res.body.data.goal.currentAmountVnd, 100);
});

test('PATCH /api/v1/goals/:id completes a goal inside a transaction', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from goals') && sql.includes('for update')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], goalId);

      return { rowCount: 1, rows: [goalRow({ currentAmountVnd: '900' })] };
    }

    if (sql.includes('update goals') && sql.includes('target_amount_vnd = $5')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], goalId);
      assert.equal(params[2], ledgerId);
      assert.equal(params[4], 1000);
      assert.equal(params[5], 1000);
      assert.equal(params[12], 'completed');

      return {
        rowCount: 1,
        rows: [
          goalRow({
            currentAmountVnd: '1000',
            status: 'completed',
            completedAt: '2026-06-01T00:00:00.000Z',
          }),
        ],
      };
    }

    if (sql.includes('insert into notification_events')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], goalId);
      assert.equal(params[2], ledgerId);

      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(`/api/v1/goals/${goalId}`, {
    method: 'PATCH',
    body: {
      currentAmountVnd: 1000,
      status: 'completed',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.goal.status, 'completed');
  assert.ok(clientQueries.some((query) => query.sql.includes('insert into notification_events')));
  assert.ok(clientQueries.some((query) => query.sql === 'commit'));
});

test('DELETE /api/v1/goals/:id soft deletes a goal', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update goals') && sql.includes("status = 'cancelled'")) {
      assert.equal(params[0], userA);
      assert.equal(params[1], goalId);

      return {
        rowCount: 1,
        rows: [goalRow({ status: 'cancelled' })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/goals/${goalId}`, { method: 'DELETE' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.goal.status, 'cancelled');
});

test('POST /api/v1/goals/:id/deposits completes a goal and creates one notification', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from goals') && sql.includes('for update')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], goalId);

      return { rowCount: 1, rows: [goalRow()] };
    }

    if (sql.includes('update goals') && sql.includes('current_amount_vnd = $3')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], goalId);
      assert.equal(params[2], 1100);
      assert.equal(params[3], 'completed');

      return {
        rowCount: 1,
        rows: [
          goalRow({
            currentAmountVnd: '1100',
            status: 'completed',
            completedAt: '2026-06-01T00:00:00.000Z',
          }),
        ],
      };
    }

    if (sql.includes('insert into notification_events')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], goalId);
      assert.equal(params[2], ledgerId);

      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(`/api/v1/goals/${goalId}/deposits`, {
    method: 'POST',
    body: {
      amountVnd: 200,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.goal.currentAmountVnd, 1100);
  assert.equal(res.body.data.goal.status, 'completed');
  assert.ok(clientQueries.some((query) => query.sql.includes('insert into notification_events')));
});

test('POST /api/v1/debts creates a debt scoped to an owned ledger', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('insert into debts')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'borrowed');
      assert.equal(params[3], 'Friend');
      assert.equal(params[4], 1000);
      assert.equal(params[5], '2026-12-31');
      assert.equal(params[6], 'Lunch');

      return {
        rowCount: 1,
        rows: [debtRow({ dueDate: '2026-12-31', note: 'Lunch', remainingAmountVnd: '1000' })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/debts', {
    method: 'POST',
    body: {
      ledgerId,
      direction: 'borrowed',
      counterpartyName: 'Friend',
      amountVnd: 1000,
      dueDate: '2026-12-31',
      note: 'Lunch',
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.debt.remainingAmountVnd, 1000);
  assert.equal(res.body.data.debt.note, 'Lunch');
});

test('GET /api/v1/debts refreshes overdue status before listing', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('update debts') && sql.includes("set status = 'overdue'")) {
      assert.equal(params[0], userA);

      return { rowCount: 1, rows: [] };
    }

    if (sql.includes('from debts')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'overdue');

      return {
        rowCount: 1,
        rows: [debtRow({ status: 'overdue' })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(
    `/api/v1/debts?ledgerId=${ledgerId}&status=overdue&userId=${userB}`
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.debts[0].status, 'overdue');
  assert.ok(queries.every((query) => !query.params.includes(userB)));
});

test('PATCH /api/v1/debts/:id marks a debt as paid inside a transaction', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from debts') && sql.includes('for update')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], debtId);

      return { rowCount: 1, rows: [debtRow()] };
    }

    if (sql.includes('update debts') && sql.includes('remaining_amount_vnd = $7')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], debtId);
      assert.equal(params[2], ledgerId);
      assert.equal(params[5], 1000);
      assert.equal(params[6], 0);
      assert.equal(params[11], 'paid');

      return {
        rowCount: 1,
        rows: [debtRow({ remainingAmountVnd: '0', status: 'paid' })],
      };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(`/api/v1/debts/${debtId}`, {
    method: 'PATCH',
    body: {
      remainingAmountVnd: 0,
      status: 'paid',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.debt.status, 'paid');
  assert.equal(res.body.data.debt.remainingAmountVnd, 0);
  assert.ok(clientQueries.some((query) => query.sql === 'commit'));
});

test('DELETE /api/v1/debts/:id soft deletes a debt', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update debts') && sql.includes("status = 'cancelled'")) {
      assert.equal(params[0], userA);
      assert.equal(params[1], debtId);

      return {
        rowCount: 1,
        rows: [debtRow({ status: 'cancelled' })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/debts/${debtId}`, { method: 'DELETE' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.debt.status, 'cancelled');
});

test('POST /api/v1/debts/:id/payments rejects payments above remaining amount', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from debts') && sql.includes('for update')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], debtId);

      return { rowCount: 1, rows: [debtRow()] };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(`/api/v1/debts/${debtId}/payments`, {
    method: 'POST',
    body: {
      amountVnd: 700,
      paidAt: '2026-06-01',
    },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'DEBT_PAYMENT_EXCEEDS_REMAINING');
  assert.ok(!clientQueries.some((query) => query.sql.includes('insert into debt_payments')));
});

test('POST /api/v1/debts/:id/payments records a partial payment in a transaction', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from debts') && sql.includes('for update')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], debtId);

      return { rowCount: 1, rows: [debtRow()] };
    }

    if (sql.includes('insert into debt_payments')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], debtId);
      assert.equal(params[2], 300);
      assert.equal(params[3], '2026-06-01');

      return { rowCount: 1, rows: [paymentRow()] };
    }

    if (sql.includes('update debts') && sql.includes('remaining_amount_vnd = $3')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], debtId);
      assert.equal(params[2], 200);

      return {
        rowCount: 1,
        rows: [debtRow({ remainingAmountVnd: '200', status: 'overdue' })],
      };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(`/api/v1/debts/${debtId}/payments`, {
    method: 'POST',
    body: {
      amountVnd: 300,
      paidAt: '2026-06-01',
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.debt.remainingAmountVnd, 200);
  assert.equal(res.body.data.payment.amountVnd, 300);
  assert.ok(clientQueries.some((query) => query.sql === 'commit'));
});

test('GET /api/v1/challenges lists challenges by ledger and status', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from challenges')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'active');

      return { rowCount: 1, rows: [challengeRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(
    `/api/v1/challenges?ledgerId=${ledgerId}&status=active&userId=${userB}`
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.challenges[0].streakDays, 1);
  assert.ok(queries.every((query) => !query.params.includes(userB)));
});

test('POST /api/v1/challenges creates an active challenge', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('insert into challenges')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'No spend week');
      assert.equal(params[3], 500);
      assert.equal(params[4], '2026-06-01');
      assert.equal(params[5], '2026-06-30');

      return { rowCount: 1, rows: [challengeRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/challenges', {
    method: 'POST',
    body: {
      ledgerId,
      name: 'No spend week',
      targetAmountVnd: 500,
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.challenge.status, 'active');
});

test('PATCH /api/v1/challenges/:id updates date range and target inside a transaction', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from challenges') && sql.includes('for update')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], challengeId);

      return { rowCount: 1, rows: [challengeRow()] };
    }

    if (sql.includes('update challenges') && sql.includes('target_amount_vnd = $5')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], challengeId);
      assert.equal(params[2], ledgerId);
      assert.equal(params[3], 'No spend month');
      assert.equal(params[4], 800);
      assert.equal(params[5], '2026-06-01');
      assert.equal(params[6], '2026-07-01');
      assert.equal(params[7], 'active');

      return {
        rowCount: 1,
        rows: [
          challengeRow({
            name: 'No spend month',
            targetAmountVnd: '800',
            endDate: '2026-07-01',
          }),
        ],
      };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(`/api/v1/challenges/${challengeId}`, {
    method: 'PATCH',
    body: {
      name: 'No spend month',
      targetAmountVnd: 800,
      endDate: '2026-07-01',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.challenge.name, 'No spend month');
  assert.equal(res.body.data.challenge.targetAmountVnd, 800);
  assert.ok(clientQueries.some((query) => query.sql === 'commit'));
});

test('POST /api/v1/challenges/:id/checkins records progress and streak', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from challenges') && sql.includes('for update')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], challengeId);

      return { rowCount: 1, rows: [challengeRow()] };
    }

    if (sql.includes('from challenge_checkins') && sql.includes('checkin_date = $3::date')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], challengeId);
      assert.equal(params[2], '2026-06-02');

      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('insert into challenge_checkins')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], challengeId);
      assert.equal(params[2], '2026-06-02');
      assert.equal(params[3], 200);

      return { rowCount: 1, rows: [checkinRow()] };
    }

    if (sql.includes('update challenges c')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], challengeId);

      return {
        rowCount: 1,
        rows: [
          challengeRow({
            currentAmountVnd: '300',
            streakDays: 2,
          }),
        ],
      };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(`/api/v1/challenges/${challengeId}/checkins`, {
    method: 'POST',
    body: {
      checkinDate: '2026-06-02',
      amountVnd: 200,
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.challenge.currentAmountVnd, 300);
  assert.equal(res.body.data.challenge.streakDays, 2);
  assert.equal(res.body.data.idempotent, false);
  assert.ok(clientQueries.some((query) => query.sql === 'commit'));
});

test('POST /api/v1/challenges/:id/checkins returns existing same-day check-in', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from challenges') && sql.includes('for update')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], challengeId);

      return { rowCount: 1, rows: [challengeRow()] };
    }

    if (sql.includes('from challenge_checkins') && sql.includes('checkin_date = $3::date')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], challengeId);
      assert.equal(params[2], '2026-06-02');

      return { rowCount: 1, rows: [checkinRow()] };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(`/api/v1/challenges/${challengeId}/checkins`, {
    method: 'POST',
    body: {
      checkinDate: '2026-06-02',
      amountVnd: 200,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.checkin.id, checkinId);
  assert.equal(res.body.data.idempotent, true);
  assert.ok(!clientQueries.some((query) => query.sql.includes('insert into challenge_checkins')));
});

test('DELETE /api/v1/challenges/:id soft deletes a challenge', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update challenges') && sql.includes("status = 'cancelled'")) {
      assert.equal(params[0], userA);
      assert.equal(params[1], challengeId);

      return {
        rowCount: 1,
        rows: [challengeRow({ status: 'cancelled' })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/challenges/${challengeId}`, { method: 'DELETE' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.challenge.status, 'cancelled');
});
