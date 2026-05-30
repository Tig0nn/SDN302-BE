const crypto = require('crypto');
const env = require('../../config/env');

function assertOtpSecret() {
  if (!env.OTP_SECRET) {
    const err = new Error('OTP_SECRET or JWT_SECRET is not configured');

    err.code = 'OTP_SECRET_MISSING';
    err.status = 500;
    throw err;
  }
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function createOtpCode() {
  const length = env.OTP_LENGTH;
  const max = 10 ** length;
  const value = crypto.randomInt(0, max);

  return value.toString().padStart(length, '0');
}

function hashOtpCode(email, purpose, code) {
  assertOtpSecret();

  return crypto
    .createHmac('sha256', env.OTP_SECRET)
    .update(`${normalizeEmail(email)}:${purpose}:${code}`)
    .digest('hex');
}

function verifyOtpCode(email, purpose, code, expectedHash) {
  const actual = Buffer.from(hashOtpCode(email, purpose, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  if (actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}

function getOtpExpiry() {
  return new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000);
}

module.exports = {
  createOtpCode,
  getOtpExpiry,
  hashOtpCode,
  normalizeEmail,
  verifyOtpCode,
};
