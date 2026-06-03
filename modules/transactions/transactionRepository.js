const db = require('../../config/db');
const budgetRepository = require('../budgets/budgetRepository');

const TRANSACTION_FIELDS = `
  id,
  user_id as "userId",
  ledger_id as "ledgerId",
  type,
  amount_vnd as "amountVnd",
  category_id as "categoryId",
  subcategory_id as "subcategoryId",
  category_name_snapshot as "categoryNameSnapshot",
  subcategory_name_snapshot as "subcategoryNameSnapshot",
  transaction_date::text as "transactionDate",
  note,
  payment_method as "paymentMethod",
  payment_account_id as "paymentAccountId",
  receipt_image_url as "receiptImageUrl",
  source,
  client_mutation_id as "clientMutationId",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function appError(code, message, status) {
  const err = new Error(message);

  err.code = code;
  err.status = status;
  return err;
}

function notFoundError() {
  return appError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);
}

function invalidLedgerError() {
  return appError('INVALID_LEDGER', 'Ledger not found', 400);
}

function invalidCategoryError(message) {
  return appError('INVALID_CATEGORY', message, 400);
}

function invalidPaymentAccountError() {
  return appError('INVALID_PAYMENT_ACCOUNT', 'Payment account not found', 400);
}

function mapTransaction(row) {
  if (!row) return null;

  return {
    ...row,
    amountVnd: Number(row.amountVnd),
  };
}

function mapSummary(row) {
  return {
    totalIncomeVnd: Number(row.totalIncomeVnd || 0),
    totalExpenseVnd: Number(row.totalExpenseVnd || 0),
    balanceVnd: Number(row.balanceVnd || 0),
    transactionCount: Number(row.transactionCount || 0),
  };
}

function mapCalendarRow(row) {
  return {
    date: row.date,
    totalIncomeVnd: Number(row.totalIncomeVnd || 0),
    totalExpenseVnd: Number(row.totalExpenseVnd || 0),
    balanceVnd: Number(row.balanceVnd || 0),
    transactionCount: Number(row.transactionCount || 0),
  };
}

function getExecutor(client) {
  return client || db;
}

async function assertLedger(userId, ledgerId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select id
      from ledgers
      where user_id = $1
        and id = $2
        and deleted_at is null
      limit 1
    `,
    [userId, ledgerId]
  );

  if (result.rowCount === 0) {
    throw invalidLedgerError();
  }
}

async function findCategory(userId, categoryId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select
        id,
        user_id as "userId",
        type,
        name,
        parent_id as "parentId"
      from categories
      where id = $2
        and deleted_at is null
        and (user_id = $1 or user_id is null)
      limit 1
    `,
    [userId, categoryId]
  );

  return result.rows[0] || null;
}

async function validateCategories(userId, payload, client) {
  const category = await findCategory(userId, payload.categoryId, client);

  if (!category) {
    throw invalidCategoryError('Category not found');
  }

  if (category.type !== payload.type) {
    throw invalidCategoryError('Category type does not match transaction type');
  }

  if (category.parentId) {
    throw invalidCategoryError('categoryId must reference a parent category');
  }

  if (!payload.subcategoryId) {
    return {
      category,
      subcategory: null,
    };
  }

  const subcategory = await findCategory(userId, payload.subcategoryId, client);

  if (!subcategory) {
    throw invalidCategoryError('Subcategory not found');
  }

  if (subcategory.type !== payload.type) {
    throw invalidCategoryError('Subcategory type does not match transaction type');
  }

  if (subcategory.parentId !== category.id) {
    throw invalidCategoryError('Subcategory does not belong to category');
  }

  return {
    category,
    subcategory,
  };
}

async function validatePaymentAccount(userId, paymentAccountId, client) {
  if (!paymentAccountId) return;

  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select id
      from payment_accounts
      where id = $2
        and deleted_at is null
        and (user_id = $1 or user_id is null)
      limit 1
    `,
    [userId, paymentAccountId]
  );

  if (result.rowCount === 0) {
    throw invalidPaymentAccountError();
  }
}

