const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';
process.env.OTP_SECRET = process.env.OTP_SECRET || 'test-otp-secret-with-enough-length';

const otpService = require('../modules/auth/otpService');
const passwordService = require('../modules/auth/passwordService');

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
