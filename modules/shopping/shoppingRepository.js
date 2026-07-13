const db = require('../../config/db');
const transactionRepository = require('../transactions/transactionRepository');

const PLAN_FIELDS = `
  sp.id,
  sp.user_id as "userId",
  sp.ledger_id as "ledgerId",
  sp.name,
  sp.budget_amount_vnd as "budgetAmountVnd",
  sp.created_at as "createdAt",
  sp.updated_at as "updatedAt"
`;

const ITEM_FIELDS = `
  si.id,
  si.user_id as "userId",
  si.shopping_plan_id as "shoppingPlanId",
  si.name,
  si.quantity::text as quantity,
  si.estimated_price_vnd as "estimatedPriceVnd",
  si.is_bought as "isBought",
  si.linked_transaction_id as "linkedTransactionId",
  si.created_at as "createdAt",
  si.updated_at as "updatedAt"
`;

function appError(code, message, status) {
  const err = new Error(message);

  err.code = code;
  err.status = status;
  return err;
}

function planNotFoundError() {
  return appError('SHOPPING_PLAN_NOT_FOUND', 'Shopping plan not found', 404);
}

function itemNotFoundError() {
  return appError('SHOPPING_ITEM_NOT_FOUND', 'Shopping item not found', 404);
}

function invalidLedgerError() {
  return appError('INVALID_LEDGER', 'Ledger not found', 400);
}

function itemNotBoughtError() {
  return appError(
    'SHOPPING_ITEM_NOT_BOUGHT',
    'Shopping item must be marked bought before conversion',
    409
  );
}

function linkedItemError() {
  return appError(
    'SHOPPING_ITEM_ALREADY_LINKED',
    'Linked shopping items cannot be marked unbought',
    409
  );
}

function missingAmountError() {
  return appError(
    'SHOPPING_ITEM_AMOUNT_REQUIRED',
    'Shopping item needs a positive amount before conversion',
    400
  );
}

