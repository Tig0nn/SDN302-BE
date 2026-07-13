const db = require('../../config/db');
const { systemCategories, paymentAccounts } = require('../../db/seed-data/system');

const USER_FIELDS = `
  id,
  google_sub as "googleSub",
  email,
  display_name as "displayName",
  avatar_url as "avatarUrl",
  email_verified_at as "emailVerifiedAt",
  locale,
  timezone,
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function createGoogleEmailConflict(message, code = 'GOOGLE_EMAIL_CONFLICT') {
  const err = new Error(message);

  err.code = code;
  err.status = 409;
  return err;
}

async function upsertGoogleUser(profile) {
  const existing = await db.query(
    `
      update users
      set email = $2,
          display_name = $3,
          avatar_url = $4,
          email_verified_at = coalesce(email_verified_at, now())
      where google_sub = $1
      returning ${USER_FIELDS}
    `,
    [
      profile.googleSub,
      profile.email.toLowerCase(),
      profile.displayName,
      profile.avatarUrl,
    ]
  );

  if (existing.rowCount > 0) {
    return existing.rows[0];
  }

  if (!profile.emailAuthoritative) {
    const result = await db.query(
      `
        insert into users (google_sub, email, display_name, avatar_url, email_verified_at)
        values ($1, $2, $3, $4, now())
        on conflict (email) do nothing
        returning ${USER_FIELDS}
      `,
      [
        profile.googleSub,
        profile.email.toLowerCase(),
        profile.displayName,
        profile.avatarUrl,
      ]
    );

    if (result.rowCount === 0) {
      throw createGoogleEmailConflict(
        'Google email requires explicit account linking before it can be used with an existing account',
        'GOOGLE_EMAIL_LINK_REQUIRED'
      );
    }

    return result.rows[0];
  }

  const result = await db.query(
    `
      insert into users (google_sub, email, display_name, avatar_url, email_verified_at)
      values ($1, $2, $3, $4, now())
      on conflict (email)
      do update set
        google_sub = coalesce(users.google_sub, excluded.google_sub),
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        email_verified_at = coalesce(users.email_verified_at, now())
      where users.google_sub is null
         or users.google_sub = excluded.google_sub
      returning ${USER_FIELDS}
    `,
    [
      profile.googleSub,
      profile.email.toLowerCase(),
      profile.displayName,
      profile.avatarUrl,
    ]
  );

  if (result.rowCount === 0) {
    throw createGoogleEmailConflict('Email is already linked to another Google account');
  }

  return result.rows[0];
}

async function createOrUpdateEmailPasswordUser({ email, passwordHash, displayName }) {
  const result = await db.query(
    `
      insert into users (
        email,
        password_hash,
        display_name,
        email_verified_at,
        password_updated_at
      )
      values ($1, $2, $3, now(), now())
      on conflict (email)
      do update set
        password_hash = excluded.password_hash,
        display_name = coalesce(excluded.display_name, users.display_name),
        email_verified_at = now(),
        password_updated_at = now()
      returning ${USER_FIELDS}
    `,
    [email.toLowerCase(), passwordHash, displayName || null]
  );

  return result.rows[0];
}

async function findUserById(userId) {
  const result = await db.query(
    `
      select ${USER_FIELDS}
      from users
      where id = $1
      limit 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function findUserByEmailForAuth(email) {
  const result = await db.query(
    `
      select
        ${USER_FIELDS},
        password_hash as "passwordHash"
      from users
      where email = $1
      limit 1
    `,
    [email.toLowerCase()]
  );

  return result.rows[0] || null;
}

async function updateUserProfile(userId, updates) {
  const result = await db.query(
    `
      update users
      set display_name = coalesce($2, display_name),
          avatar_url = coalesce($3, avatar_url),
          locale = coalesce($4, locale),
          timezone = coalesce($5, timezone)
      where id = $1
      returning ${USER_FIELDS}
    `,
    [
      userId,
      updates.displayName || null,
      updates.avatarUrl || null,
      updates.locale || null,
      updates.timezone || null,
    ]
  );

  return result.rows[0] || null;
}

async function updatePasswordHash(userId, passwordHash) {
  const result = await db.query(
    `
      update users
      set password_hash = $2,
          password_updated_at = now()
      where id = $1
      returning ${USER_FIELDS}
    `,
    [userId, passwordHash]
  );

  return result.rows[0] || null;
}

