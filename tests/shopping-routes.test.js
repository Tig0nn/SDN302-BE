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
const planId = '44444444-4444-4444-8444-444444444444';
const itemId = '55555555-5555-4555-8555-555555555555';
const categoryId = '66666666-6666-4666-8666-666666666666';
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

function planRow(overrides = {}) {
  return {
    id: planId,
    userId: userA,
    ledgerId,
    name: 'Groceries',
    budgetAmountVnd: '200000',
    estimatedTotalVnd: '110000',
    boughtTotalVnd: '60000',
    itemCount: 2,
    boughtCount: 1,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function itemRow(overrides = {}) {
  return {
    id: itemId,
    userId: userA,
    shoppingPlanId: planId,
    name: 'Milk',
    quantity: '2',
    estimatedPriceVnd: '30000',
    isBought: true,
    linkedTransactionId: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function transactionRow(overrides = {}) {
  return {
    id: transactionId,
    userId: userA,
    ledgerId,
    type: 'expense',
    amountVnd: '60000',
    categoryId,
    subcategoryId: null,
    categoryNameSnapshot: 'Shopping',
    subcategoryNameSnapshot: null,
    transactionDate: '2026-06-02',
    note: 'Milk',
    paymentMethod: 'cash',
    paymentAccountId: null,
    receiptImageUrl: null,
    source: 'shopping_plan',
    clientMutationId: 'shopping-1',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
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

test('GET /api/v1/shopping-plans lists plans with computed totals', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from shopping_plans sp') && sql.includes('left join lateral')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [planRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(
    `/api/v1/shopping-plans?ledgerId=${ledgerId}&userId=${userB}`
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.shoppingPlans[0].estimatedTotalVnd, 110000);
  assert.equal(res.body.data.shoppingPlans[0].boughtTotalVnd, 60000);
  assert.equal(res.body.data.shoppingPlans[0].itemCount, 2);
  assert.ok(queries.every((query) => !query.params.includes(userB)));
});

test('POST /api/v1/shopping-plans creates a plan in an owned ledger', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('insert into shopping_plans')) {
      assert.match(sql, /insert into shopping_plans as sp/);
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'Tet groceries');
      assert.equal(params[3], 500000);

      return {
        rowCount: 1,
        rows: [planRow({ name: 'Tet groceries', budgetAmountVnd: '500000' })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/shopping-plans', {
    method: 'POST',
    body: {
      ledgerId,
      name: 'Tet groceries',
      budgetAmountVnd: 500000,
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.shoppingPlan.name, 'Tet groceries');
  assert.equal(res.body.data.shoppingPlan.budgetAmountVnd, 500000);
});

test('GET /api/v1/shopping-plans/:id returns plan details and items', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from shopping_plans sp') && sql.includes('left join lateral')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], planId);

      return { rowCount: 1, rows: [planRow()] };
    }

    if (sql.includes('from shopping_items si') && sql.includes('shopping_plan_id = $2')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], planId);

      return {
        rowCount: 1,
        rows: [itemRow()],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/shopping-plans/${planId}`);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.plan.id, planId);
  assert.equal(res.body.data.items[0].name, 'Milk');
});

test('PATCH /api/v1/shopping-plans/:id updates name and budget', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from shopping_plans sp') && sql.includes('left join lateral')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], planId);

      return { rowCount: 1, rows: [planRow()] };
    }

    if (sql.includes('update shopping_plans') && sql.includes('budget_amount_vnd = coalesce')) {
      assert.match(sql, /update shopping_plans as sp/);
      assert.equal(params[0], userA);
      assert.equal(params[1], planId);
      assert.equal(params[2], null);
      assert.equal(params[3], 'Weekly groceries');
      assert.equal(params[4], 300000);

      return {
        rowCount: 1,
        rows: [planRow({ name: 'Weekly groceries', budgetAmountVnd: '300000' })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/shopping-plans/${planId}`, {
    method: 'PATCH',
    body: {
      name: 'Weekly groceries',
      budgetAmountVnd: 300000,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.shoppingPlan.name, 'Weekly groceries');
  assert.equal(res.body.data.shoppingPlan.budgetAmountVnd, 300000);
});

test('DELETE /api/v1/shopping-plans/:id soft deletes a plan and its items', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('update shopping_plans') && sql.includes('set deleted_at = now()')) {
      assert.match(sql, /update shopping_plans as sp/);
      assert.equal(params[0], userA);
      assert.equal(params[1], planId);

      return { rowCount: 1, rows: [planRow()] };
    }

    if (sql.includes('update shopping_items') && sql.includes('shopping_plan_id = $2')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], planId);

      return { rowCount: 2, rows: [] };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(`/api/v1/shopping-plans/${planId}`, {
    method: 'DELETE',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.shoppingPlan.id, planId);
  assert.ok(clientQueries.some((query) => query.sql === 'commit'));
});

test('POST /api/v1/shopping-plans/:id/items creates an item in an owned plan', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from shopping_plans sp') && sql.includes('left join lateral')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], planId);

      return { rowCount: 1, rows: [planRow()] };
    }

    if (sql.includes('insert into shopping_items')) {
      assert.match(sql, /insert into shopping_items as si/);
      assert.equal(params[0], userA);
      assert.equal(params[1], planId);
      assert.equal(params[2], 'Milk');
      assert.equal(params[3], 2);
      assert.equal(params[4], 30000);
      assert.equal(params[5], false);

      return {
        rowCount: 1,
        rows: [itemRow({ isBought: false })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/shopping-plans/${planId}/items`, {
    method: 'POST',
    body: {
      name: 'Milk',
      quantity: 2,
      estimatedPriceVnd: 30000,
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.shoppingItem.quantity, 2);
  assert.equal(res.body.data.shoppingItem.estimatedPriceVnd, 30000);
});

test('PATCH /api/v1/shopping-items/:id toggles bought state', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from shopping_items si') && sql.includes('join shopping_plans sp')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], itemId);

      return {
        rowCount: 1,
        rows: [itemRow({ isBought: false, ledgerId })],
      };
    }

    if (sql.includes('update shopping_items') && sql.includes('is_bought = coalesce')) {
      assert.match(sql, /update shopping_items as si/);
      assert.equal(params[0], userA);
      assert.equal(params[1], itemId);
      assert.equal(params[5], true);

      return {
        rowCount: 1,
        rows: [itemRow({ isBought: true })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/shopping-items/${itemId}`, {
    method: 'PATCH',
    body: {
      isBought: true,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.shoppingItem.isBought, true);
});

test('PATCH /api/v1/shopping-items/:id rejects marking linked items unbought', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from shopping_items si') && sql.includes('join shopping_plans sp')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], itemId);

      return {
        rowCount: 1,
        rows: [itemRow({ ledgerId, linkedTransactionId: transactionId })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/shopping-items/${itemId}`, {
    method: 'PATCH',
    body: {
      isBought: false,
    },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'SHOPPING_ITEM_ALREADY_LINKED');
});

test('DELETE /api/v1/shopping-items/:id soft deletes an item', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update shopping_items') && sql.includes('set deleted_at = now()')) {
      assert.match(sql, /update shopping_items as si/);
      assert.equal(params[0], userA);
      assert.equal(params[1], itemId);

      return { rowCount: 1, rows: [itemRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request(`/api/v1/shopping-items/${itemId}`, {
    method: 'DELETE',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.shoppingItem.id, itemId);
});

test('POST /api/v1/shopping-items/:id/convert-to-transaction creates one shopping_plan expense', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from shopping_items si') && sql.includes('for update of si')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], itemId);

      return {
        rowCount: 1,
        rows: [itemRow({ ledgerId })],
      };
    }

    if (sql.includes('client_mutation_id = $2')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], 'shopping-1');

      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from categories')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], categoryId);

      return {
        rowCount: 1,
        rows: [
          {
            id: categoryId,
            userId: userA,
            type: 'expense',
            name: 'Shopping',
            parentId: null,
          },
        ],
      };
    }

    if (sql.includes('insert into transactions')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'expense');
      assert.equal(params[3], 60000);
      assert.equal(params[13], 'shopping_plan');
      assert.equal(params[14], 'shopping-1');

      return { rowCount: 1, rows: [transactionRow()] };
    }

    if (sql.includes('select id') && sql.includes('from budgets')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('update shopping_items') && sql.includes('linked_transaction_id = $3')) {
      assert.match(sql, /update shopping_items as si/);
      assert.equal(params[0], userA);
      assert.equal(params[1], itemId);
      assert.equal(params[2], transactionId);

      return {
        rowCount: 1,
        rows: [itemRow({ linkedTransactionId: transactionId })],
      };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(
    `/api/v1/shopping-items/${itemId}/convert-to-transaction`,
    {
      method: 'POST',
      body: {
        categoryId,
        transactionDate: '2026-06-02',
        paymentMethod: 'cash',
        clientMutationId: 'shopping-1',
      },
    }
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.transaction.source, 'shopping_plan');
  assert.equal(res.body.data.item.linkedTransactionId, transactionId);
  assert.equal(res.body.data.idempotent, false);
  assert.ok(clientQueries.some((query) => query.sql.includes('insert into transactions')));
});

test('POST /api/v1/shopping-items/:id/convert-to-transaction returns linked transaction without duplicate insert', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from shopping_items si') && sql.includes('for update of si')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], itemId);

      return {
        rowCount: 1,
        rows: [itemRow({ ledgerId, linkedTransactionId: transactionId })],
      };
    }

    if (sql.includes('from transactions')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], transactionId);

      return { rowCount: 1, rows: [transactionRow()] };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(
    `/api/v1/shopping-items/${itemId}/convert-to-transaction`,
    {
      method: 'POST',
      body: {
        categoryId,
        transactionDate: '2026-06-02',
        paymentMethod: 'cash',
      },
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.transaction.id, transactionId);
  assert.equal(res.body.data.idempotent, true);
  assert.ok(!clientQueries.some((query) => query.sql.includes('insert into transactions')));
});

test('POST /api/v1/shopping-items/:id/convert-to-transaction rejects unbought items', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from shopping_items si') && sql.includes('for update of si')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], itemId);

      return {
        rowCount: 1,
        rows: [itemRow({ ledgerId, isBought: false })],
      };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const res = await request(
    `/api/v1/shopping-items/${itemId}/convert-to-transaction`,
    {
      method: 'POST',
      body: {
        categoryId,
        transactionDate: '2026-06-02',
        paymentMethod: 'cash',
      },
    }
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'SHOPPING_ITEM_NOT_BOUGHT');
  assert.ok(clientQueries.some((query) => query.sql === 'rollback'));
  assert.ok(!clientQueries.some((query) => query.sql.includes('insert into transactions')));
});
