const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const tokenService = require('../modules/auth/tokenService');

test('access token round-trips core user claims', function () {
  const token = tokenService.createAccessToken({
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
  });
  const payload = tokenService.verifyAccessToken(token);

  assert.equal(payload.sub, '11111111-1111-4111-8111-111111111111');
  assert.equal(payload.email, 'user@example.com');
  assert.equal(payload.iss, 'vi-vi-vu-api');
  assert.equal(payload.aud, 'vi-vi-vu-mobile');
});

test('refresh token hashing is deterministic and not raw-token preserving', function () {
  const token = tokenService.createRefreshToken();
  const firstHash = tokenService.hashRefreshToken(token);
  const secondHash = tokenService.hashRefreshToken(token);

  assert.equal(firstHash, secondHash);
  assert.notEqual(firstHash, token);
});

test('expired access tokens are rejected', function () {
  const token = jwt.sign(
    {
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.com',
    },
    process.env.JWT_SECRET,
    {
      expiresIn: -1,
      issuer: 'vi-vi-vu-api',
      audience: 'vi-vi-vu-mobile',
    }
  );

  assert.throws(
    () => tokenService.verifyAccessToken(token),
    (err) => err.code === 'INVALID_ACCESS_TOKEN' && err.status === 401
  );
});
