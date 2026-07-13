const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const authService = require('../modules/auth/authService');
const emailOtpRepository = require('../modules/auth/emailOtpRepository');
const emailService = require('../modules/auth/emailService');
const googleAuthService = require('../modules/auth/googleAuthService');
const otpService = require('../modules/auth/otpService');
const passwordService = require('../modules/auth/passwordService');
const sessionRepository = require('../modules/auth/sessionRepository');
const tokenService = require('../modules/auth/tokenService');
const userRepository = require('../modules/users/userRepository');

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

const originals = {
  createOtp: emailOtpRepository.createOtp,
  findActiveOtp: emailOtpRepository.findActiveOtp,
  findLatestOtp: emailOtpRepository.findLatestOtp,
  incrementAttempts: emailOtpRepository.incrementAttempts,
  consumeOtp: emailOtpRepository.consumeOtp,
  assertEmailDeliveryConfig: emailService.assertEmailDeliveryConfig,
  sendSignupOtp: emailService.sendSignupOtp,
  verifyGoogleIdToken: googleAuthService.verifyGoogleIdToken,
  createOtpCode: otpService.createOtpCode,
  getOtpExpiry: otpService.getOtpExpiry,
  hashOtpCode: otpService.hashOtpCode,
  normalizeEmail: otpService.normalizeEmail,
  verifyOtpCode: otpService.verifyOtpCode,
  hashPassword: passwordService.hashPassword,
  verifyPassword: passwordService.verifyPassword,
  createSession: sessionRepository.createSession,
  findActiveSessionByRefreshToken:
    sessionRepository.findActiveSessionByRefreshToken,
  rotateSession: sessionRepository.rotateSession,
  revokeSessionByRefreshToken: sessionRepository.revokeSessionByRefreshToken,
  createRefreshToken: tokenService.createRefreshToken,
  upsertGoogleUser: userRepository.upsertGoogleUser,
  createOrUpdateEmailPasswordUser:
    userRepository.createOrUpdateEmailPasswordUser,
  findUserByEmailForAuth: userRepository.findUserByEmailForAuth,
  findUserById: userRepository.findUserById,
  ensureDefaultUserData: userRepository.ensureDefaultUserData,
};

