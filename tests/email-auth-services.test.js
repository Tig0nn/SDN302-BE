const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';
process.env.OTP_SECRET = process.env.OTP_SECRET || 'test-otp-secret-with-enough-length';

const otpService = require('../modules/auth/otpService');
const passwordService = require('../modules/auth/passwordService');

function reloadEmailService(overrides) {
  const keys = [
    'NODE_ENV',
    'EMAIL_PROVIDER',
    'BREVO_API_KEY',
    'BREVO_FROM',
    'BREVO_API_BASE_URL',
    'BREVO_TIMEOUT_MS',
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
  ];
  const previous = {};

  for (const key of keys) {
    previous[key] = process.env[key];
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      process.env[key] = overrides[key];
    } else {
      delete process.env[key];
    }
  }

  delete require.cache[require.resolve('../config/env')];
  delete require.cache[require.resolve('../modules/auth/emailService')];

  return {
    emailService: require('../modules/auth/emailService'),
    restore() {
      for (const key of keys) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }

      delete require.cache[require.resolve('../config/env')];
      delete require.cache[require.resolve('../modules/auth/emailService')];
    },
  };
}

test('OTP hashes are deterministic and verify with timing-safe comparison', function () {
  const hash = otpService.hashOtpCode('USER@Example.com', 'signup', '123456');

  assert.equal(hash, otpService.hashOtpCode('user@example.com', 'signup', '123456'));
  assert.equal(
    otpService.verifyOtpCode('user@example.com', 'signup', '123456', hash),
    true
  );
  assert.equal(
    otpService.verifyOtpCode('user@example.com', 'signup', '654321', hash),
    false
  );
});

test('password hashes verify only the original password', async function () {
  const hash = await passwordService.hashPassword('correct-password');

  assert.equal(await passwordService.verifyPassword('correct-password', hash), true);
  assert.equal(await passwordService.verifyPassword('wrong-password', hash), false);
  assert.notEqual(hash, 'correct-password');
});

test('sendSignupOtp delivers through Brevo when configured', async function () {
  const previousFetch = globalThis.fetch;
  const { emailService, restore } = reloadEmailService({
    NODE_ENV: 'production',
    EMAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'xkeysib_test_key',
    BREVO_FROM: 'Vi Vi Vu <otp@example.com>',
    BREVO_API_BASE_URL: 'https://api.brevo.test/v3',
    BREVO_TIMEOUT_MS: '1000',
  });

  try {
    let request;

    globalThis.fetch = async function mockFetch(url, options) {
      request = {
        url,
        headers: options.headers,
        body: JSON.parse(options.body),
      };

      return {
        ok: true,
        json: async () => ({ messageId: 'brevo_123' }),
      };
    };

    const result = await emailService.sendSignupOtp('user@example.com', '123456');

    assert.deepEqual(result, {
      delivered: true,
      provider: 'brevo',
      messageId: 'brevo_123',
    });
    assert.equal(request.url, 'https://api.brevo.test/v3/smtp/email');
    assert.equal(request.headers['api-key'], 'xkeysib_test_key');
    assert.deepEqual(request.body.sender, {
      name: 'Vi Vi Vu',
      email: 'otp@example.com',
    });
    assert.deepEqual(request.body.to, [{ email: 'user@example.com' }]);
    assert.equal(request.body.subject, 'Ma xac thuc Vi Vi Vu');
    assert.match(request.body.textContent, /123456/);
    assert.match(request.body.htmlContent, /123456/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test('sendPasswordResetOtp delivers through Brevo with reset subject', async function () {
  const previousFetch = globalThis.fetch;
  const { emailService, restore } = reloadEmailService({
    NODE_ENV: 'production',
    EMAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'xkeysib_test_key',
    BREVO_FROM: 'Vi Vi Vu <otp@example.com>',
    BREVO_API_BASE_URL: 'https://api.brevo.test/v3',
    BREVO_TIMEOUT_MS: '1000',
  });

  try {
    let request;

    globalThis.fetch = async function mockFetch(url, options) {
      request = {
        url,
        body: JSON.parse(options.body),
      };

      return {
        ok: true,
        json: async () => ({ messageId: 'brevo_reset_123' }),
      };
    };

    const result = await emailService.sendPasswordResetOtp(
      'user@example.com',
      '654321'
    );

    assert.deepEqual(result, {
      delivered: true,
      provider: 'brevo',
      messageId: 'brevo_reset_123',
    });
    assert.equal(request.url, 'https://api.brevo.test/v3/smtp/email');
    assert.equal(request.body.subject, 'Dat lai mat khau Vi Vi Vu');
    assert.match(request.body.textContent, /654321/);
    assert.match(request.body.htmlContent, /654321/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});
