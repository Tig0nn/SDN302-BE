const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const app = require('../app');
const authService = require('../modules/auth/authService');
const auditRepository = require('../modules/security/auditRepository');

const originalAuthService = {
  registerWithEmail: authService.registerWithEmail,
  verifySignupOtp: authService.verifySignupOtp,
  loginWithEmail: authService.loginWithEmail,
  resendSignupOtp: authService.resendSignupOtp,
  loginWithGoogle: authService.loginWithGoogle,
  refreshTokens: authService.refreshTokens,
  logout: authService.logout,
};
const originalRecordAuditEvent = auditRepository.recordAuditEvent;

function user(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    displayName: 'User Example',
    avatarUrl: null,
    emailVerifiedAt: '2026-06-01T00:00:00.000Z',
    locale: 'vi-VN',
    timezone: 'Asia/Ho_Chi_Minh',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function tokenPair() {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'Bearer',
    expiresIn: 900,
  };
}

function request(path, options = {}) {
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', function onListen() {
      const address = server.address();
      const body = options.body ? JSON.stringify(options.body) : null;

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: options.method || 'GET',
          headers: {
            ...(body
              ? {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(body),
                }
              : {}),
            ...(options.headers || {}),
          },
        },
        function onResponse(res) {
          let raw = '';

          res.setEncoding('utf8');
          res.on('data', function onData(chunk) {
            raw += chunk;
          });
          res.on('end', function onEnd() {
            server.close(function onClose() {
              resolve({
                statusCode: res.statusCode,
                body:
                  raw && res.headers['content-type']?.includes('application/json')
                    ? JSON.parse(raw)
                    : raw,
              });
            });
          });
        }
      );

      req.on('error', function onError(err) {
        server.close(function onClose() {
          reject(err);
        });
      });

      if (body) {
        req.write(body);
      }

      req.end();
    });
  });
}

function restoreAll() {
  Object.assign(authService, originalAuthService);
  auditRepository.recordAuditEvent = originalRecordAuditEvent;
}

test.afterEach(restoreAll);

test('auth email and token routes delegate to services and record audit events', async function () {
  const auditEvents = [];

  auditRepository.recordAuditEvent = async function recordAuditEvent(req, eventType, metadata, userId) {
    auditEvents.push({
      eventType,
      metadata,
      userId: userId || null,
      requestId: req.requestId,
    });
  };

  authService.registerWithEmail = async function registerWithEmail(payload) {
    assert.deepEqual(payload, {
      email: 'new@example.com',
      password: 'password123',
      displayName: 'New User',
    });

    return {
      email: 'new@example.com',
      expiresAt: '2026-06-01T00:05:00.000Z',
      delivered: true,
    };
  };
  authService.verifySignupOtp = async function verifySignupOtp(payload) {
    assert.deepEqual(payload, {
      email: 'new@example.com',
      otpCode: '123456',
    });

    return {
      user: user({ email: 'new@example.com' }),
      tokens: tokenPair(),
    };
  };
  authService.loginWithEmail = async function loginWithEmail(payload) {
    assert.deepEqual(payload, {
      email: 'user@example.com',
      password: 'password123',
    });

    return {
      user: user(),
      tokens: tokenPair(),
    };
  };
  authService.resendSignupOtp = async function resendSignupOtp(email) {
    assert.equal(email, 'new@example.com');

    return {
      email,
      expiresAt: '2026-06-01T00:05:00.000Z',
      delivered: false,
    };
  };
  authService.refreshTokens = async function refreshTokens(refreshToken) {
    assert.equal(refreshToken, 'old-refresh-token');

    return {
      user: user(),
      tokens: tokenPair(),
    };
  };
  authService.logout = async function logout(refreshToken) {
    assert.equal(refreshToken, 'refresh-token');
  };

  const register = await request('/api/v1/auth/email/register', {
    method: 'POST',
    body: {
      email: 'new@example.com',
      password: 'password123',
      displayName: 'New User',
    },
  });
  const verify = await request('/api/v1/auth/email/verify', {
    method: 'POST',
    body: {
      email: 'new@example.com',
      otpCode: '123456',
    },
  });
  const login = await request('/api/v1/auth/email/login', {
    method: 'POST',
    body: {
      email: 'user@example.com',
      password: 'password123',
    },
  });
  const resend = await request('/api/v1/auth/email/resend-otp', {
    method: 'POST',
    body: {
      email: 'new@example.com',
    },
  });
  const refresh = await request('/api/v1/auth/refresh', {
    method: 'POST',
    body: {
      refreshToken: 'old-refresh-token',
    },
  });
  const logout = await request('/api/v1/auth/logout', {
    method: 'POST',
    body: {
      refreshToken: 'refresh-token',
    },
  });

  assert.equal(register.statusCode, 200);
  assert.equal(register.body.data.delivered, true);
  assert.equal(verify.statusCode, 200);
  assert.equal(verify.body.data.user.email, 'new@example.com');
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.data.tokens.accessToken, 'access-token');
  assert.equal(resend.statusCode, 200);
  assert.equal(resend.body.data.delivered, false);
  assert.equal(refresh.statusCode, 200);
  assert.equal(refresh.body.data.tokens.refreshToken, 'refresh-token');
  assert.equal(logout.statusCode, 200);
  assert.deepEqual(logout.body.data, { ok: true });
  assert.deepEqual(
    auditEvents.map((event) => event.eventType),
    [
      'auth.email_register_requested',
      'auth.email_signup_verified',
      'auth.email_login',
      'auth.email_otp_resent',
      'auth.refresh',
      'auth.logout',
    ]
  );
  assert.ok(auditEvents.every((event) => event.requestId));
});

test('POST /api/v1/auth/google returns a token pair and writes a google audit event', async function () {
  const auditEvents = [];

  auditRepository.recordAuditEvent = async function recordAuditEvent(req, eventType, metadata, userId) {
    auditEvents.push({ eventType, metadata, userId });
  };
  authService.loginWithGoogle = async function loginWithGoogle(idToken) {
    assert.equal(idToken, 'google-id-token');

    return {
      user: user({ email: 'google@example.com' }),
      tokens: tokenPair(),
    };
  };

  const res = await request('/api/v1/auth/google', {
    method: 'POST',
    body: {
      idToken: 'google-id-token',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.user.email, 'google@example.com');
  assert.equal(auditEvents[0].eventType, 'auth.google_login');
  assert.equal(auditEvents[0].userId, user().id);
});

test('POST /api/v1/auth/email/verify validates OTP format before calling service', async function () {
  let called = false;

  authService.verifySignupOtp = async function verifySignupOtp() {
    called = true;
  };

  const res = await request('/api/v1/auth/email/verify', {
    method: 'POST',
    body: {
      email: 'new@example.com',
      otpCode: 'abc123',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.equal(called, false);
});
