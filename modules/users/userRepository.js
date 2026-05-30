const db = require('../../config/db');

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
    const err = new Error('Email is already linked to another Google account');

    err.code = 'GOOGLE_EMAIL_CONFLICT';
    err.status = 409;
    throw err;
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

async function ensureDefaultUserData(userId) {
  await db.query(
    `
      insert into user_settings (user_id)
      values ($1)
      on conflict (user_id) do nothing
    `,
    [userId]
  );

  const ledger = await db.query(
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
    await db.query(
      `
        insert into ledgers (user_id, name, is_default)
        values ($1, 'Sổ Chính', true)
      `,
      [userId]
    );
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
  ensureDefaultUserData,
  getUserSettings,
  updateUserSettings,
  getDefaultLedger,
};
