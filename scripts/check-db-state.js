const db = require('../config/db');

async function count(query) {
  const result = await db.query(query);

  return result.rows[0].count;
}

async function main() {
  const tablesResult = await db.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name in (
        'users',
        'sessions',
        'email_verification_otps',
        'user_settings',
        'ledgers',
        'categories',
        'payment_accounts',
        'transactions',
        'budgets',
        'goals',
        'debts',
        'debt_payments',
        'challenges',
        'challenge_checkins',
        'shopping_plans',
        'shopping_items',
        'ai_conversations',
        'ai_messages',
        'import_jobs',
        'audit_events',
        'device_tokens',
        'notification_events',
        'schema_migrations'
      )
    order by table_name
  `);

  const state = {
    migrations: await count('select count(*)::int as count from schema_migrations'),
    parentCategories: await count(`
      select count(*)::int as count
      from categories
      where user_id is null
        and is_system = true
        and parent_id is null
        and deleted_at is null
    `),
    subcategories: await count(`
      select count(*)::int as count
      from categories
      where user_id is null
        and is_system = true
        and parent_id is not null
        and deleted_at is null
    `),
    paymentAccounts: await count(`
      select count(*)::int as count
      from payment_accounts
      where user_id is null
        and is_system = true
        and deleted_at is null
    `),
    tables: tablesResult.rows.map((row) => row.table_name),
  };

  console.log(JSON.stringify(state, null, 2));
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => db.closePool());
