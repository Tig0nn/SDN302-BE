const db = require('../../config/db');

const LEDGER_FIELDS = `
  id,
  name,
  is_default as "isDefault",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function notFoundError() {
  const err = new Error('Ledger not found');

  err.code = 'LEDGER_NOT_FOUND';
  err.status = 404;
  return err;
}

function lastLedgerError() {
  const err = new Error('Cannot delete the last ledger');

  err.code = 'LAST_LEDGER_DELETE_NOT_ALLOWED';
  err.status = 409;
  return err;
}

async function listLedgers(userId) {
  const result = await db.query(
    `
      select ${LEDGER_FIELDS}
      from ledgers
      where user_id = $1
        and deleted_at is null
      order by is_default desc, created_at asc, name asc
    `,
    [userId]
  );

  return result.rows;
}

async function createLedger(userId, payload) {
  const result = await db.query(
    `
      insert into ledgers (user_id, name, is_default)
      select
        $1,
        $2,
        not exists (
          select 1
          from ledgers
          where user_id = $1
            and is_default = true
            and deleted_at is null
        )
      returning ${LEDGER_FIELDS}
    `,
    [userId, payload.name]
  );

  return result.rows[0];
}

async function updateLedger(userId, ledgerId, payload) {
  const result = await db.query(
    `
      update ledgers
      set name = $3
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning ${LEDGER_FIELDS}
    `,
    [userId, ledgerId, payload.name]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  return result.rows[0];
}

async function deleteLedger(userId, ledgerId) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const ledger = await client.query(
      `
        select id, is_default as "isDefault"
        from ledgers
        where user_id = $1
          and id = $2
          and deleted_at is null
        for update
      `,
      [userId, ledgerId]
    );

    if (ledger.rowCount === 0) {
      throw notFoundError();
    }

    const count = await client.query(
      `
        select count(*)::int as count
        from ledgers
        where user_id = $1
          and deleted_at is null
      `,
      [userId]
    );

    if (count.rows[0].count <= 1) {
      throw lastLedgerError();
    }

    const deleted = await client.query(
      `
        update ledgers
        set deleted_at = now(),
            is_default = false
        where user_id = $1
          and id = $2
          and deleted_at is null
        returning ${LEDGER_FIELDS}
      `,
      [userId, ledgerId]
    );

    if (ledger.rows[0].isDefault) {
      await client.query(
        `
          update ledgers
          set is_default = true
          where id = (
            select id
            from ledgers
            where user_id = $1
              and deleted_at is null
            order by created_at asc
            limit 1
          )
            and not exists (
              select 1
              from ledgers
              where user_id = $1
                and is_default = true
                and deleted_at is null
            )
        `,
        [userId]
      );
    }

    await client.query('commit');
    return deleted.rows[0];
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createLedger,
  deleteLedger,
  listLedgers,
  updateLedger,
};
