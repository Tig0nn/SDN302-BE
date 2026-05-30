const db = require('../config/db');
const { systemCategories, paymentAccounts } = require('../db/seed-data/system');

async function upsertCategory(client, category) {
  const existing = await client.query(
    `
      select id
      from categories
      where user_id is null
        and type = $1
        and name = $2
        and parent_id is not distinct from $3
        and deleted_at is null
      limit 1
    `,
    [category.type, category.name, category.parentId || null]
  );

  if (existing.rowCount > 0) {
    const id = existing.rows[0].id;

    await client.query(
      `
        update categories
        set icon = $2,
            color = $3,
            sort_order = $4,
            is_system = true,
            updated_at = now()
        where id = $1
      `,
      [id, category.icon || null, category.color || null, category.sortOrder]
    );

    return id;
  }

  const inserted = await client.query(
    `
      insert into categories (
        type,
        name,
        parent_id,
        icon,
        color,
        is_system,
        sort_order
      )
      values ($1, $2, $3, $4, $5, true, $6)
      returning id
    `,
    [
      category.type,
      category.name,
      category.parentId || null,
      category.icon || null,
      category.color || null,
      category.sortOrder,
    ]
  );

  return inserted.rows[0].id;
}

async function seedCategories(client) {
  for (const group of systemCategories) {
    for (let parentIndex = 0; parentIndex < group.categories.length; parentIndex += 1) {
      const parent = group.categories[parentIndex];
      const parentId = await upsertCategory(client, {
        type: group.type,
        name: parent.name,
        icon: parent.icon,
        color: parent.color,
        sortOrder: parentIndex,
      });

      for (let childIndex = 0; childIndex < parent.subcategories.length; childIndex += 1) {
        const child = parent.subcategories[childIndex];

        await upsertCategory(client, {
          type: group.type,
          name: child.name,
          parentId,
          icon: child.icon || parent.icon,
          color: child.color || parent.color,
          sortOrder: childIndex,
        });
      }
    }
  }
}

async function seedPaymentAccounts(client) {
  for (let index = 0; index < paymentAccounts.length; index += 1) {
    const account = paymentAccounts[index];

    const existing = await client.query(
      `
        select id
        from payment_accounts
        where user_id is null
          and name = $1
          and deleted_at is null
        limit 1
      `,
      [account.name]
    );

    if (existing.rowCount > 0) {
      await client.query(
        `
          update payment_accounts
          set short_name = $2,
              type = $3,
              color = $4,
              is_system = true,
              sort_order = $5,
              updated_at = now()
          where id = $1
        `,
        [
          existing.rows[0].id,
          account.shortName,
          account.type,
          account.color,
          index,
        ]
      );

      continue;
    }

    await client.query(
      `
        insert into payment_accounts (
          name,
          short_name,
          type,
          color,
          is_system,
          sort_order
        )
        values ($1, $2, $3, $4, true, $5)
      `,
      [account.name, account.shortName, account.type, account.color, index]
    );
  }
}

async function main() {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');
    await seedCategories(client);
    await seedPaymentAccounts(client);
    await client.query('commit');
    console.log('Seeded system categories and payment accounts.');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
    await db.closePool();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
