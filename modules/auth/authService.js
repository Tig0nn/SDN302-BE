const googleAuthService = require('./googleAuthService');
const emailOtpRepository = require('./emailOtpRepository');
const emailService = require('./emailService');
const otpService = require('./otpService');
const passwordService = require('./passwordService');
const sessionRepository = require('./sessionRepository');
const tokenService = require('./tokenService');
const userRepository = require('../users/userRepository');
const env = require('../../config/env');

function buildTokenResponse(user, session, refreshToken) {
  return {
    user,
    tokens: {
      accessToken: tokenService.createAccessToken(user),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresAt: session.expiresAt,
    },
  };
}

async function loginWithGoogle(idToken) {
  const profile = await googleAuthService.verifyGoogleIdToken(idToken);
  const user = await userRepository.upsertGoogleUser(profile);

  await userRepository.ensureDefaultUserData(user.id);

  const refreshToken = tokenService.createRefreshToken();
  const session = await sessionRepository.createSession(user.id, refreshToken);

  return buildTokenResponse(user, session, refreshToken);
}

async function createAndSendSignupOtp({ email, password, displayName }) {
  const normalizedEmail = otpService.normalizeEmail(email);

  emailService.assertEmailDeliveryConfig();

  const existingUser = await userRepository.findUserByEmailForAuth(normalizedEmail);

  if (existingUser?.passwordHash && existingUser.emailVerifiedAt) {
    const err = new Error('Email is already registered');

    err.code = 'EMAIL_ALREADY_REGISTERED';
    err.status = 409;
    throw err;
  }

  const passwordHash = await passwordService.hashPassword(password);
  const code = otpService.createOtpCode();
  const expiresAt = otpService.getOtpExpiry();
  const otp = await emailOtpRepository.createOtp({
    email: normalizedEmail,
    purpose: 'signup',
    codeHash: otpService.hashOtpCode(normalizedEmail, 'signup', code),
    expiresAt,
    userId: existingUser?.id,
    metadata: {
      passwordHash,
      displayName: displayName || null,
    },
  });
  const delivery = await emailService.sendSignupOtp(normalizedEmail, code);

  return {
    email: normalizedEmail,
    otpExpiresAt: otp.expiresAt,
    otpTtlMinutes: env.OTP_TTL_MINUTES,
    delivered: delivery.delivered,
  };
}

async function registerWithEmail(payload) {
  return createAndSendSignupOtp(payload);
}

