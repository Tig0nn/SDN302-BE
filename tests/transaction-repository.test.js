const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const transactionRepository = require('../modules/transactions/transactionRepository');
const budgetRepository = require('../modules/budgets/budgetRepository');

const originalQuery = db.query;
const originalGetPool = db.getPool;
const originalEvaluateBudgetAlerts = budgetRepository.evaluateBudgetAlertsForTransaction;

const userId = '11111111-1111-4111-8111-111111111111';
const ledgerId = '22222222-2222-4222-8222-222222222222';
const transactionId = '33333333-3333-4333-8333-333333333333';
const secondTransactionId = '44444444-4444-4444-8444-444444444444';
const categoryId = '55555555-5555-4555-8555-555555555555';
const subcategoryId = '66666666-6666-4666-8666-666666666666';
const paymentAccountId = '77777777-7777-4777-8777-777777777777';

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function transaction(overrides = {}) {
  return {
    id: transactionId,
    userId,
    ledgerId,
    type: 'expense',
    amountVnd: '100000',
    categoryId,
    subcategoryId: null,
    categoryNameSnapshot: 'Food',
    subcategoryNameSnapshot: null,
    transactionDate: '2026-06-01',
    note: 'Lunch',
    paymentMethod: 'cash',
    paymentAccountId: null,
    receiptImageUrl: null,
    source: 'manual',
    clientMutationId: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
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
  budgetRepository.evaluateBudgetAlertsForTransaction = originalEvaluateBudgetAlerts;
});

test('updateTransaction validates ledger, category, subcategory, payment account, and budget alerts', async function () {
  let evaluatedTransaction = null;

  budgetRepository.evaluateBudgetAlertsForTransaction = async function evaluateBudgetAlertsForTransaction(
    budgetUserId,
    transactionResult,
    client
  ) {
    assert.equal(budgetUserId, userId);
    assert.equal(client, undefined);
    evaluatedTransaction = transactionResult;
  };

  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from transactions') && sql.includes('limit 1')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], transactionId);

      return {
        rowCount: 1,
        rows: [transaction()],
      };
    }

    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from categories') && params[1] === categoryId) {
      return {
        rowCount: 1,
        rows: [
          {
            id: categoryId,
            userId,
            type: 'expense',
            name: 'Food',
            parentId: null,
          },
        ],
      };
    }

    if (sql.includes('from categories') && params[1] === subcategoryId) {
      return {
        rowCount: 1,
        rows: [
          {
            id: subcategoryId,
            userId,
            type: 'expense',
            name: 'Cafe',
            parentId: categoryId,
          },
        ],
      };
    }

    if (sql.includes('from payment_accounts')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], paymentAccountId);

      return { rowCount: 1, rows: [{ id: paymentAccountId }] };
    }

    if (sql.includes('update transactions') && sql.includes('receipt_image_url = $14')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], transactionId);
      assert.equal(params[2], ledgerId);
      assert.equal(params[3], 'expense');
      assert.equal(params[4], 120000);
      assert.equal(params[5], categoryId);
      assert.equal(params[6], subcategoryId);
      assert.equal(params[7], 'Food');
      assert.equal(params[8], 'Cafe');
      assert.equal(params[9], '2026-06-03');
      assert.equal(params[10], 'Coffee with team');
      assert.equal(params[11], 'transfer');
      assert.equal(params[12], paymentAccountId);
      assert.equal(params[13], 'https://cdn.example/receipt.jpg');

      return {
        rowCount: 1,
        rows: [
          transaction({
            amountVnd: '120000',
            subcategoryId,
            subcategoryNameSnapshot: 'Cafe',
            transactionDate: '2026-06-03',
            note: 'Coffee with team',
            paymentMethod: 'transfer',
            paymentAccountId,
            receiptImageUrl: 'https://cdn.example/receipt.jpg',
          }),
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const updated = await transactionRepository.updateTransaction(userId, transactionId, {
    amountVnd: 120000,
    subcategoryId,
    transactionDate: '2026-06-03',
    note: 'Coffee with team',
    paymentMethod: 'transfer',
    paymentAccountId,
    receiptImageUrl: 'https://cdn.example/receipt.jpg',
  });

  assert.equal(updated.amountVnd, 120000);
  assert.equal(updated.subcategoryNameSnapshot, 'Cafe');
  assert.equal(evaluatedTransaction.id, transactionId);
});

test('updateTransaction rejects a mismatched subcategory', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from transactions') && sql.includes('limit 1')) {
      return {
        rowCount: 1,
        rows: [transaction()],
      };
    }

    if (sql.includes('from ledgers')) {
      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from categories') && params[1] === categoryId) {
      return {
        rowCount: 1,
        rows: [{ id: categoryId, userId, type: 'expense', name: 'Food', parentId: null }],
      };
    }

    if (sql.includes('from categories') && params[1] === subcategoryId) {
      return {
        rowCount: 1,
        rows: [
          {
            id: subcategoryId,
            userId,
            type: 'expense',
            name: 'Wrong parent',
            parentId: '99999999-9999-4999-8999-999999999999',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  await assert.rejects(
    () =>
      transactionRepository.updateTransaction(userId, transactionId, {
        subcategoryId,
      }),
    {
      code: 'INVALID_CATEGORY',
      status: 400,
    }
  );
});

test('bulkDeleteTransactions deletes all requested ids atomically and preserves input order', async function () {
  const clientQueries = installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from transactions') && sql.includes('for update')) {
      assert.equal(params[0], userId);
      assert.deepEqual(params[1], [transactionId, secondTransactionId]);

      return {
        rowCount: 2,
        rows: [
          transaction({ id: secondTransactionId }),
          transaction({ id: transactionId }),
        ],
      };
    }

    if (sql.includes('update transactions') && sql.includes('set deleted_at = now()')) {
      assert.equal(params[0], userId);
      assert.deepEqual(params[1], [transactionId, secondTransactionId]);

      return {
        rowCount: 2,
        rows: [
          transaction({ id: secondTransactionId, amountVnd: '200000' }),
          transaction({ id: transactionId, amountVnd: '100000' }),
        ],
      };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const deleted = await transactionRepository.bulkDeleteTransactions(userId, [
    transactionId,
    secondTransactionId,
  ]);

  assert.deepEqual(
    deleted.map((row) => row.id),
    [transactionId, secondTransactionId]
  );
  assert.equal(deleted[1].amountVnd, 200000);
  assert.ok(clientQueries.some((query) => query.sql === 'commit'));
});

test('deleteTransaction throws when no row is soft deleted', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update transactions') && sql.includes('set deleted_at = now()')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], transactionId);

      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  await assert.rejects(() => transactionRepository.deleteTransaction(userId, transactionId), {
    code: 'TRANSACTION_NOT_FOUND',
    status: 404,
  });
});
