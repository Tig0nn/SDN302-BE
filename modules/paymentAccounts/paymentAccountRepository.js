const db = require('../../config/db');

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

module.exports = {
  listPaymentAccounts,
};