function getExecutor(client) {
  return client || db;
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function mapPlan(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.userId,
    ledgerId: row.ledgerId,
    name: row.name,
    budgetAmountVnd: Number(row.budgetAmountVnd || 0),
    estimatedTotalVnd: Number(row.estimatedTotalVnd || 0),
    boughtTotalVnd: Number(row.boughtTotalVnd || 0),
    itemCount: Number(row.itemCount || 0),
    boughtCount: Number(row.boughtCount || 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapItem(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.userId,
    shoppingPlanId: row.shoppingPlanId,
    name: row.name,
    quantity: Number(row.quantity),
    estimatedPriceVnd: Number(row.estimatedPriceVnd || 0),
    isBought: Boolean(row.isBought),
    linkedTransactionId: row.linkedTransactionId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function estimatedTotalForItem(item) {
  return Math.round(item.quantity * item.estimatedPriceVnd);
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

async function getPlanWithSummary(userId, planId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select
        ${PLAN_FIELDS},
        coalesce(summary.estimated_total_vnd, 0) as "estimatedTotalVnd",
        coalesce(summary.bought_total_vnd, 0) as "boughtTotalVnd",
        coalesce(summary.item_count, 0) as "itemCount",
        coalesce(summary.bought_count, 0) as "boughtCount"
      from shopping_plans sp
      left join lateral (
        select
          round(coalesce(sum(si.quantity * si.estimated_price_vnd), 0))::bigint
            as estimated_total_vnd,
          round(coalesce(sum(si.quantity * si.estimated_price_vnd)
            filter (where si.is_bought = true), 0))::bigint as bought_total_vnd,
          count(*)::int as item_count,
          count(*) filter (where si.is_bought = true)::int as bought_count
        from shopping_items si
        where si.user_id = sp.user_id
          and si.shopping_plan_id = sp.id
          and si.deleted_at is null
      ) summary on true
      where sp.user_id = $1
        and sp.id = $2
        and sp.deleted_at is null
      limit 1
    `,
    [userId, planId]
  );

  return mapPlan(result.rows[0]);
}

async function listShoppingPlans(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const result = await db.query(
    `
      select
        ${PLAN_FIELDS},
        coalesce(summary.estimated_total_vnd, 0) as "estimatedTotalVnd",
        coalesce(summary.bought_total_vnd, 0) as "boughtTotalVnd",
        coalesce(summary.item_count, 0) as "itemCount",
        coalesce(summary.bought_count, 0) as "boughtCount"
      from shopping_plans sp
      left join lateral (
        select
          round(coalesce(sum(si.quantity * si.estimated_price_vnd), 0))::bigint
            as estimated_total_vnd,
          round(coalesce(sum(si.quantity * si.estimated_price_vnd)
            filter (where si.is_bought = true), 0))::bigint as bought_total_vnd,
          count(*)::int as item_count,
          count(*) filter (where si.is_bought = true)::int as bought_count
        from shopping_items si
        where si.user_id = sp.user_id
          and si.shopping_plan_id = sp.id
          and si.deleted_at is null
      ) summary on true
      where sp.user_id = $1
        and sp.ledger_id = $2
        and sp.deleted_at is null
      order by sp.created_at desc, sp.name asc
    `,
    [userId, filters.ledgerId]
  );

  return result.rows.map(mapPlan);
}

async function createShoppingPlan(userId, payload) {
  await assertLedger(userId, payload.ledgerId);

  const result = await db.query(
    `
      insert into shopping_plans (
        user_id,
        ledger_id,
        name,
        budget_amount_vnd
      )
      values ($1, $2, $3, $4)
      returning ${PLAN_FIELDS}
    `,
    [
      userId,
      payload.ledgerId,
      payload.name,
      payload.budgetAmountVnd || 0,
    ]
  );

  return mapPlan(result.rows[0]);
}

async function getShoppingPlan(userId, planId) {
  const plan = await getPlanWithSummary(userId, planId);

  if (!plan) {
    throw planNotFoundError();
  }

  const items = await listShoppingItems(userId, planId);

  return {
    plan,
    items,
  };
}

async function updateShoppingPlan(userId, planId, payload) {
  const existing = await getPlanWithSummary(userId, planId);

  if (!existing) {
    throw planNotFoundError();
  }

  if (payload.ledgerId && payload.ledgerId !== existing.ledgerId) {
    await assertLedger(userId, payload.ledgerId);
  }

  const result = await db.query(
    `
      update shopping_plans
      set ledger_id = coalesce($3, ledger_id),
          name = coalesce($4, name),
          budget_amount_vnd = coalesce($5, budget_amount_vnd)
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning ${PLAN_FIELDS}
    `,
    [
      userId,
      planId,
      payload.ledgerId || null,
      payload.name || null,
      hasOwn(payload, 'budgetAmountVnd') ? payload.budgetAmountVnd : null,
    ]
  );

  return mapPlan(result.rows[0]);
}

async function deleteShoppingPlan(userId, planId) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const planResult = await client.query(
      `
        update shopping_plans
        set deleted_at = now()
        where user_id = $1
          and id = $2
          and deleted_at is null
        returning ${PLAN_FIELDS}
      `,
      [userId, planId]
    );

    if (planResult.rowCount === 0) {
      throw planNotFoundError();
    }

    await client.query(
      `
        update shopping_items
        set deleted_at = now()
        where user_id = $1
          and shopping_plan_id = $2
          and deleted_at is null
      `,
      [userId, planId]
    );

    await client.query('commit');
    return mapPlan(planResult.rows[0]);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function assertPlan(userId, planId, client) {
  const plan = await getPlanWithSummary(userId, planId, client);

  if (!plan) {
    throw planNotFoundError();
  }

  return plan;
}

async function listShoppingItems(userId, planId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select ${ITEM_FIELDS}
      from shopping_items si
      where si.user_id = $1
        and si.shopping_plan_id = $2
        and si.deleted_at is null
      order by si.is_bought asc, si.created_at asc
    `,
    [userId, planId]
  );

  return result.rows.map(mapItem);
}

async function createShoppingItem(userId, planId, payload) {
  await assertPlan(userId, planId);

  const result = await db.query(
    `
      insert into shopping_items (
        user_id,
        shopping_plan_id,
        name,
        quantity,
        estimated_price_vnd,
        is_bought
      )
      values ($1, $2, $3, $4, $5, $6)
      returning ${ITEM_FIELDS}
    `,
    [
      userId,
      planId,
      payload.name,
      payload.quantity || 1,
      payload.estimatedPriceVnd || 0,
      Boolean(payload.isBought),
    ]
  );

  return mapItem(result.rows[0]);
}

async function findShoppingItem(userId, itemId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select
        ${ITEM_FIELDS},
        sp.ledger_id as "ledgerId"
      from shopping_items si
      join shopping_plans sp on sp.id = si.shopping_plan_id
      where si.user_id = $1
        and si.id = $2
        and si.deleted_at is null
        and sp.deleted_at is null
      limit 1
    `,
    [userId, itemId]
  );

  return result.rows[0] || null;
}

async function updateShoppingItem(userId, itemId, payload) {
  const existing = await findShoppingItem(userId, itemId);

  if (!existing) {
    throw itemNotFoundError();
  }

  const item = mapItem(existing);

  if (item.linkedTransactionId && payload.isBought === false) {
    throw linkedItemError();
  }

  const result = await db.query(
    `
      update shopping_items
      set name = coalesce($3, name),
          quantity = coalesce($4, quantity),
          estimated_price_vnd = coalesce($5, estimated_price_vnd),
          is_bought = coalesce($6, is_bought)
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning ${ITEM_FIELDS}
    `,
    [
      userId,
      itemId,
      payload.name || null,
      hasOwn(payload, 'quantity') ? payload.quantity : null,
      hasOwn(payload, 'estimatedPriceVnd') ? payload.estimatedPriceVnd : null,
      hasOwn(payload, 'isBought') ? payload.isBought : null,
    ]
  );

  return mapItem(result.rows[0]);
}

async function deleteShoppingItem(userId, itemId) {
  const result = await db.query(
    `
      update shopping_items
      set deleted_at = now()
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning ${ITEM_FIELDS}
    `,
    [userId, itemId]
  );

  if (result.rowCount === 0) {
    throw itemNotFoundError();
  }

  return mapItem(result.rows[0]);
}

async function convertShoppingItemToTransaction(userId, itemId, payload) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const itemResult = await client.query(
      `
        select
          ${ITEM_FIELDS},
          sp.ledger_id as "ledgerId"
        from shopping_items si
        join shopping_plans sp on sp.id = si.shopping_plan_id
        where si.user_id = $1
          and si.id = $2
          and si.deleted_at is null
          and sp.deleted_at is null
        for update of si
      `,
      [userId, itemId]
    );

    if (itemResult.rowCount === 0) {
      throw itemNotFoundError();
    }

    const item = mapItem(itemResult.rows[0]);
    const ledgerId = itemResult.rows[0].ledgerId;

    if (item.linkedTransactionId) {
      const transaction = await transactionRepository.getTransaction(
        userId,
        item.linkedTransactionId,
        client
      );

      await client.query('commit');
      return {
        item,
        transaction,
        idempotent: true,
      };
    }

    if (!item.isBought) {
      throw itemNotBoughtError();
    }

    const amountVnd = payload.amountVnd || estimatedTotalForItem(item);

    if (amountVnd <= 0) {
      throw missingAmountError();
    }

    const transaction = await transactionRepository.createTransactionWithClient(
      userId,
      {
        ledgerId,
        type: 'expense',
        amountVnd,
        categoryId: payload.categoryId,
        subcategoryId: payload.subcategoryId || null,
        transactionDate: payload.transactionDate,
        note: hasOwn(payload, 'note') ? payload.note : item.name,
        paymentMethod: payload.paymentMethod,
        paymentAccountId: payload.paymentAccountId || null,
        receiptImageUrl: null,
        source: 'shopping_plan',
        clientMutationId: payload.clientMutationId,
      },
      client
    );

    const updatedItem = await client.query(
      `
        update shopping_items
        set is_bought = true,
            linked_transaction_id = $3
        where user_id = $1
          and id = $2
          and deleted_at is null
        returning ${ITEM_FIELDS}
      `,
      [userId, itemId, transaction.id]
    );

    await client.query('commit');
    return {
      item: mapItem(updatedItem.rows[0]),
      transaction,
      idempotent: false,
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  convertShoppingItemToTransaction,
  createShoppingItem,
  createShoppingPlan,
  deleteShoppingItem,
  deleteShoppingPlan,
  getShoppingPlan,
  listShoppingPlans,
  updateShoppingItem,
  updateShoppingPlan,
};
