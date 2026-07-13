const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const db = require('../config/db');
const env = require('../config/env');
const emailOtpRepository = require('../modules/auth/emailOtpRepository');
const sessionRepository = require('../modules/auth/sessionRepository');
const tokenService = require('../modules/auth/tokenService');
const otpService = require('../modules/auth/otpService');
const passwordService = require('../modules/auth/passwordService');
const emailService = require('../modules/auth/emailService');

const originalQuery = db.query;
const originalEnv = { ...env };
const originalFetch = global.fetch;
const originalConsoleInfo = console.info;
const originalCreateTransport = nodemailer.createTransport;

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function installQueryHandler(handler) {
  const queries = [];

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    queries.push({ sql: normalized, params });
    return handler(normalized, params);
  };

  return queries;
}

function restoreAll() {
  db.query = originalQuery;
  global.fetch = originalFetch;
  console.info = originalConsoleInfo;
  nodemailer.createTransport = originalCreateTransport;
  Object.assign(env, originalEnv);
}

test.afterEach(restoreAll);

test('email OTP repository creates, reads, increments, and consumes OTP rows', async function () {
  const otpId = '11111111-1111-4111-8111-111111111111';
  const expiresAt = new Date('2026-06-01T00:10:00.000Z');
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (
      sql.includes('update email_verification_otps') &&
      sql.includes('set consumed_at = now()') &&
      sql.includes('lower(email)')
    ) {
      assert.equal(params[0], 'User@Example.com');
      assert.equal(params[1], 'signup');

      return { rowCount: 1, rows: [] };
    }

    if (sql.includes('insert into email_verification_otps')) {
      assert.equal(params[0], null);
      assert.equal(params[1], 'user@example.com');
      assert.equal(params[2], 'signup');
      assert.equal(params[3], 'hash');
      assert.deepEqual(params[4], { displayName: 'User' });
      assert.equal(params[5], env.OTP_MAX_ATTEMPTS);
      assert.equal(params[6], expiresAt);

      return {
        rowCount: 1,
        rows: [
          {
            id: otpId,
            email: 'user@example.com',
            purpose: 'signup',
            expiresAt,
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    if (sql.includes('select id, user_id as "userid"') && sql.includes('expires_at > now()')) {
      assert.equal(params[0], 'USER@example.com');
      assert.equal(params[1], 'signup');

      return {
        rowCount: 1,
        rows: [
          {
            id: otpId,
            userId: null,
            email: 'user@example.com',
            purpose: 'signup',
            codeHash: 'hash',
            metadata: { displayName: 'User' },
            attempts: 0,
            maxAttempts: 5,
            expiresAt,
          },
        ],
      };
    }

    if (sql.includes('select id, user_id as "userid"') && sql.includes('order by created_at desc')) {
      assert.equal(params[0], 'user@example.com');
      assert.equal(params[1], 'signup');

      return {
        rowCount: 1,
        rows: [
          {
            id: otpId,
            userId: null,
            email: 'user@example.com',
            purpose: 'signup',
            metadata: { displayName: 'User' },
          },
        ],
      };
    }

    if (sql.includes('set attempts = attempts + 1')) {
      assert.equal(params[0], otpId);

      return { rowCount: 1, rows: [] };
    }

    if (sql.includes('where id = $1')) {
      assert.equal(params[0], otpId);

      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const created = await emailOtpRepository.createOtp({
    email: 'User@Example.com',
    purpose: 'signup',
    codeHash: 'hash',
    expiresAt,
    metadata: { displayName: 'User' },
  });
  const active = await emailOtpRepository.findActiveOtp('USER@example.com', 'signup');
  const latest = await emailOtpRepository.findLatestOtp('user@example.com', 'signup');

  await emailOtpRepository.incrementAttempts(otpId);
  await emailOtpRepository.consumeOtp(otpId);

  assert.equal(created.email, 'user@example.com');
  assert.equal(active.id, otpId);
  assert.equal(latest.metadata.displayName, 'User');
  assert.equal(queries.length, 6);
});

test('session repository hashes refresh tokens and rotates active sessions', async function () {
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const refreshToken = 'refresh-token';
  const expectedHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('insert into sessions')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], expectedHash);
      assert.ok(params[2] instanceof Date);

      return {
        rowCount: 1,
        rows: [{ id: sessionId, expiresAt: params[2] }],
      };
    }

    if (sql.includes('from sessions s')) {
      assert.equal(params[0], expectedHash);

      return {
        rowCount: 1,
        rows: [{ id: sessionId, userId, expiresAt: new Date('2026-07-01T00:00:00.000Z') }],
      };
    }

    if (sql.includes('set refresh_token_hash = $2')) {
      assert.equal(params[0], sessionId);
      assert.equal(params[1], expectedHash);
      assert.ok(params[2] instanceof Date);

      return {
        rowCount: 1,
        rows: [{ id: sessionId, expiresAt: params[2] }],
      };
    }

    if (sql.includes('set revoked_at = now()')) {
      assert.equal(params[0], expectedHash);

      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const created = await sessionRepository.createSession(userId, refreshToken);
  const active = await sessionRepository.findActiveSessionByRefreshToken(refreshToken);
  const rotated = await sessionRepository.rotateSession(sessionId, refreshToken);

  await sessionRepository.revokeSessionByRefreshToken(refreshToken);

  assert.equal(created.id, sessionId);
  assert.equal(active.userId, userId);
  assert.equal(rotated.id, sessionId);
});

test('token, OTP, and password services validate positive and negative paths', async function () {
  const appUser = {
    id: '44444444-4444-4444-8444-444444444444',
    email: 'user@example.com',
  };
  const accessToken = tokenService.createAccessToken(appUser);
  const decoded = tokenService.verifyAccessToken(accessToken);
  const refreshToken = tokenService.createRefreshToken();
  const passwordHash = await passwordService.hashPassword('password123');
  const otpCode = otpService.createOtpCode();
  const otpHash = otpService.hashOtpCode('USER@example.com', 'signup', '123456');

  assert.equal(decoded.sub, appUser.id);
  assert.equal(typeof refreshToken, 'string');
  assert.equal(tokenService.hashRefreshToken('same-token'), tokenService.hashRefreshToken('same-token'));
  assert.ok(tokenService.getRefreshTokenExpiry() instanceof Date);
  assert.match(otpCode, /^\d{6}$/);
  assert.equal(otpService.normalizeEmail(' USER@example.com '), 'user@example.com');
  assert.equal(otpService.verifyOtpCode('user@example.com', 'signup', '123456', otpHash), true);
  assert.equal(otpService.verifyOtpCode('user@example.com', 'signup', '000000', otpHash), false);
  assert.ok(otpService.getOtpExpiry() instanceof Date);
  assert.equal(await passwordService.verifyPassword('password123', passwordHash), true);
  assert.equal(await passwordService.verifyPassword('password123', null), false);
  assert.throws(
    () => tokenService.verifyAccessToken('not-a-jwt'),
    /Invalid or expired access token/
  );
});

test('email service logs OTP locally when delivery is not configured', async function () {
  const logs = [];

  Object.assign(env, {
    NODE_ENV: 'development',
    EMAIL_PROVIDER: '',
    BREVO_API_KEY: '',
    BREVO_FROM: '',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_FROM: '',
  });
  console.info = function info(entry) {
    logs.push(entry);
  };

  const result = await emailService.sendSignupOtp('user@example.com', '123456');

  assert.deepEqual(result, { delivered: false });
  assert.equal(logs[0].email, 'user@example.com');
  assert.equal(logs[0].code, '123456');
});

test('email service sends signup OTP through Brevo and surfaces provider failures', async function () {
  Object.assign(env, {
    NODE_ENV: 'production',
    EMAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'brevo-key',
    BREVO_FROM: 'Vi Vi Vu <sender@example.com>',
    BREVO_API_BASE_URL: 'https://brevo.test/v3/',
    BREVO_TIMEOUT_MS: 1000,
  });

  global.fetch = async function fakeFetch(url, options) {
    assert.equal(url, 'https://brevo.test/v3/smtp/email');
    assert.equal(options.headers['api-key'], 'brevo-key');

    const body = JSON.parse(options.body);

    assert.deepEqual(body.sender, {
      name: 'Vi Vi Vu',
      email: 'sender@example.com',
    });
    assert.deepEqual(body.to, [{ email: 'user@example.com' }]);
    assert.match(body.textContent, /123456/);

    return {
      ok: true,
      async json() {
        return { messageId: 'brevo-message-id' };
      },
    };
  };

  const delivered = await emailService.sendSignupOtp('user@example.com', '123456');

  assert.deepEqual(delivered, {
    delivered: true,
    provider: 'brevo',
    messageId: 'brevo-message-id',
  });

  global.fetch = async function fakeFailedFetch() {
    return {
      ok: false,
      async json() {
        return { message: 'Bad sender' };
      },
    };
  };

  await assert.rejects(
    () => emailService.sendSignupOtp('user@example.com', '123456'),
    { code: 'BREVO_DELIVERY_FAILED', status: 502 }
  );
});

test('email service sends through SMTP when SMTP is configured', async function () {
  const sent = [];

  Object.assign(env, {
    NODE_ENV: 'production',
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'smtp-user',
    SMTP_PASS: 'smtp-pass',
    SMTP_FROM: 'no-reply@example.com',
  });
  nodemailer.createTransport = function createTransport(options) {
    assert.equal(options.host, 'smtp.example.com');
    assert.deepEqual(options.auth, {
      user: 'smtp-user',
      pass: 'smtp-pass',
    });

    return {
      async sendMail(message) {
        sent.push(message);
      },
    };
  };

  const result = await emailService.sendSignupOtp('user@example.com', '123456');

  assert.deepEqual(result, {
    delivered: true,
    provider: 'smtp',
  });
  assert.equal(sent[0].from, 'no-reply@example.com');
  assert.equal(sent[0].to, 'user@example.com');
  assert.match(sent[0].text, /123456/);
});
