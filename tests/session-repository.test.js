const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const db = require('../config/db');
const tokenService = require('../modules/auth/tokenService');

const originalQuery = db.query;

test.afterEach(function cleanup() {
  db.query = originalQuery;
  delete require.cache[require.resolve('../modules/auth/sessionRepository')];
});

test('revokeSessionByRefreshToken stores revocation against the hashed token', async function () {
  const queries = [];

  db.query = async function fakeQuery(sql, params) {
    queries.push({ sql, params });
    return { rowCount: 1, rows: [] };
  };

  const sessionRepository = require('../modules/auth/sessionRepository');
  const refreshToken = 'raw-refresh-token';

  await sessionRepository.revokeSessionByRefreshToken(refreshToken);

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /revoked_at = now\(\)/);
  assert.equal(queries[0].params[0], tokenService.hashRefreshToken(refreshToken));
  assert.notEqual(queries[0].params[0], refreshToken);
});