async function resendSignupOtp(email) {
  const normalizedEmail = otpService.normalizeEmail(email);

  emailService.assertEmailDeliveryConfig();

  const latestOtp = await emailOtpRepository.findLatestOtp(normalizedEmail, 'signup');

  if (!latestOtp?.metadata?.passwordHash) {
    const err = new Error('No pending signup OTP found for this email');

    err.code = 'SIGNUP_OTP_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const existingUser = await userRepository.findUserByEmailForAuth(normalizedEmail);

  if (existingUser?.passwordHash && existingUser.emailVerifiedAt) {
    const err = new Error('Email is already registered');

    err.code = 'EMAIL_ALREADY_REGISTERED';
    err.status = 409;
    throw err;
  }

  const code = otpService.createOtpCode();
  const expiresAt = otpService.getOtpExpiry();
  const otp = await emailOtpRepository.createOtp({
    email: normalizedEmail,
    purpose: 'signup',
    codeHash: otpService.hashOtpCode(normalizedEmail, 'signup', code),
    expiresAt,
    userId: existingUser?.id,
    metadata: latestOtp.metadata,
  });
  const delivery = await emailService.sendSignupOtp(normalizedEmail, code);

  return {
    email: normalizedEmail,
    otpExpiresAt: otp.expiresAt,
    otpTtlMinutes: env.OTP_TTL_MINUTES,
    delivered: delivery.delivered,
  };
}

async function verifySignupOtp({ email, otpCode }) {
  const normalizedEmail = otpService.normalizeEmail(email);
  const otp = await emailOtpRepository.findActiveOtp(normalizedEmail, 'signup');

  if (!otp) {
    const err = new Error('OTP is invalid or expired');

    err.code = 'INVALID_OR_EXPIRED_OTP';
    err.status = 400;
    throw err;
  }

  if (otp.attempts >= otp.maxAttempts) {
    await emailOtpRepository.consumeOtp(otp.id);

    const err = new Error('OTP attempt limit exceeded');

    err.code = 'OTP_ATTEMPT_LIMIT_EXCEEDED';
    err.status = 429;
    throw err;
  }

  const isValid = otpService.verifyOtpCode(
    normalizedEmail,
    'signup',
    otpCode,
    otp.codeHash
  );

  if (!isValid) {
    await emailOtpRepository.incrementAttempts(otp.id);

    const err = new Error('OTP is invalid or expired');

    err.code = 'INVALID_OR_EXPIRED_OTP';
    err.status = 400;
    throw err;
  }

  if (!otp.metadata?.passwordHash) {
    const err = new Error('Signup OTP is missing registration metadata');

    err.code = 'SIGNUP_OTP_METADATA_MISSING';
    err.status = 500;
    throw err;
  }

  const existingUser = await userRepository.findUserByEmailForAuth(normalizedEmail);

  if (existingUser?.passwordHash && existingUser.emailVerifiedAt) {
    const err = new Error('Email is already registered');

    err.code = 'EMAIL_ALREADY_REGISTERED';
    err.status = 409;
    throw err;
  }

  const user = await userRepository.createOrUpdateEmailPasswordUser({
    email: normalizedEmail,
    passwordHash: otp.metadata.passwordHash,
    displayName: otp.metadata.displayName,
  });

  await emailOtpRepository.consumeOtp(otp.id);
  await userRepository.ensureDefaultUserData(user.id);

  const refreshToken = tokenService.createRefreshToken();
  const session = await sessionRepository.createSession(user.id, refreshToken);

  return buildTokenResponse(user, session, refreshToken);
}

async function loginWithEmail({ email, password }) {
  const normalizedEmail = otpService.normalizeEmail(email);
  const user = await userRepository.findUserByEmailForAuth(normalizedEmail);
  const isValidPassword = await passwordService.verifyPassword(
    password,
    user?.passwordHash
  );

  if (!user || !isValidPassword) {
    const err = new Error('Invalid email or password');

    err.code = 'INVALID_CREDENTIALS';
    err.status = 401;
    throw err;
  }

  if (!user.emailVerifiedAt) {
    const err = new Error('Email is not verified');

    err.code = 'EMAIL_NOT_VERIFIED';
    err.status = 403;
    throw err;
  }

  await userRepository.ensureDefaultUserData(user.id);

  const refreshToken = tokenService.createRefreshToken();
  const session = await sessionRepository.createSession(user.id, refreshToken);

  return buildTokenResponse(user, session, refreshToken);
}

function buildForgotPasswordResponse(email, overrides = {}) {
  return {
    email,
    otpExpiresAt: overrides.otpExpiresAt || otpService.getOtpExpiry(),
    otpTtlMinutes: env.OTP_TTL_MINUTES,
    delivered: Boolean(overrides.delivered),
  };
}

async function forgotPassword({ email }) {
  const normalizedEmail = otpService.normalizeEmail(email);

  emailService.assertEmailDeliveryConfig();

  const user = await userRepository.findUserByEmailForAuth(normalizedEmail);

  if (!user?.passwordHash || !user.emailVerifiedAt) {
    return buildForgotPasswordResponse(normalizedEmail);
  }

  const code = otpService.createOtpCode();
  const expiresAt = otpService.getOtpExpiry();
  const otp = await emailOtpRepository.createOtp({
    email: normalizedEmail,
    purpose: 'password_reset',
    codeHash: otpService.hashOtpCode(normalizedEmail, 'password_reset', code),
    expiresAt,
    userId: user.id,
    metadata: {},
  });
  const delivery = await emailService.sendPasswordResetOtp(normalizedEmail, code);

  return buildForgotPasswordResponse(normalizedEmail, {
    otpExpiresAt: otp.expiresAt,
    delivered: delivery.delivered,
  });
}

async function resetPassword({ email, otpCode, newPassword }) {
  const normalizedEmail = otpService.normalizeEmail(email);
  const otp = await emailOtpRepository.findActiveOtp(
    normalizedEmail,
    'password_reset'
  );

  if (!otp) {
    const err = new Error('OTP is invalid or expired');

    err.code = 'INVALID_OR_EXPIRED_OTP';
    err.status = 400;
    throw err;
  }

  if (otp.attempts >= otp.maxAttempts) {
    await emailOtpRepository.consumeOtp(otp.id);

    const err = new Error('OTP attempt limit exceeded');

    err.code = 'OTP_ATTEMPT_LIMIT_EXCEEDED';
    err.status = 429;
    throw err;
  }

  const isValid = otpService.verifyOtpCode(
    normalizedEmail,
    'password_reset',
    otpCode,
    otp.codeHash
  );

  if (!isValid) {
    await emailOtpRepository.incrementAttempts(otp.id);

    const err = new Error('OTP is invalid or expired');

    err.code = 'INVALID_OR_EXPIRED_OTP';
    err.status = 400;
    throw err;
  }

  const user = await userRepository.findUserByEmailForAuth(normalizedEmail);

  if (!user?.passwordHash || !user.emailVerifiedAt) {
    await emailOtpRepository.consumeOtp(otp.id);

    const err = new Error('Password reset is not available for this account');

    err.code = 'PASSWORD_RESET_UNAVAILABLE';
    err.status = 400;
    throw err;
  }

  const passwordHash = await passwordService.hashPassword(newPassword);

  await userRepository.updatePasswordHash(user.id, passwordHash);
  await emailOtpRepository.consumeOtp(otp.id);
  await sessionRepository.revokeAllSessionsForUser(user.id);

  return {
    ok: true,
    email: normalizedEmail,
  };
}

async function refreshTokens(refreshToken) {
  const session = await sessionRepository.findActiveSessionByRefreshToken(refreshToken);

  if (!session) {
    const err = new Error('Invalid or expired refresh token');

    err.code = 'INVALID_REFRESH_TOKEN';
    err.status = 401;
    throw err;
  }

  const user = await userRepository.findUserById(session.userId);

  if (!user) {
    const err = new Error('User not found');

    err.code = 'USER_NOT_FOUND';
    err.status = 401;
    throw err;
  }

  const nextRefreshToken = tokenService.createRefreshToken();
  const nextSession = await sessionRepository.rotateSession(
    session.id,
    nextRefreshToken
  );

  return buildTokenResponse(user, nextSession, nextRefreshToken);
}

async function logout(refreshToken) {
  if (!refreshToken) return;

  await sessionRepository.revokeSessionByRefreshToken(refreshToken);
}

module.exports = {
  loginWithGoogle,
  loginWithEmail,
  registerWithEmail,
  resendSignupOtp,
  verifySignupOtp,
  forgotPassword,
  resetPassword,
  refreshTokens,
  logout,
};
