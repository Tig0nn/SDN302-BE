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

test('listActiveSessionsForUser lists only the given user\'s active sessions', async function () {
  const userId = '11111111-1111-4111-8111-111111111111';
  let capturedParams = null;

  db.query = async function fakeQuery(sql, params) {
    capturedParams = params;
    return {
      rowCount: 1,
      rows: [{ id: 'session-1', createdAt: '2026-06-01T00:00:00.000Z', expiresAt: '2026-07-01T00:00:00.000Z' }],
    };
  };

  const sessionRepository = require('../modules/auth/sessionRepository');
  const sessions = await sessionRepository.listActiveSessionsForUser(userId);

  assert.equal(capturedParams[0], userId);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 'session-1');
});

test('revokeSessionForUser revokes a session scoped to the owning user', async function () {
  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  let capturedParams = null;

  db.query = async function fakeQuery(sql, params) {
    capturedParams = params;
    return { rowCount: 1, rows: [{ id: sessionId }] };
  };

  const sessionRepository = require('../modules/auth/sessionRepository');
  const result = await sessionRepository.revokeSessionForUser(userId, sessionId);

  assert.equal(capturedParams[0], userId);
  assert.equal(capturedParams[1], sessionId);
  assert.equal(result.id, sessionId);
});

test('revokeSessionForUser rejects when the session does not belong to the user', async function () {
  db.query = async function fakeQuery() {
    return { rowCount: 0, rows: [] };
  };

  const sessionRepository = require('../modules/auth/sessionRepository');

  await assert.rejects(
    sessionRepository.revokeSessionForUser('user-a', 'someone-elses-session'),
    { code: 'SESSION_NOT_FOUND', status: 404 }
  );
});
