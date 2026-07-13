const db = require('../../config/db');

function invalidLedgerError() {
  const err = new Error('Ledger not found');

  err.code = 'INVALID_LEDGER';
  err.status = 400;
  return err;
}

async function assertLedger(userId, ledgerId) {
  const result = await db.query(
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

function baseFilterParams(userId, filters) {
  return [
    userId,
    filters.ledgerId,
    filters.dateFrom || null,
    filters.dateTo || null,
  ];
}

function mapOverview(row) {
  return {
    totalIncomeVnd: Number(row.totalIncomeVnd || 0),
    totalExpenseVnd: Number(row.totalExpenseVnd || 0),
    balanceVnd: Number(row.balanceVnd || 0),
    transactionCount: Number(row.transactionCount || 0),
  };
}

function mapCategoryBreakdown(row) {
  return {
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    totalAmountVnd: Number(row.totalAmountVnd || 0),
    transactionCount: Number(row.transactionCount || 0),
    percentage: Number(row.percentage || 0),
  };
}

function mapDailySpending(row) {
  return {
    date: row.date,
    totalExpenseVnd: Number(row.totalExpenseVnd || 0),
    transactionCount: Number(row.transactionCount || 0),
  };
}

function mapMonthlyTrend(row) {
  return {
    month: row.month,
    totalIncomeVnd: Number(row.totalIncomeVnd || 0),
    totalExpenseVnd: Number(row.totalExpenseVnd || 0),
    balanceVnd: Number(row.balanceVnd || 0),
    transactionCount: Number(row.transactionCount || 0),
  };
}

function mapDailyTrend(row) {
  return {
    date: row.date,
    totalIncomeVnd: Number(row.totalIncomeVnd || 0),
    totalExpenseVnd: Number(row.totalExpenseVnd || 0),
    balanceVnd: Number(row.balanceVnd || 0),
    transactionCount: Number(row.transactionCount || 0),
  };
}

function mapFluctuation(row) {
  return {
    date: row.date,
    totalExpenseVnd: Number(row.totalExpenseVnd || 0),
    previousExpenseVnd:
      row.previousExpenseVnd === null || row.previousExpenseVnd === undefined
        ? null
        : Number(row.previousExpenseVnd),
    changeVnd:
      row.changeVnd === null || row.changeVnd === undefined
        ? null
        : Number(row.changeVnd),
    changePercent:
      row.changePercent === null || row.changePercent === undefined
        ? null
        : Number(row.changePercent),
  };
}

async function getOverview(userId, filters) {
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
    baseFilterParams(userId, filters)
  );

  return mapOverview(result.rows[0]);
}

async function getCategoryBreakdown(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const result = await db.query(
    `
      with grouped as (
        select
          category_id as "categoryId",
          category_name_snapshot as "categoryName",
          sum(amount_vnd) as "totalAmountVnd",
          count(*)::int as "transactionCount"
        from transactions
        where user_id = $1
          and ledger_id = $2
          and deleted_at is null
          and type = $3
          and ($4::date is null or transaction_date >= $4::date)
          and ($5::date is null or transaction_date <= $5::date)
        group by category_id, category_name_snapshot
      )
      select
        "categoryId",
        "categoryName",
        "totalAmountVnd",
        "transactionCount",
        case
          when sum("totalAmountVnd") over () = 0 then 0
          else round(("totalAmountVnd"::numeric / sum("totalAmountVnd") over ()) * 100, 2)
        end as percentage
      from grouped
      order by "totalAmountVnd" desc, "categoryName" asc
      limit $6
    `,
    [
      userId,
      filters.ledgerId,
      filters.type || 'expense',
      filters.dateFrom || null,
      filters.dateTo || null,
      filters.limit || 10,
    ]
  );

  return result.rows.map(mapCategoryBreakdown);
}

async function getDailySpending(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const result = await db.query(
    `
      select
        transaction_date::text as date,
        sum(amount_vnd) as "totalExpenseVnd",
        count(*)::int as "transactionCount"
      from transactions
      where user_id = $1
        and ledger_id = $2
        and deleted_at is null
        and type = 'expense'
        and ($3::date is null or transaction_date >= $3::date)
        and ($4::date is null or transaction_date <= $4::date)
      group by transaction_date
      order by transaction_date asc
    `,
    baseFilterParams(userId, filters)
  );

  return result.rows.map(mapDailySpending);
}

async function getMonthlyTrend(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const result = await db.query(
    `
      select
        date_trunc('month', transaction_date)::date::text as month,
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
      group by date_trunc('month', transaction_date)::date
      order by date_trunc('month', transaction_date)::date asc
    `,
    baseFilterParams(userId, filters)
  );

  return result.rows.map(mapMonthlyTrend);
}

async function getDailyTrend(userId, filters) {
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
        and ($3::date is null or transaction_date >= $3::date)
        and ($4::date is null or transaction_date <= $4::date)
      group by transaction_date
      order by transaction_date asc
    `,
    baseFilterParams(userId, filters)
  );

  return result.rows.map(mapDailyTrend);
}

async function getFluctuation(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const result = await db.query(
    `
      with daily as (
        select
          transaction_date::text as date,
          sum(amount_vnd) as "totalExpenseVnd"
        from transactions
        where user_id = $1
          and ledger_id = $2
          and deleted_at is null
          and type = 'expense'
          and ($3::date is null or transaction_date >= $3::date)
          and ($4::date is null or transaction_date <= $4::date)
        group by transaction_date
      ),
      with_previous as (
        select
          date,
          "totalExpenseVnd",
          lag("totalExpenseVnd") over (order by date) as "previousExpenseVnd"
        from daily
      )
      select
        date,
        "totalExpenseVnd",
        "previousExpenseVnd",
        case
          when "previousExpenseVnd" is null then null
          else "totalExpenseVnd" - "previousExpenseVnd"
        end as "changeVnd",
        case
          when "previousExpenseVnd" is null or "previousExpenseVnd" = 0 then null
          else round((("totalExpenseVnd" - "previousExpenseVnd")::numeric / "previousExpenseVnd") * 100, 2)
        end as "changePercent"
      from with_previous
      order by date asc
    `,
    baseFilterParams(userId, filters)
  );

  return result.rows.map(mapFluctuation);
}

module.exports = {
  getCategoryBreakdown,
  getDailySpending,
  getDailyTrend,
  getFluctuation,
  getMonthlyTrend,
  getOverview,
};
