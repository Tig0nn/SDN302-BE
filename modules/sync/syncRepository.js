const db = require('../../config/db');
const transactionRepository = require('../transactions/transactionRepository');

const EPOCH = '1970-01-01T00:00:00.000Z';

const SYNC_TABLES = [
  {
    key: 'userSettings',
    from: 'user_settings',
    userScope: 'user_id = $1',
    hasDeletedAt: false,
    fields: `
      user_id as "userId",
      theme,
      daily_reminder_enabled as "dailyReminderEnabled",
      budget_warning_enabled as "budgetWarningEnabled",
      debt_reminder_enabled as "debtReminderEnabled",
      created_at as "createdAt",
      updated_at as "updatedAt",
      null::timestamptz as "deletedAt"
    `,
  },
  {
    key: 'ledgers',
    from: 'ledgers',
    userScope: 'user_id = $1',
    fields: `
      id,
      user_id as "userId",
      name,
      is_default as "isDefault",
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'categories',
    from: 'categories',
    userScope: '(user_id = $1 or user_id is null)',
    fields: `
      id,
      user_id as "userId",
      type,
      name,
      parent_id as "parentId",
      icon,
      color,
      is_system as "isSystem",
      sort_order as "sortOrder",
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'paymentAccounts',
    from: 'payment_accounts',
    userScope: '(user_id = $1 or user_id is null)',
    fields: `
      id,
      user_id as "userId",
      name,
      short_name as "shortName",
      type,
      color,
      is_system as "isSystem",
      sort_order as "sortOrder",
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'transactions',
    from: 'transactions',
    userScope: 'user_id = $1',
    fields: `
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
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'budgets',
    from: 'budgets',
    userScope: 'user_id = $1',
    fields: `
      id,
      user_id as "userId",
      ledger_id as "ledgerId",
      category_id as "categoryId",
      month::text,
      limit_amount_vnd as "limitAmountVnd",
      warning_threshold as "warningThreshold",
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'goals',
    from: 'goals',
    userScope: 'user_id = $1',
    fields: `
      id,
      user_id as "userId",
      ledger_id as "ledgerId",
      name,
      target_amount_vnd as "targetAmountVnd",
      current_amount_vnd as "currentAmountVnd",
      deadline::text,
      icon,
      color,
      status,
      completed_at as "completedAt",
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'debts',
    from: 'debts',
    userScope: 'user_id = $1',
    fields: `
      id,
      user_id as "userId",
      ledger_id as "ledgerId",
      direction,
      counterparty_name as "counterpartyName",
      amount_vnd as "amountVnd",
      remaining_amount_vnd as "remainingAmountVnd",
      due_date::text as "dueDate",
      note,
      status,
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'debtPayments',
    from: 'debt_payments',
    userScope: 'user_id = $1',
    fields: `
      id,
      user_id as "userId",
      debt_id as "debtId",
      amount_vnd as "amountVnd",
      paid_at::text as "paidAt",
      note,
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'challenges',
    from: 'challenges',
    userScope: 'user_id = $1',
    fields: `
      id,
      user_id as "userId",
      ledger_id as "ledgerId",
      name,
      target_amount_vnd as "targetAmountVnd",
      start_date::text as "startDate",
      end_date::text as "endDate",
      current_amount_vnd as "currentAmountVnd",
      streak_days as "streakDays",
      status,
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'challengeCheckins',
    from: 'challenge_checkins',
    userScope: 'user_id = $1',
    fields: `
      id,
      user_id as "userId",
      challenge_id as "challengeId",
      checkin_date::text as "checkinDate",
      amount_vnd as "amountVnd",
      note,
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'shoppingPlans',
    from: 'shopping_plans',
    userScope: 'user_id = $1',
    fields: `
      id,
      user_id as "userId",
      ledger_id as "ledgerId",
      name,
      budget_amount_vnd as "budgetAmountVnd",
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'shoppingItems',
    from: 'shopping_items',
    userScope: 'user_id = $1',
    fields: `
      id,
      user_id as "userId",
      shopping_plan_id as "shoppingPlanId",
      name,
      quantity::text,
      estimated_price_vnd as "estimatedPriceVnd",
      is_bought as "isBought",
      linked_transaction_id as "linkedTransactionId",
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
  {
    key: 'notifications',
    from: 'notification_events',
    userScope: 'user_id = $1',
    fields: `
      id,
      user_id as "userId",
      type,
      title,
      body,
      payload,
      event_key as "eventKey",
      sent_at as "sentAt",
      read_at as "readAt",
      created_at as "createdAt",
      updated_at as "updatedAt",
      deleted_at as "deletedAt"
    `,
  },
];

function appError(code, message, status) {
  const err = new Error(message);

  err.code = code;
  err.status = status;
  return err;
}

function parseJson(value) {
  if (!value || typeof value !== 'string') return value || null;

  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function mapMutation(row) {
  if (!row) return null;

  return {
    ...row,
    requestPayload: parseJson(row.requestPayload),
    responsePayload: parseJson(row.responsePayload),
  };
}

function getExecutor(client) {
  return client || db;
}

async function getServerTime(executor) {
  const result = await executor.query('select now() as "serverTime"');

  return result.rows[0].serverTime;
}

async function listChanges(userId, since) {
  const sinceValue = since || EPOCH;
  const changes = {};
  const results = await Promise.all(
    SYNC_TABLES.map((table) => {
      const deletedPredicate =
        table.hasDeletedAt === false
          ? 'false'
          : 'deleted_at > $2::timestamptz';

      return db.query(
        `
          select ${table.fields}
          from ${table.from}
          where ${table.userScope}
            and (
              updated_at > $2::timestamptz
              or ${deletedPredicate}
            )
          order by updated_at asc, created_at asc
          limit 500
        `,
        [userId, sinceValue]
      );
    })
  );

  SYNC_TABLES.forEach((table, index) => {
    changes[table.key] = results[index].rows;
  });

  return {
    since: sinceValue,
    serverTime: await getServerTime(db),
    changes,
  };
}

async function findExistingMutation(userId, clientMutationId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select
        id,
        user_id as "userId",
        client_mutation_id as "clientMutationId",
        operation,
        status,
        request_payload as "requestPayload",
        response_payload as "responsePayload",
        error_code as "errorCode",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from sync_mutations
      where user_id = $1
        and client_mutation_id = $2
      limit 1
      for update
    `,
    [userId, clientMutationId]
  );

  return mapMutation(result.rows[0]);
}

async function insertMutationRecord(userId, mutation, client) {
  const result = await client.query(
    `
      insert into sync_mutations (
        user_id,
        client_mutation_id,
        operation,
        status,
        request_payload
      )
      values ($1, $2, $3, 'processing', $4::jsonb)
      on conflict (user_id, client_mutation_id) do nothing
      returning
        id,
        user_id as "userId",
        client_mutation_id as "clientMutationId",
        operation,
        status,
        request_payload as "requestPayload",
        response_payload as "responsePayload",
        error_code as "errorCode",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      userId,
      mutation.clientMutationId,
      mutation.operation,
      JSON.stringify(mutation.payload || {}),
    ]
  );

  return mapMutation(result.rows[0]);
}

