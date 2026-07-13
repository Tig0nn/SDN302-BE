const db = require('../../config/db');
const { paymentAccounts: systemPaymentAccounts } = require('../../db/seed-data/system');

const PAYMENT_ACCOUNT_FIELDS = `
  id,
  user_id as "userId",
  name,
  short_name as "shortName",
  type,
  color,
  is_system as "isSystem",
  sort_order as "sortOrder",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

const RESERVED_ACCOUNT_NAMES = new Set(
  systemPaymentAccounts.map((account) => account.name.toLowerCase())
);

function notFoundError() {
  const err = new Error('Payment account not found');

  err.code = 'PAYMENT_ACCOUNT_NOT_FOUND';
  err.status = 404;
  return err;
}

function systemAccountError() {
  const err = new Error('System payment accounts cannot be modified');

  err.code = 'SYSTEM_PAYMENT_ACCOUNT_READ_ONLY';
  err.status = 403;
  return err;
}

function reservedNameError() {
  const err = new Error('This name is reserved for a system payment account');

  err.code = 'RESERVED_PAYMENT_ACCOUNT_NAME';
  err.status = 409;
  return err;
}

function duplicateAccountError() {
  const err = new Error('Payment account already exists');

  err.code = 'PAYMENT_ACCOUNT_ALREADY_EXISTS';
  err.status = 409;
  return err;
}

async function listPaymentAccounts(userId) {
  const result = await db.query(
    `
      select ${PAYMENT_ACCOUNT_FIELDS}
      from payment_accounts p
      where p.deleted_at is null
        and (
          p.user_id = $1
          or (
            p.user_id is null
            and not exists (
              select 1
              from payment_accounts user_account
              where user_account.user_id = $1
                and user_account.name = p.name
                and user_account.deleted_at is null
            )
          )
        )
      order by p.type asc, p.sort_order asc, p.name asc
    `,
    [userId]
  );

  return result.rows;
}

async function findPaymentAccountForUser(userId, accountId) {
  const result = await db.query(
    `
      select ${PAYMENT_ACCOUNT_FIELDS}
      from payment_accounts
      where id = $2
        and user_id = $1
        and deleted_at is null
      limit 1
    `,
    [userId, accountId]
  );

  return result.rows[0] || null;
}

async function assertAvailableName(userId, name, excludeAccountId) {
  if (RESERVED_ACCOUNT_NAMES.has(name.toLowerCase())) {
    throw reservedNameError();
  }

  const result = await db.query(
    `
      select id
      from payment_accounts
      where user_id = $1
        and lower(name) = lower($2)
        and deleted_at is null
        and ($3::uuid is null or id <> $3)
      limit 1
    `,
    [userId, name, excludeAccountId || null]
  );

  if (result.rowCount > 0) {
    throw duplicateAccountError();
  }
}

async function createPaymentAccount(userId, payload) {
  await assertAvailableName(userId, payload.name);

  const result = await db.query(
    `
      insert into payment_accounts (
        user_id,
        name,
        short_name,
        type,
        color,
        is_system,
        sort_order
      )
      values (
        $1, $2, $3, $4, $5, false,
        (select coalesce(max(sort_order), -1) + 1 from payment_accounts where user_id = $1)
      )
      returning ${PAYMENT_ACCOUNT_FIELDS}
    `,
    [userId, payload.name, payload.shortName || null, payload.type, payload.color || null]
  );

  return result.rows[0];
}

async function updatePaymentAccount(userId, accountId, payload) {
  const account = await findPaymentAccountForUser(userId, accountId);

  if (!account) {
    throw notFoundError();
  }

  if (account.isSystem) {
    throw systemAccountError();
  }

  if (payload.name) {
    await assertAvailableName(userId, payload.name, accountId);
  }

  const result = await db.query(
    `
      update payment_accounts
      set name = coalesce($3, name),
          short_name = case when $4 then $5 else short_name end,
          color = case when $6 then $7 else color end
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning ${PAYMENT_ACCOUNT_FIELDS}
    `,
    [
      userId,
      accountId,
      payload.name || null,
      Object.prototype.hasOwnProperty.call(payload, 'shortName'),
      payload.shortName || null,
      Object.prototype.hasOwnProperty.call(payload, 'color'),
      payload.color || null,
    ]
  );

  return result.rows[0];
}

async function deletePaymentAccount(userId, accountId) {
  const account = await findPaymentAccountForUser(userId, accountId);

  if (!account) {
    throw notFoundError();
  }

  if (account.isSystem) {
    throw systemAccountError();
  }

  const result = await db.query(
    `
      update payment_accounts
      set deleted_at = now()
      where user_id = $1
        and id = $2
        and deleted_at is null
        and is_system = false
      returning ${PAYMENT_ACCOUNT_FIELDS}
    `,
    [userId, accountId]
  );

  return result.rows[0];
}

module.exports = {
  listPaymentAccounts,
  createPaymentAccount,
  updatePaymentAccount,
  deletePaymentAccount,
};