async function ensureUserSettings(client, userId) {
  await client.query(
    `
      insert into user_settings (user_id)
      values ($1)
      on conflict (user_id) do nothing
    `,
    [userId]
  );
}

async function ensureDefaultLedger(client, userId) {
  const ledger = await client.query(
    `
      select id
      from ledgers
      where user_id = $1
        and is_default = true
        and deleted_at is null
      limit 1
    `,
    [userId]
  );

  if (ledger.rowCount === 0) {
    await client.query(
      `
        insert into ledgers (user_id, name, is_default)
        values ($1, 'Sổ Chính', true)
      `,
      [userId]
    );
  }
}

async function upsertDefaultCategory(client, userId, category) {
  const existing = await client.query(
    `
      select id
      from categories
      where user_id = $1
        and type = $2
        and name = $3
        and parent_id is not distinct from $4
        and deleted_at is null
      limit 1
    `,
    [userId, category.type, category.name, category.parentId || null]
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
        user_id,
        type,
        name,
        parent_id,
        icon,
        color,
        is_system,
        sort_order
      )
      values ($1, $2, $3, $4, $5, $6, true, $7)
      returning id
    `,
    [
      userId,
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

async function ensureDefaultCategories(client, userId) {
  for (const group of systemCategories) {
    for (let parentIndex = 0; parentIndex < group.categories.length; parentIndex += 1) {
      const parent = group.categories[parentIndex];
      const parentId = await upsertDefaultCategory(client, userId, {
        type: group.type,
        name: parent.name,
        icon: parent.icon,
        color: parent.color,
        sortOrder: parentIndex,
      });

      for (let childIndex = 0; childIndex < parent.subcategories.length; childIndex += 1) {
        const child = parent.subcategories[childIndex];

        await upsertDefaultCategory(client, userId, {
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

async function ensureDefaultPaymentAccounts(client, userId) {
  for (let index = 0; index < paymentAccounts.length; index += 1) {
    const account = paymentAccounts[index];
    const existing = await client.query(
      `
        select id
        from payment_accounts
        where user_id = $1
          and name = $2
          and deleted_at is null
        limit 1
      `,
      [userId, account.name]
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
          user_id,
          name,
          short_name,
          type,
          color,
          is_system,
          sort_order
        )
        values ($1, $2, $3, $4, $5, true, $6)
      `,
      [
        userId,
        account.name,
        account.shortName,
        account.type,
        account.color,
        index,
      ]
    );
  }
}

async function ensureDefaultUserData(userId) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');
    await ensureUserSettings(client, userId);
    await ensureDefaultLedger(client, userId);
    await ensureDefaultCategories(client, userId);
    await ensureDefaultPaymentAccounts(client, userId);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function getUserSettings(userId) {
  const result = await db.query(
    `
      select
        theme,
        daily_reminder_enabled as "dailyReminderEnabled",
        budget_warning_enabled as "budgetWarningEnabled",
        debt_reminder_enabled as "debtReminderEnabled",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from user_settings
      where user_id = $1
      limit 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function updateUserSettings(userId, updates) {
  const result = await db.query(
    `
      update user_settings
      set theme = coalesce($2, theme),
          daily_reminder_enabled = coalesce($3, daily_reminder_enabled),
          budget_warning_enabled = coalesce($4, budget_warning_enabled),
          debt_reminder_enabled = coalesce($5, debt_reminder_enabled)
      where user_id = $1
      returning
        theme,
        daily_reminder_enabled as "dailyReminderEnabled",
        budget_warning_enabled as "budgetWarningEnabled",
        debt_reminder_enabled as "debtReminderEnabled",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      userId,
      updates.theme || null,
      updates.dailyReminderEnabled,
      updates.budgetWarningEnabled,
      updates.debtReminderEnabled,
    ]
  );

  return result.rows[0] || null;
}

async function getDefaultLedger(userId) {
  const result = await db.query(
    `
      select id, name, is_default as "isDefault"
      from ledgers
      where user_id = $1
        and is_default = true
        and deleted_at is null
      limit 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

module.exports = {
  upsertGoogleUser,
  createOrUpdateEmailPasswordUser,
  findUserById,
  findUserByEmailForAuth,
  updateUserProfile,
  updatePasswordHash,
  ensureDefaultUserData,
  getUserSettings,
  updateUserSettings,
  getDefaultLedger,
};
