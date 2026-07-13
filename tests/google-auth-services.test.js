const test = require('node:test');
const assert = require('node:assert/strict');
const { OAuth2Client } = require('google-auth-library');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';
process.env.GOOGLE_CLIENT_IDS =
  process.env.GOOGLE_CLIENT_IDS || 'test-client.apps.googleusercontent.com';

const db = require('../config/db');
const googleAuthService = require('../modules/auth/googleAuthService');
const userRepository = require('../modules/users/userRepository');

const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
const originalQuery = db.query;

test.afterEach(function cleanup() {
  OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
  db.query = originalQuery;
});

test('verifyGoogleIdToken rejects unverified Google email claims', async function () {
  OAuth2Client.prototype.verifyIdToken = async function fakeVerifyIdToken() {
    return {
      getPayload() {
        return {
          sub: 'google-sub-1',
          email: 'user@example.com',
          email_verified: false,
          name: 'User Example',
        };
      },
    };
  };

  await assert.rejects(
    () => googleAuthService.verifyGoogleIdToken('id-token'),
    {
      code: 'INVALID_GOOGLE_TOKEN',
      status: 401,
      message: 'Google token email is not verified',
    }
  );
});

test('verifyGoogleIdToken marks Gmail and Workspace emails as authoritative', async function () {
  const payloads = [
    {
      sub: 'gmail-sub',
      email: 'user@gmail.com',
      email_verified: true,
    },
    {
      sub: 'workspace-sub',
      email: 'user@example.com',
      email_verified: true,
      hd: 'example.com',
    },
  ];

  OAuth2Client.prototype.verifyIdToken = async function fakeVerifyIdToken() {
    return {
      getPayload() {
        return payloads.shift();
      },
    };
  };

  const gmailProfile = await googleAuthService.verifyGoogleIdToken('gmail-token');
  const workspaceProfile = await googleAuthService.verifyGoogleIdToken(
    'workspace-token'
  );

  assert.equal(gmailProfile.emailAuthoritative, true);
  assert.equal(gmailProfile.hostedDomain, null);
  assert.equal(workspaceProfile.emailAuthoritative, true);
  assert.equal(workspaceProfile.hostedDomain, 'example.com');
});

test('upsertGoogleUser does not auto-link existing users for non-authoritative email', async function () {
  const queries = [];

  db.query = async function fakeQuery(sql, params = []) {
    queries.push({ sql, params });

    if (queries.length === 1) {
      assert.match(sql, /where google_sub = \$1/);
      return { rowCount: 0, rows: [] };
    }

    assert.match(sql, /on conflict \(email\) do nothing/);
    return { rowCount: 0, rows: [] };
  };

  await assert.rejects(
    () =>
      userRepository.upsertGoogleUser({
        googleSub: 'google-sub-2',
        email: 'user@example.com',
        displayName: 'User Example',
        avatarUrl: null,
        emailAuthoritative: false,
      }),
    {
      code: 'GOOGLE_EMAIL_LINK_REQUIRED',
      status: 409,
    }
  );

  assert.equal(queries.length, 2);
  assert.equal(queries[1].params[1], 'user@example.com');
});