async function completeMutationRecord(userId, mutation, responsePayload, client) {
  await client.query(
    `
      update sync_mutations
      set status = 'completed',
          response_payload = $3::jsonb,
          error_code = null
      where user_id = $1
        and client_mutation_id = $2
    `,
    [userId, mutation.clientMutationId, JSON.stringify(responsePayload)]
  );
}

async function executeMutation(userId, mutation, client) {
  const payload = mutation.payload || {};

  if (mutation.operation === 'transactions.create') {
    const transaction = await transactionRepository.createTransactionWithClient(
      userId,
      {
        ...payload,
        clientMutationId: payload.clientMutationId || mutation.clientMutationId,
      },
      client
    );

    return { transaction };
  }

  if (mutation.operation === 'transactions.update') {
    if (!payload.id) {
      throw appError('SYNC_MUTATION_INVALID_PAYLOAD', 'Transaction id is required', 400);
    }

    const transaction = await transactionRepository.updateTransaction(
      userId,
      payload.id,
      payload,
      client
    );

    return { transaction };
  }

  if (mutation.operation === 'transactions.delete') {
    if (!payload.id) {
      throw appError('SYNC_MUTATION_INVALID_PAYLOAD', 'Transaction id is required', 400);
    }

    const transaction = await transactionRepository.deleteTransaction(
      userId,
      payload.id,
      client
    );

    return { transaction };
  }

  throw appError('SYNC_OPERATION_NOT_SUPPORTED', 'Sync operation is not supported', 400);
}

async function applyOneMutation(userId, mutation) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const inserted = await insertMutationRecord(userId, mutation, client);

    if (!inserted) {
      const existing = await findExistingMutation(
        userId,
        mutation.clientMutationId,
        client
      );

      await client.query('commit');

      if (existing?.status === 'completed') {
        return {
          clientMutationId: mutation.clientMutationId,
          operation: existing.operation,
          status: 'replayed',
          result: existing.responsePayload,
        };
      }

      return {
        clientMutationId: mutation.clientMutationId,
        operation: existing?.operation || mutation.operation,
        status: existing?.status || 'processing',
        result: existing?.responsePayload || null,
      };
    }

    const result = await executeMutation(userId, mutation, client);

    await completeMutationRecord(userId, mutation, result, client);
    await client.query('commit');

    return {
      clientMutationId: mutation.clientMutationId,
      operation: mutation.operation,
      status: 'completed',
      result,
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function applyMutations(userId, mutations) {
  const results = [];

  for (const mutation of mutations) {
    results.push(await applyOneMutation(userId, mutation));
  }

  return {
    serverTime: await getServerTime(db),
    results,
  };
}

module.exports = {
  applyMutations,
  listChanges,
};