function user(overrides = {}) {
  return {
    id: userId,
    email: 'user@example.com',
    displayName: 'User',
    avatarUrl: null,
    emailVerifiedAt: '2026-06-01T00:00:00.000Z',
    passwordHash: 'hashed-password',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    id: sessionId,
    userId,
    expiresAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function otp(overrides = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    userId,
    email: 'user@example.com',
    purpose: 'signup',
    codeHash: 'hashed-otp',
    metadata: {
      passwordHash: 'hashed-password',
      displayName: 'User',
    },
    attempts: 0,
    maxAttempts: 5,
    expiresAt: '2026-06-01T00:10:00.000Z',
    ...overrides,
  };
}

function installCommonStubs() {
  otpService.normalizeEmail = function normalizeEmail(email) {
    return String(email).trim().toLowerCase();
  };
  otpService.createOtpCode = function createOtpCode() {
    return '123456';
  };
  otpService.getOtpExpiry = function getOtpExpiry() {
    return new Date('2026-06-01T00:10:00.000Z');
  };
  otpService.hashOtpCode = function hashOtpCode(email, purpose, code) {
    return `${email}:${purpose}:${code}:hash`;
  };
  otpService.verifyOtpCode = function verifyOtpCode(email, purpose, code, hash) {
    return hash === `${email}:${purpose}:${code}:hash`;
  };
  passwordService.hashPassword = async function hashPassword() {
    return 'hashed-password';
  };
  passwordService.verifyPassword = async function verifyPassword(password, hash) {
    return password === 'correct-password' && hash === 'hashed-password';
  };
  tokenService.createRefreshToken = function createRefreshToken() {
    return 'refresh-token';
  };
  sessionRepository.createSession = async function createSession(createdUserId) {
    return session({ userId: createdUserId });
  };
  userRepository.ensureDefaultUserData = async function ensureDefaultUserData() {};
  emailService.assertEmailDeliveryConfig =
    function assertEmailDeliveryConfig() {};
  emailService.sendSignupOtp = async function sendSignupOtp() {
    return { delivered: true, provider: 'test', messageId: 'message-1' };
  };
}

function restoreAll() {
  for (const [name, fn] of Object.entries(originals)) {
    if (name === 'findActiveSessionByRefreshToken') {
      sessionRepository.findActiveSessionByRefreshToken = fn;
    } else if (name === 'createOrUpdateEmailPasswordUser') {
      userRepository.createOrUpdateEmailPasswordUser = fn;
    } else {
      const targets = [
        emailOtpRepository,
        emailService,
        googleAuthService,
        otpService,
        passwordService,
        sessionRepository,
        tokenService,
        userRepository,
      ];
      const target = targets.find((candidate) =>
        Object.prototype.hasOwnProperty.call(candidate, name)
      );

      if (target) target[name] = fn;
    }
  }
}

test.afterEach(function cleanup() {
  restoreAll();
});

test('loginWithGoogle verifies Google profile, ensures defaults, and creates token pair', async function () {
  installCommonStubs();

  const calls = [];

  googleAuthService.verifyGoogleIdToken = async function verifyGoogleIdToken(idToken) {
    calls.push(['verify', idToken]);
    return {
      googleSub: 'google-user',
      email: 'USER@example.com',
      displayName: 'User',
      avatarUrl: null,
    };
  };
  userRepository.upsertGoogleUser = async function upsertGoogleUser(profile) {
    calls.push(['upsert', profile.email]);
    return user();
  };
  userRepository.ensureDefaultUserData = async function ensureDefaultUserData(id) {
    calls.push(['defaults', id]);
  };
  sessionRepository.createSession = async function createSession(id, refreshToken) {
    calls.push(['session', id, refreshToken]);
    return session({ userId: id });
  };

  const result = await authService.loginWithGoogle('id-token');

  assert.equal(result.user.id, userId);
  assert.equal(result.tokens.refreshToken, 'refresh-token');
  assert.equal(result.tokens.tokenType, 'Bearer');
  assert.match(result.tokens.accessToken, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.deepEqual(calls, [
    ['verify', 'id-token'],
    ['upsert', 'USER@example.com'],
    ['defaults', userId],
    ['session', userId, 'refresh-token'],
  ]);
});

test('registerWithEmail rejects an already registered verified email', async function () {
  installCommonStubs();

  userRepository.findUserByEmailForAuth =
    async function findUserByEmailForAuth() {
      return user();
    };

  await assert.rejects(
    authService.registerWithEmail({
      email: 'USER@example.com',
      password: 'correct-password',
    }),
    { code: 'EMAIL_ALREADY_REGISTERED', status: 409 }
  );
});

test('registerWithEmail creates signup OTP without persisting raw password or OTP code', async function () {
  installCommonStubs();

  let createdOtp;

  userRepository.findUserByEmailForAuth =
    async function findUserByEmailForAuth() {
      return null;
    };
  emailOtpRepository.createOtp = async function createOtp(payload) {
    createdOtp = payload;
    return {
      id: 'otp-id',
      email: payload.email,
      purpose: payload.purpose,
      expiresAt: payload.expiresAt,
      createdAt: '2026-06-01T00:00:00.000Z',
    };
  };

  const result = await authService.registerWithEmail({
    email: 'USER@example.com',
    password: 'plain-password',
    displayName: 'User',
  });

  assert.equal(result.email, 'user@example.com');
  assert.equal(result.delivered, true);
  assert.equal(createdOtp.email, 'user@example.com');
  assert.equal(createdOtp.purpose, 'signup');
  assert.equal(createdOtp.codeHash, 'user@example.com:signup:123456:hash');
  assert.equal(createdOtp.metadata.passwordHash, 'hashed-password');
  assert.equal(createdOtp.metadata.displayName, 'User');
});

test('resendSignupOtp requires a pending signup OTP', async function () {
  installCommonStubs();

  emailOtpRepository.findLatestOtp = async function findLatestOtp() {
    return null;
  };

  await assert.rejects(
    authService.resendSignupOtp('user@example.com'),
    { code: 'SIGNUP_OTP_NOT_FOUND', status: 404 }
  );
});

test('verifySignupOtp consumes attempt limit and rejects expired or invalid codes', async function () {
  installCommonStubs();

  let consumedOtpId;
  let incrementedOtpId;

  emailOtpRepository.findActiveOtp = async function findActiveOtp() {
    return otp({ attempts: 5, maxAttempts: 5 });
  };
  emailOtpRepository.consumeOtp = async function consumeOtp(id) {
    consumedOtpId = id;
  };

  await assert.rejects(
    authService.verifySignupOtp({
      email: 'user@example.com',
      otpCode: '123456',
    }),
    { code: 'OTP_ATTEMPT_LIMIT_EXCEEDED', status: 429 }
  );
  assert.equal(consumedOtpId, otp().id);

  emailOtpRepository.findActiveOtp = async function findActiveOtp() {
    return otp();
  };
  emailOtpRepository.incrementAttempts = async function incrementAttempts(id) {
    incrementedOtpId = id;
  };

  await assert.rejects(
    authService.verifySignupOtp({
      email: 'user@example.com',
      otpCode: '000000',
    }),
    { code: 'INVALID_OR_EXPIRED_OTP', status: 400 }
  );
  assert.equal(incrementedOtpId, otp().id);
});

test('verifySignupOtp creates user, consumes OTP, ensures defaults, and creates session', async function () {
  installCommonStubs();

  const calls = [];

  emailOtpRepository.findActiveOtp = async function findActiveOtp() {
    return otp({
      codeHash: 'user@example.com:signup:123456:hash',
    });
  };
  userRepository.findUserByEmailForAuth =
    async function findUserByEmailForAuth() {
      return null;
    };
  userRepository.createOrUpdateEmailPasswordUser =
    async function createOrUpdateEmailPasswordUser(payload) {
      calls.push(['create-user', payload.email, payload.passwordHash]);
      return user({ email: payload.email });
    };
  emailOtpRepository.consumeOtp = async function consumeOtp(id) {
    calls.push(['consume', id]);
  };
  userRepository.ensureDefaultUserData = async function ensureDefaultUserData(id) {
    calls.push(['defaults', id]);
  };

  const result = await authService.verifySignupOtp({
    email: 'USER@example.com',
    otpCode: '123456',
  });

  assert.equal(result.user.email, 'user@example.com');
  assert.equal(result.tokens.refreshToken, 'refresh-token');
  assert.deepEqual(calls, [
    ['create-user', 'user@example.com', 'hashed-password'],
    ['consume', otp().id],
    ['defaults', userId],
  ]);
});

test('loginWithEmail rejects bad credentials and unverified accounts', async function () {
  installCommonStubs();

  userRepository.findUserByEmailForAuth =
    async function findUserByEmailForAuth() {
      return user();
    };

  await assert.rejects(
    authService.loginWithEmail({
      email: 'user@example.com',
      password: 'wrong-password',
    }),
    { code: 'INVALID_CREDENTIALS', status: 401 }
  );

  userRepository.findUserByEmailForAuth =
    async function findUserByEmailForAuth() {
      return user({ emailVerifiedAt: null });
    };

  await assert.rejects(
    authService.loginWithEmail({
      email: 'user@example.com',
      password: 'correct-password',
    }),
    { code: 'EMAIL_NOT_VERIFIED', status: 403 }
  );
});

test('loginWithEmail and refreshTokens return rotated token pairs', async function () {
  installCommonStubs();

  userRepository.findUserByEmailForAuth =
    async function findUserByEmailForAuth() {
      return user();
    };

  const login = await authService.loginWithEmail({
    email: 'USER@example.com',
    password: 'correct-password',
  });

  assert.equal(login.user.email, 'user@example.com');
  assert.equal(login.tokens.refreshToken, 'refresh-token');

  sessionRepository.findActiveSessionByRefreshToken =
    async function findActiveSessionByRefreshToken(refreshToken) {
      assert.equal(refreshToken, 'old-refresh');
      return session();
    };
  userRepository.findUserById = async function findUserById(id) {
    assert.equal(id, userId);
    return user();
  };
  sessionRepository.rotateSession = async function rotateSession(id, refreshToken) {
    assert.equal(id, sessionId);
    assert.equal(refreshToken, 'refresh-token');
    return session();
  };

  const refreshed = await authService.refreshTokens('old-refresh');

  assert.equal(refreshed.user.id, userId);
  assert.equal(refreshed.tokens.refreshToken, 'refresh-token');
});

test('refreshTokens and logout handle invalid sessions', async function () {
  installCommonStubs();

  sessionRepository.findActiveSessionByRefreshToken =
    async function findActiveSessionByRefreshToken() {
      return null;
    };

  await assert.rejects(
    authService.refreshTokens('missing-refresh'),
    { code: 'INVALID_REFRESH_TOKEN', status: 401 }
  );

  let revokedToken = null;

  sessionRepository.revokeSessionByRefreshToken =
    async function revokeSessionByRefreshToken(refreshToken) {
      revokedToken = refreshToken;
    };

  await authService.logout();
  assert.equal(revokedToken, null);

  await authService.logout('refresh-token');
  assert.equal(revokedToken, 'refresh-token');
});
