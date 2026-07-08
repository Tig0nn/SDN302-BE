const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const userRepository = require('../modules/users/userRepository');

const originalQuery = db.query;

const userId = '11111111-1111-4111-8111-111111111111';
const ledgerId = '22222222-2222-4222-8222-222222222222';

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function user(overrides = {}) {
  return {
    id: userId,
    googleSub: 'google-sub',
    email: 'user@example.com',
    displayName: 'User Example',
    avatarUrl: 'https://example.com/avatar.png',
    emailVerifiedAt: '2026-06-01T00:00:00.000Z',
    locale: 'vi-VN',
    timezone: 'Asia/Ho_Chi_Minh',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function installQueryHandler(handler) {
  db.query = async function fakeQuery(sql, params = []) {
    return handler(normalizeSql(sql), params);
  };
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
});

test('upsertGoogleUser updates an existing Google user first', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update users') && sql.includes('where google_sub = $1')) {
      assert.equal(params[0], 'google-sub');
      assert.equal(params[1], 'user@example.com');
      assert.equal(params[2], 'User Example');
      assert.equal(params[3], 'https://example.com/avatar.png');

      return {
        rowCount: 1,
        rows: [user()],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await userRepository.upsertGoogleUser({
    googleSub: 'google-sub',
    email: 'USER@example.com',
    displayName: 'User Example',
    avatarUrl: 'https://example.com/avatar.png',
    emailAuthoritative: true,
  });

  assert.equal(result.id, userId);
});

test('upsertGoogleUser rejects non-authoritative Google email conflicts', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update users') && sql.includes('where google_sub = $1')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('insert into users') && sql.includes('on conflict (email) do nothing')) {
      assert.equal(params[1], 'conflict@example.com');

      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  await assert.rejects(
    () =>
      userRepository.upsertGoogleUser({
        googleSub: 'google-sub',
        email: 'Conflict@example.com',
        displayName: 'Conflict',
        avatarUrl: null,
        emailAuthoritative: false,
      }),
    {
      code: 'GOOGLE_EMAIL_LINK_REQUIRED',
      status: 409,
    }
  );
});

test('upsertGoogleUser links authoritative emails and reports linked-account conflicts', async function () {
  let conflict = false;

  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update users') && sql.includes('where google_sub = $1')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('on conflict (email) do update')) {
      assert.equal(params[0], 'google-sub');
      assert.equal(params[1], 'user@example.com');

      if (conflict) {
        return { rowCount: 0, rows: [] };
      }

      conflict = true;
      return {
        rowCount: 1,
        rows: [user()],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const linked = await userRepository.upsertGoogleUser({
    googleSub: 'google-sub',
    email: 'USER@example.com',
    displayName: 'User Example',
    avatarUrl: null,
    emailAuthoritative: true,
  });

  assert.equal(linked.email, 'user@example.com');
  await assert.rejects(
    () =>
      userRepository.upsertGoogleUser({
        googleSub: 'google-sub',
        email: 'USER@example.com',
        displayName: 'User Example',
        avatarUrl: null,
        emailAuthoritative: true,
      }),
    {
      code: 'GOOGLE_EMAIL_CONFLICT',
      status: 409,
    }
  );
});

test('email-password user creation and auth lookups normalize email values', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('insert into users') && sql.includes('password_hash')) {
      assert.equal(params[0], 'user@example.com');
      assert.equal(params[1], 'password-hash');
      assert.equal(params[2], 'User Example');

      return { rowCount: 1, rows: [user({ googleSub: null })] };
    }

    if (sql.includes('from users') && sql.includes('where id = $1')) {
      assert.equal(params[0], userId);

      return { rowCount: 1, rows: [user()] };
    }

    if (sql.includes('password_hash as "passwordhash"')) {
      assert.equal(params[0], 'user@example.com');

      return {
        rowCount: 1,
        rows: [user({ passwordHash: 'password-hash' })],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const created = await userRepository.createOrUpdateEmailPasswordUser({
    email: 'USER@example.com',
    passwordHash: 'password-hash',
    displayName: 'User Example',
  });
  const foundById = await userRepository.findUserById(userId);
  const foundForAuth = await userRepository.findUserByEmailForAuth('USER@example.com');

  assert.equal(created.email, 'user@example.com');
  assert.equal(foundById.id, userId);
  assert.equal(foundForAuth.passwordHash, 'password-hash');
});

test('profile, settings, and default ledger helpers map nullable rows', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('update users') && sql.includes('set display_name = coalesce')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], 'Updated User');
      assert.equal(params[2], null);
      assert.equal(params[3], 'en-US');
      assert.equal(params[4], 'UTC');

      return {
        rowCount: 1,
        rows: [user({ displayName: 'Updated User', locale: 'en-US', timezone: 'UTC' })],
      };
    }

    if (sql.includes('from user_settings')) {
      assert.equal(params[0], userId);

      return {
        rowCount: 1,
        rows: [
          {
            theme: 'system',
            dailyReminderEnabled: true,
            budgetWarningEnabled: true,
            debtReminderEnabled: false,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    if (sql.includes('update user_settings')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], 'dark');
      assert.equal(params[2], false);
      assert.equal(params[3], true);
      assert.equal(params[4], true);

      return {
        rowCount: 1,
        rows: [
          {
            theme: 'dark',
            dailyReminderEnabled: false,
            budgetWarningEnabled: true,
            debtReminderEnabled: true,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      };
    }

    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userId);

      return {
        rowCount: 1,
        rows: [{ id: ledgerId, name: 'Main ledger', isDefault: true }],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const profile = await userRepository.updateUserProfile(userId, {
    displayName: 'Updated User',
    avatarUrl: null,
    locale: 'en-US',
    timezone: 'UTC',
  });
  const settings = await userRepository.getUserSettings(userId);
  const updatedSettings = await userRepository.updateUserSettings(userId, {
    theme: 'dark',
    dailyReminderEnabled: false,
    budgetWarningEnabled: true,
    debtReminderEnabled: true,
  });
  const defaultLedger = await userRepository.getDefaultLedger(userId);

  assert.equal(profile.displayName, 'Updated User');
  assert.equal(settings.theme, 'system');
  assert.equal(updatedSettings.dailyReminderEnabled, false);
  assert.equal(defaultLedger.id, ledgerId);
});