async function findByClientMutationId(userId, clientMutationId, client) {
  if (!clientMutationId) return null;

  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select ${TRANSACTION_FIELDS}
      from transactions
      where user_id = $1
        and client_mutation_id = $2
      limit 1
    `,
    [userId, clientMutationId]
  );

  return mapTransaction(result.rows[0]);
}

async function insertTransaction(userId, payload, client) {
  const existing = await findByClientMutationId(
    userId,
    payload.clientMutationId,
    client
  );

  if (existing) return existing;

  await assertLedger(userId, payload.ledgerId, client);

  const { category, subcategory } = await validateCategories(userId, payload, client);

  await validatePaymentAccount(userId, payload.paymentAccountId, client);

  const executor = getExecutor(client);
  const result = await executor.query(
    `
      insert into transactions (
        user_id,
        ledger_id,
        type,
        amount_vnd,
        category_id,
        subcategory_id,
        category_name_snapshot,
        subcategory_name_snapshot,
        transaction_date,
        note,
        payment_method,
        payment_account_id,
        receipt_image_url,
        source,
        client_mutation_id
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15
      )
      returning ${TRANSACTION_FIELDS}
    `,
    [
      userId,
      payload.ledgerId,
      payload.type,
      payload.amountVnd,
      category.id,
      subcategory?.id || null,
      category.name,
      subcategory?.name || null,
      payload.transactionDate,
      payload.note || '',
      payload.paymentMethod,
      payload.paymentAccountId || null,
      payload.receiptImageUrl || null,
      payload.source || 'manual',
      payload.clientMutationId || null,
    ]
  );

  const transaction = mapTransaction(result.rows[0]);

  await budgetRepository.evaluateBudgetAlertsForTransaction(
    userId,
    transaction,
    client
  );

  return transaction;
}

async function createTransaction(userId, payload) {
  return insertTransaction(userId, payload);
}

async function bulkCreateTransactions(userId, payloads) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const transactions = [];

    for (const payload of payloads) {
      transactions.push(await insertTransaction(userId, payload, client));
    }

    await client.query('commit');
    return transactions;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

function buildListParams(userId, filters) {
  return [
    userId,
    filters.ledgerId,
    filters.dateFrom || null,
    filters.dateTo || null,
    filters.type || null,
    filters.categoryId || null,
    filters.search || null,
  ];
}

const LIST_WHERE_CLAUSE = `
  t.user_id = $1
  and t.ledger_id = $2
  and t.deleted_at is null
  and ($3::date is null or t.transaction_date >= $3::date)
  and ($4::date is null or t.transaction_date <= $4::date)
  and ($5::text is null or t.type = $5)
  and (
    $6::uuid is null
    or t.category_id = $6::uuid
    or t.subcategory_id = $6::uuid
  )
  and (
    $7::text is null
    or t.note ilike '%' || $7 || '%'
    or t.category_name_snapshot ilike '%' || $7 || '%'
    or coalesce(t.subcategory_name_snapshot, '') ilike '%' || $7 || '%'
  )
`;

async function listTransactions(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const baseParams = buildListParams(userId, filters);
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 20;
  const offset = (page - 1) * pageSize;
  const dataParams = [...baseParams, pageSize, offset];

  const [rows, count] = await Promise.all([
    db.query(
      `
        select ${TRANSACTION_FIELDS}
        from transactions t
        where ${LIST_WHERE_CLAUSE}
        order by t.transaction_date desc, t.created_at desc
        limit $8
        offset $9
      `,
      dataParams
    ),
    db.query(
      `
        select count(*)::int as count
        from transactions t
        where ${LIST_WHERE_CLAUSE}
      `,
      baseParams
    ),
  ]);

  return {
    transactions: rows.rows.map(mapTransaction),
    pagination: {
      page,
      pageSize,
      total: count.rows[0].count,
      totalPages: Math.ceil(count.rows[0].count / pageSize),
    },
  };
}

async function exportTransactions(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const result = await db.query(
    `
      select ${TRANSACTION_FIELDS}
      from transactions t
      where ${LIST_WHERE_CLAUSE}
      order by t.transaction_date desc, t.created_at desc
      limit $8
    `,
    [...buildListParams(userId, filters), filters.limit || 10000]
  );

  return result.rows.map(mapTransaction);
}

async function getTransaction(userId, transactionId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select ${TRANSACTION_FIELDS}
      from transactions
      where user_id = $1
        and id = $2
        and deleted_at is null
      limit 1
    `,
    [userId, transactionId]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  return mapTransaction(result.rows[0]);
}

