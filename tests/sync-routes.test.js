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
const ledgerId = '33333333-3333-4333-8333-333333333333';
const categoryId = '44444444-4444-4444-8444-444444444444';
const transactionId = '77777777-7777-4777-8777-777777777777';

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

function transactionRow(overrides = {}) {
  return {
    id: transactionId,
    userId: userA,
    ledgerId,
    type: 'expense',
    amountVnd: '30000',
    categoryId,
    subcategoryId: null,
    categoryNameSnapshot: 'Food',
    subcategoryNameSnapshot: null,
    transactionDate: '2026-06-03',
    note: 'Breakfast',
    paymentMethod: 'cash',
    paymentAccountId: null,
    receiptImageUrl: null,
    source: 'manual',
    clientMutationId: 'offline-1',
    createdAt: '2026-06-03T08:00:00.000Z',
    updatedAt: '2026-06-03T08:00:00.000Z',
    deletedAt: null,
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
  const queries = [];

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    queries.push({ sql: normalized, params });

    if (normalized.includes('from users')) {
      assert.equal(params[0], userA);
      return { rowCount: 1, rows: [userRow()] };
    }

    if (normalized === 'select now() as "servertime"') {
      return {
        rowCount: 1,
        rows: [{ serverTime: '2026-06-03T09:00:00.000Z' }],
      };
    }

    return handler(normalized, params);
  };

  return queries;
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
  db.getPool = originalGetPool;
});

test('GET /api/v1/sync/changes returns soft-deleted records in the delta', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    assert.equal(params[0], userA);
    assert.equal(params[1], '2026-06-01T00:00:00.000Z');

    if (sql.includes('from ledgers')) {
      return {
        rowCount: 1,
        rows: [
          {
            id: ledgerId,
            userId: userA,
            name: 'Main',
            isDefault: true,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-03T08:00:00.000Z',
            deletedAt: null,
          },
        ],
      };
    }

    if (sql.includes('from transactions')) {
      return {
        rowCount: 1,
        rows: [
          transactionRow({
            deletedAt: '2026-06-03T08:30:00.000Z',
          }),
        ],
      };
    }

    return { rowCount: 0, rows: [] };
  });

  const res = await request(
    '/api/v1/sync/changes?since=2026-06-01T00:00:00.000Z'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.serverTime, '2026-06-03T09:00:00.000Z');
  assert.equal(res.body.data.changes.ledgers[0].id, ledgerId);
  assert.equal(res.body.data.changes.transactions[0].deletedAt, '2026-06-03T08:30:00.000Z');
  assert.ok(
    queries.some(
      (query) =>
        query.sql.includes('from transactions') &&
        query.sql.includes('deleted_at as "deletedat"')
    )
  );
});

test('POST /api/v1/sync/mutations applies a queued transaction create once', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      clientQueries.push({ sql: normalized, params });

      if (['begin', 'commit', 'rollback'].includes(normalized)) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('insert into sync_mutations')) {
        assert.equal(params[0], userA);
        assert.equal(params[1], 'offline-1');
        assert.equal(params[2], 'transactions.create');

        return {
          rowCount: 1,
          rows: [
            {
              id: '88888888-8888-4888-8888-888888888888',
              userId: userA,
              clientMutationId: 'offline-1',
              operation: 'transactions.create',
              status: 'processing',
              requestPayload: JSON.parse(params[3]),
              responsePayload: null,
              errorCode: null,
              createdAt: '2026-06-03T08:00:00.000Z',
              updatedAt: '2026-06-03T08:00:00.000Z',
            },
          ],
        };
      }

      if (normalized.includes('client_mutation_id = $2')) {
        assert.equal(params[1], 'offline-1');
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('from ledgers')) {
        return { rowCount: 1, rows: [{ id: ledgerId }] };
      }

      if (normalized.includes('from categories')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: categoryId,
              userId: userA,
              type: 'expense',
              name: 'Food',
              parentId: null,
            },
          ],
        };
      }

      if (normalized.includes('insert into transactions')) {
        assert.equal(params[0], userA);
        assert.equal(params[1], ledgerId);
        assert.equal(params[14], 'offline-1');

        return { rowCount: 1, rows: [transactionRow()] };
      }

      if (normalized.includes('from budgets')) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('update sync_mutations')) {
        const responsePayload = JSON.parse(params[2]);

        assert.equal(responsePayload.transaction.id, transactionId);

        return { rowCount: 1, rows: [] };
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

  const res = await request('/api/v1/sync/mutations', {
    method: 'POST',
    body: {
      mutations: [
        {
          clientMutationId: 'offline-1',
          operation: 'transactions.create',
          payload: {
            ledgerId,
            type: 'expense',
            amountVnd: 30000,
            categoryId,
            transactionDate: '2026-06-03',
            note: 'Breakfast',
            paymentMethod: 'cash',
          },
        },
      ],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.results[0].status, 'completed');
  assert.equal(res.body.data.results[0].result.transaction.id, transactionId);
  assert.ok(clientQueries.some((query) => query.sql.includes('insert into transactions')));
});

test('POST /api/v1/sync/mutations replays the stored result for the same clientMutationId', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      clientQueries.push({ sql: normalized, params });

      if (['begin', 'commit', 'rollback'].includes(normalized)) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('insert into sync_mutations')) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('from sync_mutations')) {
        assert.equal(params[0], userA);
        assert.equal(params[1], 'offline-1');

        return {
          rowCount: 1,
          rows: [
            {
              id: '88888888-8888-4888-8888-888888888888',
              userId: userA,
              clientMutationId: 'offline-1',
              operation: 'transactions.create',
              status: 'completed',
              requestPayload: {},
              responsePayload: { transaction: transactionRow() },
              errorCode: null,
              createdAt: '2026-06-03T08:00:00.000Z',
              updatedAt: '2026-06-03T08:00:00.000Z',
            },
          ],
        };
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

  const res = await request('/api/v1/sync/mutations', {
    method: 'POST',
    body: {
      mutations: [
        {
          clientMutationId: 'offline-1',
          operation: 'transactions.create',
          payload: {
            ledgerId,
            type: 'expense',
            amountVnd: 30000,
            categoryId,
            transactionDate: '2026-06-03',
            paymentMethod: 'cash',
          },
        },
      ],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.results[0].status, 'replayed');
  assert.equal(res.body.data.results[0].result.transaction.id, transactionId);
  assert.ok(!clientQueries.some((query) => query.sql.includes('insert into transactions')));
});
