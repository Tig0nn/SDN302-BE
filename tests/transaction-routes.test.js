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
const paymentAccountId = '66666666-6666-4666-8666-666666666666';
const transactionId = '77777777-7777-4777-8777-777777777777';
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

function transactionRow(overrides = {}) {
  return {
    id: transactionId,
    userId: userA,
    ledgerId,
    type: 'expense',
    amountVnd: '30000',
    categoryId,
    subcategoryId,
    categoryNameSnapshot: 'Food',
    subcategoryNameSnapshot: 'Cafe',
    transactionDate: '2026-06-01',
    note: 'Breakfast',
    paymentMethod: 'cash',
    paymentAccountId,
    receiptImageUrl: null,
    source: 'manual',
    clientMutationId: 'client-1',
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

    return handler(normalized, params);
  };

  return queries;
}

function handleTransactionWriteQuery(sql, params) {
  if (sql.includes('client_mutation_id = $2')) {
    return { rowCount: 0, rows: [] };
  }

  if (sql.includes('from ledgers')) {
    assert.equal(params[0], userA);
    assert.equal(params[1], ledgerId);

    return { rowCount: 1, rows: [{ id: ledgerId }] };
  }

  if (sql.includes('from categories')) {
    assert.equal(params[0], userA);

    if (params[1] === categoryId) {
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

    if (params[1] === subcategoryId) {
      return {
        rowCount: 1,
        rows: [
          {
            id: subcategoryId,
            userId: userA,
            type: 'expense',
            name: 'Cafe',
            parentId: categoryId,
          },
        ],
      };
    }
  }

  if (sql.includes('from payment_accounts')) {
    assert.equal(params[0], userA);
    assert.equal(params[1], paymentAccountId);

    return { rowCount: 1, rows: [{ id: paymentAccountId }] };
  }

  if (sql.includes('insert into transactions')) {
    assert.equal(params[0], userA);
    assert.equal(params[1], ledgerId);
    assert.equal(params[3], 30000);
    assert.equal(params[6], 'Food');
    assert.equal(params[7], 'Cafe');

    return { rowCount: 1, rows: [transactionRow()] };
  }

  if (sql.includes('insert into notification_events')) {
    assert.equal(params[0], userA);
    assert.equal(params[1], budgetId);

    return { rowCount: 1, rows: [] };
  }

  if (sql.includes('select id') && sql.includes('from budgets')) {
    assert.equal(params[0], userA);
    assert.equal(params[1], ledgerId);

    return { rowCount: 1, rows: [{ id: budgetId }] };
  }

  throw new Error(`Unexpected query: ${sql}`);
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
  db.getPool = originalGetPool;
});

test('POST /api/v1/transactions creates a transaction with category snapshots', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    return handleTransactionWriteQuery(sql, params);
  });

  const res = await request('/api/v1/transactions', {
    method: 'POST',
    body: {
      ledgerId,
      type: 'expense',
      amountVnd: 30000,
      categoryId,
      subcategoryId,
      transactionDate: '2026-06-01',
      note: 'Breakfast',
      paymentMethod: 'cash',
      paymentAccountId,
      clientMutationId: 'client-1',
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.transaction.amountVnd, 30000);
  assert.equal(res.body.data.transaction.categoryNameSnapshot, 'Food');
  assert.equal(res.body.data.transaction.subcategoryNameSnapshot, 'Cafe');
  assert.ok(queries.some((query) => query.sql.includes('insert into notification_events')));
});

test('GET /api/v1/transactions lists only the authenticated user and ledger scope', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('select count(*)::int as count')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ count: 1 }] };
    }

    if (sql.includes('from transactions t')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[4], 'expense');

      return { rowCount: 1, rows: [transactionRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(
    `/api/v1/transactions?ledgerId=${ledgerId}&type=expense&userId=${userB}`
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.transactions[0].id, transactionId);
  assert.equal(res.body.data.pagination.total, 1);
  assert.ok(queries.every((query) => !query.params.includes(userB)));
});

test('GET /api/v1/transactions/summary returns aggregate totals', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('totalincomevnd')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

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

  const res = await request(`/api/v1/transactions/summary?ledgerId=${ledgerId}`);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.summary, {
    totalIncomeVnd: 100000,
    totalExpenseVnd: 30000,
    balanceVnd: 70000,
    transactionCount: 2,
  });
});

test('GET /api/v1/transactions/calendar returns daily month summary', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('group by transaction_date')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], '2026-06-01');
      assert.equal(params[3], '2026-07-01');

      return {
        rowCount: 1,
        rows: [
          {
            date: '2026-06-01',
            totalIncomeVnd: '0',
            totalExpenseVnd: '30000',
            balanceVnd: '-30000',
            transactionCount: 1,
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(
    `/api/v1/transactions/calendar?ledgerId=${ledgerId}&month=2026-06`
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.calendar[0].date, '2026-06-01');
  assert.equal(res.body.data.calendar[0].balanceVnd, -30000);
});

test('GET /api/v1/transactions/:id returns one transaction by owner scope', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from transactions') && sql.includes('limit 1')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], transactionId);

      return { rowCount: 1, rows: [transactionRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/transactions/${transactionId}`);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.transaction.id, transactionId);
  assert.equal(res.body.data.transaction.amountVnd, 30000);
});

test('PATCH /api/v1/transactions/:id updates one transaction through repository validation', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from transactions') && sql.includes('limit 1')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], transactionId);

      return { rowCount: 1, rows: [transactionRow()] };
    }

    if (sql.includes('update transactions') && sql.includes('receipt_image_url = $14')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], transactionId);
      assert.equal(params[4], 45000);
      assert.equal(params[10], 'Updated breakfast');

      return {
        rowCount: 1,
        rows: [
          transactionRow({
            amountVnd: '45000',
            note: 'Updated breakfast',
          }),
        ],
      };
    }

    return handleTransactionWriteQuery(sql, params);
  });

  const res = await request(`/api/v1/transactions/${transactionId}`, {
    method: 'PATCH',
    body: {
      amountVnd: 45000,
      note: 'Updated breakfast',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.transaction.amountVnd, 45000);
  assert.equal(res.body.data.transaction.note, 'Updated breakfast');
});

test('POST /api/v1/transactions/bulk reuses existing client mutation ids', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      clientQueries.push({ sql: normalized, params });

      if (normalized === 'begin' || normalized === 'commit') {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('client_mutation_id = $2')) {
        assert.equal(params[0], userA);
        assert.equal(params[1], 'client-1');

        return { rowCount: 1, rows: [transactionRow()] };
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

  const res = await request('/api/v1/transactions/bulk', {
    method: 'POST',
    body: {
      transactions: [
        {
          ledgerId,
          type: 'expense',
          amountVnd: 30000,
          categoryId,
          transactionDate: '2026-06-01',
          paymentMethod: 'cash',
          clientMutationId: 'client-1',
        },
      ],
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.transactions[0].id, transactionId);
  assert.ok(!clientQueries.some((query) => query.sql.includes('insert into transactions')));
});

test('DELETE /api/v1/transactions/:id soft deletes through authenticated user scope', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update transactions') && sql.includes('set deleted_at = now()')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], transactionId);

      return { rowCount: 1, rows: [transactionRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/transactions/${transactionId}`, {
    method: 'DELETE',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.transaction.id, transactionId);
});