async function updateTransaction(userId, transactionId, payload, client) {
  const executor = getExecutor(client);
  const existing = await getTransaction(userId, transactionId, client);
  const next = {
    ledgerId: payload.ledgerId || existing.ledgerId,
    type: payload.type || existing.type,
    amountVnd: payload.amountVnd || existing.amountVnd,
    categoryId: payload.categoryId || existing.categoryId,
    subcategoryId: Object.prototype.hasOwnProperty.call(payload, 'subcategoryId')
      ? payload.subcategoryId
      : existing.subcategoryId,
    transactionDate: payload.transactionDate || existing.transactionDate,
    note: Object.prototype.hasOwnProperty.call(payload, 'note')
      ? payload.note
      : existing.note,
    paymentMethod: payload.paymentMethod || existing.paymentMethod,
    paymentAccountId: Object.prototype.hasOwnProperty.call(payload, 'paymentAccountId')
      ? payload.paymentAccountId
      : existing.paymentAccountId,
    receiptImageUrl: Object.prototype.hasOwnProperty.call(payload, 'receiptImageUrl')
      ? payload.receiptImageUrl
      : existing.receiptImageUrl,
  };

  await assertLedger(userId, next.ledgerId, client);

  const { category, subcategory } = await validateCategories(userId, next, client);

  await validatePaymentAccount(userId, next.paymentAccountId, client);

  const result = await executor.query(
    `
      update transactions
      set ledger_id = $3,
          type = $4,
          amount_vnd = $5,
          category_id = $6,
          subcategory_id = $7,
          category_name_snapshot = $8,
          subcategory_name_snapshot = $9,
          transaction_date = $10,
          note = $11,
          payment_method = $12,
          payment_account_id = $13,
          receipt_image_url = $14
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning ${TRANSACTION_FIELDS}
    `,
    [
      userId,
      transactionId,
      next.ledgerId,
      next.type,
      next.amountVnd,
      category.id,
      subcategory?.id || null,
      category.name,
      subcategory?.name || null,
      next.transactionDate,
      next.note || '',
      next.paymentMethod,
      next.paymentAccountId || null,
      next.receiptImageUrl || null,
    ]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  const transaction = mapTransaction(result.rows[0]);

  await budgetRepository.evaluateBudgetAlertsForTransaction(
    userId,
    transaction,
    client
  );

  return transaction;
}

async function deleteTransaction(userId, transactionId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      update transactions
      set deleted_at = now()
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning ${TRANSACTION_FIELDS}
    `,
    [userId, transactionId]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  return mapTransaction(result.rows[0]);
}

async function getSummary(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const result = await db.query(
    `
      select
        coalesce(sum(amount_vnd) filter (where type = 'income'), 0) as "totalIncomeVnd",
        coalesce(sum(amount_vnd) filter (where type = 'expense'), 0) as "totalExpenseVnd",
        coalesce(sum(case when type = 'income' then amount_vnd else -amount_vnd end), 0) as "balanceVnd",
        count(*)::int as "transactionCount"
      from transactions
      where user_id = $1
        and ledger_id = $2
        and deleted_at is null
        and ($3::date is null or transaction_date >= $3::date)
        and ($4::date is null or transaction_date <= $4::date)
    `,
    [userId, filters.ledgerId, filters.dateFrom || null, filters.dateTo || null]
  );

  return mapSummary(result.rows[0]);
}

async function getCalendarSummary(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const result = await db.query(
    `
      select
        transaction_date::text as date,
        coalesce(sum(amount_vnd) filter (where type = 'income'), 0) as "totalIncomeVnd",
        coalesce(sum(amount_vnd) filter (where type = 'expense'), 0) as "totalExpenseVnd",
        coalesce(sum(case when type = 'income' then amount_vnd else -amount_vnd end), 0) as "balanceVnd",
        count(*)::int as "transactionCount"
      from transactions
      where user_id = $1
        and ledger_id = $2
        and deleted_at is null
        and transaction_date >= $3::date
        and transaction_date < $4::date
      group by transaction_date
      order by transaction_date asc
    `,
    [userId, filters.ledgerId, filters.monthStart, filters.nextMonthStart]
  );

  return result.rows.map(mapCalendarRow);
}

module.exports = {
  bulkCreateTransactions,
  createTransaction,
  createTransactionWithClient: insertTransaction,
  deleteTransaction,
  exportTransactions,
  getCalendarSummary,
  getSummary,
  getTransaction,
  listTransactions,
  updateTransaction,
};
