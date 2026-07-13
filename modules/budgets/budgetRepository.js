const db = require('../../config/db');
const notificationRepository = require('../notifications/notificationRepository');

const BUDGET_FIELDS = `
  b.id,
  b.user_id as "userId",
  b.ledger_id as "ledgerId",
  b.category_id as "categoryId",
  c.name as "categoryName",
  b.month::text as month,
  b.limit_amount_vnd as "limitAmountVnd",
  b.warning_threshold as "warningThreshold",
  b.created_at as "createdAt",
  b.updated_at as "updatedAt"
`;

function appError(code, message, status) {
  const err = new Error(message);

  err.code = code;
  err.status = status;
  return err;
}

function notFoundError() {
  return appError('BUDGET_NOT_FOUND', 'Budget not found', 404);
}

function duplicateBudgetError() {
  return appError('BUDGET_ALREADY_EXISTS', 'Budget already exists', 409);
}

function invalidLedgerError() {
  return appError('INVALID_LEDGER', 'Ledger not found', 400);
}

function invalidCategoryError(message) {
  return appError('INVALID_CATEGORY', message, 400);
}

function getExecutor(client) {
  return client || db;
}

function toMonthStart(month) {
  return `${month}-01`;
}

function monthStartForDate(date) {
  return `${date.slice(0, 7)}-01`;
}

function mapBudget(row) {
  if (!row) return null;

  const spentAmountVnd = Number(row.spentAmountVnd || 0);
  const limitAmountVnd = Number(row.limitAmountVnd || 0);
  const progressPercent =
    limitAmountVnd > 0
      ? Number(((spentAmountVnd / limitAmountVnd) * 100).toFixed(2))
      : 0;

  return {
    id: row.id,
    userId: row.userId,
    ledgerId: row.ledgerId,
    categoryId: row.categoryId,
    categoryName: row.categoryName || null,
    month: row.month,
    limitAmountVnd,
    warningThreshold: Number(row.warningThreshold),
    spentAmountVnd,
    progressPercent,
    status:
      progressPercent >= 100
        ? 'exceeded'
        : progressPercent >= Number(row.warningThreshold)
          ? 'warning'
          : 'ok',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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

async function assertExpenseCategory(userId, categoryId, client) {
  if (!categoryId) return;

  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select id, type
      from categories
      where id = $2
        and deleted_at is null
        and (user_id = $1 or user_id is null)
      limit 1
    `,
    [userId, categoryId]
  );

  if (result.rowCount === 0) {
    throw invalidCategoryError('Category not found');
  }

  if (result.rows[0].type !== 'expense') {
    throw invalidCategoryError('Budget category must be an expense category');
  }
}

async function assertNoDuplicateBudget(userId, payload, excludeBudgetId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select id
      from budgets
      where user_id = $1
        and ledger_id = $2
        and category_id is not distinct from $3::uuid
        and month = $4::date
        and deleted_at is null
        and ($5::uuid is null or id <> $5)
      limit 1
    `,
    [
      userId,
      payload.ledgerId,
      payload.categoryId || null,
      payload.month,
      excludeBudgetId || null,
    ]
  );

  if (result.rowCount > 0) {
    throw duplicateBudgetError();
  }
}

async function findBudgetById(userId, budgetId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select ${BUDGET_FIELDS}
      from budgets b
      left join categories c on c.id = b.category_id
      where b.user_id = $1
        and b.id = $2
        and b.deleted_at is null
      limit 1
    `,
    [userId, budgetId]
  );

  return result.rows[0] || null;
}

async function getBudgetWithProgress(userId, budgetId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select
        ${BUDGET_FIELDS},
        coalesce(spent.spent_amount_vnd, 0) as "spentAmountVnd"
      from budgets b
      left join categories c on c.id = b.category_id
      left join lateral (
        select sum(t.amount_vnd) as spent_amount_vnd
        from transactions t
        where t.user_id = b.user_id
          and t.ledger_id = b.ledger_id
          and t.deleted_at is null
          and t.type = 'expense'
          and t.transaction_date >= b.month
          and t.transaction_date < b.month + interval '1 month'
          and (
            b.category_id is null
            or t.category_id = b.category_id
            or t.subcategory_id = b.category_id
          )
      ) spent on true
      where b.user_id = $1
        and b.id = $2
        and b.deleted_at is null
      limit 1
    `,
    [userId, budgetId]
  );

  const budget = mapBudget(result.rows[0]);

  if (!budget) {
    throw notFoundError();
  }

  return budget;
}

async function listBudgets(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const result = await db.query(
    `
      select
        ${BUDGET_FIELDS},
        coalesce(spent.spent_amount_vnd, 0) as "spentAmountVnd"
      from budgets b
      left join categories c on c.id = b.category_id
      left join lateral (
        select sum(t.amount_vnd) as spent_amount_vnd
        from transactions t
        where t.user_id = b.user_id
          and t.ledger_id = b.ledger_id
          and t.deleted_at is null
          and t.type = 'expense'
          and t.transaction_date >= b.month
          and t.transaction_date < b.month + interval '1 month'
          and (
            b.category_id is null
            or t.category_id = b.category_id
            or t.subcategory_id = b.category_id
          )
      ) spent on true
      where b.user_id = $1
        and b.ledger_id = $2
        and b.month = $3::date
        and b.deleted_at is null
      order by c.name nulls first, b.created_at asc
    `,
    [userId, filters.ledgerId, filters.month]
  );

  return result.rows.map(mapBudget);
}

