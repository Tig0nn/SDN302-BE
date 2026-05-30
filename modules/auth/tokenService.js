const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');

function assertJwtSecret() {
  if (!env.JWT_SECRET) {
    const err = new Error('JWT_SECRET is not configured');

    err.code = 'JWT_SECRET_MISSING';
    err.status = 500;
    throw err;
  }
}

function createAccessToken(user) {
  assertJwtSecret();

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
    },
    env.JWT_SECRET,
    {
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      issuer: 'vi-vi-vu-api',
      audience: 'vi-vi-vu-mobile',
    }
  );
}

function verifyAccessToken(token) {
  assertJwtSecret();

  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: 'vi-vi-vu-api',
      audience: 'vi-vi-vu-mobile',
    });
  } catch (err) {
    const authError = new Error('Invalid or expired access token');

    authError.code = 'INVALID_ACCESS_TOKEN';
    authError.status = 401;
    throw authError;
  }
}

function createRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getRefreshTokenExpiry() {
  const expiresAt = new Date();

  expiresAt.setDate(expiresAt.getDate() + env.REFRESH_TOKEN_TTL_DAYS);
  return expiresAt;
}

module.exports = {
  createAccessToken,
  verifyAccessToken,
  createRefreshToken,
  hashRefreshToken,
  getRefreshTokenExpiry,
};
