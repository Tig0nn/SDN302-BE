const db = require('../../config/db');

const DEBT_FIELDS = `
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
  updated_at as "updatedAt"
`;

const DEBT_PAYMENT_FIELDS = `
  id,
  user_id as "userId",
  debt_id as "debtId",
  amount_vnd as "amountVnd",
  paid_at::text as "paidAt",
  note,
  created_at as "createdAt"
`;

function appError(code, message, status) {
  const err = new Error(message);

  err.code = code;
  err.status = status;
  return err;
}

function notFoundError() {
  return appError('DEBT_NOT_FOUND', 'Debt not found', 404);
}

function invalidLedgerError() {
  return appError('INVALID_LEDGER', 'Ledger not found', 400);
}

function invalidAmountError(message) {
  return appError('INVALID_DEBT_AMOUNT', message, 400);
}

function overpaymentError() {
  return appError(
    'DEBT_PAYMENT_EXCEEDS_REMAINING',
    'Debt payment cannot exceed remaining amount',
    409
  );
}

function inactiveDebtError() {
  return appError('DEBT_INACTIVE', 'Cancelled debts cannot receive payments', 409);
}

function getExecutor(client) {
  return client || db;
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function mapDebt(row) {
  if (!row) return null;

  return {
    ...row,
    amountVnd: Number(row.amountVnd),
    remainingAmountVnd: Number(row.remainingAmountVnd),
    dueDate: row.dueDate || null,
    note: row.note || null,
  };
}

function mapDebtPayment(row) {
  if (!row) return null;

  return {
    ...row,
    amountVnd: Number(row.amountVnd),
    note: row.note || null,
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

async function markOverdueDebts(userId, client) {
  const executor = getExecutor(client);

  await executor.query(
    `
      update debts
      set status = 'overdue'
      where user_id = $1
        and deleted_at is null
        and status = 'active'
        and remaining_amount_vnd > 0
        and due_date is not null
        and due_date < current_date
    `,
    [userId]
  );
}

async function listDebts(userId, filters) {
  await assertLedger(userId, filters.ledgerId);
  await markOverdueDebts(userId);

  const result = await db.query(
    `
      select ${DEBT_FIELDS}
      from debts
      where user_id = $1
        and ledger_id = $2
        and deleted_at is null
        and ($3::text is null or status = $3)
      order by
        case status
          when 'active' then 1
          when 'overdue' then 2
          when 'paid' then 3
          else 4
        end,
        due_date nulls last,
        created_at desc
    `,
    [userId, filters.ledgerId, filters.status || null]
  );

  return result.rows.map(mapDebt);
}

async function createDebt(userId, payload) {
  await assertLedger(userId, payload.ledgerId);

  const result = await db.query(
    `
      insert into debts (
        user_id,
        ledger_id,
        direction,
        counterparty_name,
        amount_vnd,
        remaining_amount_vnd,
        due_date,
        note,
        status
      )
      values (
        $1, $2, $3, $4, $5, $5, $6, $7,
        case
          when $6::date is not null and $6::date < current_date then 'overdue'
          else 'active'
        end
      )
      returning ${DEBT_FIELDS}
    `,
    [
      userId,
      payload.ledgerId,
      payload.direction,
      payload.counterpartyName,
      payload.amountVnd,
      payload.dueDate || null,
      payload.note || null,
    ]
  );

  return mapDebt(result.rows[0]);
}

async function updateDebt(userId, debtId, payload) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const existingResult = await client.query(
      `
        select ${DEBT_FIELDS}
        from debts
        where user_id = $1
          and id = $2
          and deleted_at is null
        for update
      `,
      [userId, debtId]
    );

    if (existingResult.rowCount === 0) {
      throw notFoundError();
    }

    const existing = mapDebt(existingResult.rows[0]);

    if (payload.ledgerId && payload.ledgerId !== existing.ledgerId) {
      await assertLedger(userId, payload.ledgerId, client);
    }

    const nextAmount = hasOwn(payload, 'amountVnd')
      ? payload.amountVnd
      : existing.amountVnd;
    let nextRemaining = hasOwn(payload, 'remainingAmountVnd')
      ? payload.remainingAmountVnd
      : existing.remainingAmountVnd;

    if (payload.status === 'paid') {
      nextRemaining = 0;
    }

    if (nextRemaining > nextAmount) {
      throw invalidAmountError('Remaining amount cannot exceed total amount');
    }

    const updatedResult = await client.query(
      `
        update debts
        set ledger_id = $3,
            direction = coalesce($4, direction),
            counterparty_name = coalesce($5, counterparty_name),
            amount_vnd = $6,
            remaining_amount_vnd = $7,
            due_date = case when $8 then $9::date else due_date end,
            note = case when $10 then $11 else note end,
            status = case
              when $12 = 'cancelled' then 'cancelled'
              when $7::bigint = 0 then 'paid'
              when (case when $8 then $9::date else due_date end) is not null
                and (case when $8 then $9::date else due_date end) < current_date
                then 'overdue'
              else 'active'
            end
        where user_id = $1
          and id = $2
          and deleted_at is null
        returning ${DEBT_FIELDS}
      `,
      [
        userId,
        debtId,
        payload.ledgerId || existing.ledgerId,
        payload.direction || null,
        payload.counterpartyName || null,
        nextAmount,
        nextRemaining,
        hasOwn(payload, 'dueDate'),
        payload.dueDate || null,
        hasOwn(payload, 'note'),
        payload.note || null,
        payload.status || null,
      ]
    );

    await client.query('commit');
    return mapDebt(updatedResult.rows[0]);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function payDebt(userId, debtId, payload) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const existingResult = await client.query(
      `
        select ${DEBT_FIELDS}
        from debts
        where user_id = $1
          and id = $2
          and deleted_at is null
        for update
      `,
      [userId, debtId]
    );

    if (existingResult.rowCount === 0) {
      throw notFoundError();
    }

    const existing = mapDebt(existingResult.rows[0]);

    if (existing.status === 'cancelled') {
      throw inactiveDebtError();
    }

    if (payload.amountVnd > existing.remainingAmountVnd) {
      throw overpaymentError();
    }

    const paymentResult = await client.query(
      `
        insert into debt_payments (
          user_id,
          debt_id,
          amount_vnd,
          paid_at,
          note
        )
        values ($1, $2, $3, $4, $5)
        returning ${DEBT_PAYMENT_FIELDS}
      `,
      [
        userId,
        debtId,
        payload.amountVnd,
        payload.paidAt,
        payload.note || null,
      ]
    );

    const nextRemaining = existing.remainingAmountVnd - payload.amountVnd;
    const debtResult = await client.query(
      `
        update debts
        set remaining_amount_vnd = $3,
            status = case
              when $3::bigint = 0 then 'paid'
              when due_date is not null and due_date < current_date then 'overdue'
              else 'active'
            end
        where user_id = $1
          and id = $2
          and deleted_at is null
        returning ${DEBT_FIELDS}
      `,
      [userId, debtId, nextRemaining]
    );

    await client.query('commit');
    return {
      debt: mapDebt(debtResult.rows[0]),
      payment: mapDebtPayment(paymentResult.rows[0]),
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteDebt(userId, debtId) {
  const result = await db.query(
    `
      update debts
      set deleted_at = now(),
          status = 'cancelled'
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning ${DEBT_FIELDS}
    `,
    [userId, debtId]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  return mapDebt(result.rows[0]);
}

module.exports = {
  createDebt,
  deleteDebt,
  listDebts,
  markOverdueDebts,
  payDebt,
  updateDebt,
};