async function createBudget(userId, payload) {
  const normalized = {
    ...payload,
    month: toMonthStart(payload.month),
    categoryId: payload.categoryId || null,
    warningThreshold: payload.warningThreshold || 80,
  };

  await assertLedger(userId, normalized.ledgerId);
  await assertExpenseCategory(userId, normalized.categoryId);
  await assertNoDuplicateBudget(userId, normalized);

  const result = await db.query(
    `
      insert into budgets (
        user_id,
        ledger_id,
        category_id,
        month,
        limit_amount_vnd,
        warning_threshold
      )
      values ($1, $2, $3, $4, $5, $6)
      returning id
    `,
    [
      userId,
      normalized.ledgerId,
      normalized.categoryId,
      normalized.month,
      normalized.limitAmountVnd,
      normalized.warningThreshold,
    ]
  );

  await evaluateBudgetAlertsForBudgetId(userId, result.rows[0].id);

  return getBudgetWithProgress(userId, result.rows[0].id);
}

async function updateBudget(userId, budgetId, payload) {
  const existing = await findBudgetById(userId, budgetId);

  if (!existing) {
    throw notFoundError();
  }

  const result = await db.query(
    `
      update budgets
      set limit_amount_vnd = coalesce($3, limit_amount_vnd),
          warning_threshold = coalesce($4, warning_threshold)
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning id
    `,
    [
      userId,
      budgetId,
      payload.limitAmountVnd || null,
      payload.warningThreshold || null,
    ]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  await evaluateBudgetAlertsForBudgetId(userId, budgetId);

  return getBudgetWithProgress(userId, budgetId);
}

async function deleteBudget(userId, budgetId) {
  const result = await db.query(
    `
      update budgets
      set deleted_at = now()
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning id
    `,
    [userId, budgetId]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  return { id: budgetId };
}

async function evaluateBudgetAlertsForBudgetId(userId, budgetId, client) {
  const executor = getExecutor(client);

  const result = await executor.query(
    `
      with budget_status as (
        select
          b.id,
          b.user_id,
          b.ledger_id,
          b.category_id,
          b.month,
          b.limit_amount_vnd,
          b.warning_threshold,
          coalesce(spent.spent_amount_vnd, 0) as spent_amount_vnd
        from budgets b
        left join lateral (
          select sum(t.amount_vnd) as spent_amount_vnd
          from transactions t
          where t.user_id = b.user_id
            and t.ledger_id = b.ledger_id
            and t.deleted_at is null
            and t.type = 'expense'
            and t.transaction_date >= b.month
            and t.transaction_date < b.month + interval '1 month'
            and (
              b.category_id is null
              or t.category_id = b.category_id
              or t.subcategory_id = b.category_id
            )
        ) spent on true
        where b.user_id = $1
          and b.id = $2
          and b.deleted_at is null
      ),
      thresholds as (
        select distinct threshold
        from budget_status
        cross join lateral (
          values (warning_threshold), (100)
        ) as threshold_values(threshold)
      )
      insert into notification_events (
        user_id,
        type,
        title,
        body,
        payload,
        event_key
      )
      select
        b.user_id,
        'budget_threshold',
        'Canh bao ngan sach',
        'Ngan sach cua ban da vuot nguong ' || t.threshold || '%',
        jsonb_build_object(
          'budgetId', b.id,
          'ledgerId', b.ledger_id,
          'categoryId', b.category_id,
          'month', to_char(b.month, 'YYYY-MM'),
          'threshold', t.threshold,
          'spentAmountVnd', b.spent_amount_vnd,
          'limitAmountVnd', b.limit_amount_vnd
        ),
        'budget_threshold:' || b.id::text || ':' || to_char(b.month, 'YYYY-MM') || ':' || t.threshold::text
      from budget_status b
      join user_settings s
        on s.user_id = b.user_id
       and s.budget_warning_enabled = true
      join thresholds t on true
      where b.spent_amount_vnd * 100 >= b.limit_amount_vnd * t.threshold
      on conflict (user_id, event_key) where event_key is not null do nothing
      returning ${notificationRepository.NOTIFICATION_FIELDS}
    `,
    [userId, budgetId]
  );

  if (!client) {
    await notificationRepository.sendEvents(result.rows);
  }
}

async function evaluateBudgetAlertsForTransaction(userId, transaction, client) {
  if (!transaction || transaction.type !== 'expense') return;

  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select id
      from budgets
      where user_id = $1
        and ledger_id = $2
        and month = $3::date
        and deleted_at is null
        and (
          category_id is null
          or category_id = $4::uuid
          or category_id is not distinct from $5::uuid
        )
    `,
    [
      userId,
      transaction.ledgerId,
      monthStartForDate(transaction.transactionDate),
      transaction.categoryId,
      transaction.subcategoryId || null,
    ]
  );

  for (const budget of result.rows) {
    await evaluateBudgetAlertsForBudgetId(userId, budget.id, client);
  }
}

module.exports = {
  createBudget,
  deleteBudget,
  evaluateBudgetAlertsForBudgetId,
  evaluateBudgetAlertsForTransaction,
  listBudgets,
  updateBudget,
};
