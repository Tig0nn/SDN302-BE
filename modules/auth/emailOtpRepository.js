const db = require('../../config/db');
const env = require('../../config/env');

async function createOtp({ email, purpose, codeHash, expiresAt, metadata, userId }) {
  await db.query(
    `
      update email_verification_otps
      set consumed_at = now()
      where lower(email) = lower($1)
        and purpose = $2
        and consumed_at is null
    `,
    [email, purpose]
  );

  const result = await db.query(
    `
      insert into email_verification_otps (
        user_id,
        email,
        purpose,
        code_hash,
        metadata,
        max_attempts,
        expires_at
      )
      values ($1, $2, $3, $4, $5, $6, $7)
      returning
        id,
        email,
        purpose,
        expires_at as "expiresAt",
        created_at as "createdAt"
    `,
    [
      userId || null,
      email.toLowerCase(),
      purpose,
      codeHash,
      metadata || {},
      env.OTP_MAX_ATTEMPTS,
      expiresAt,
    ]
  );

  return result.rows[0];
}

async function findActiveOtp(email, purpose) {
  const result = await db.query(
    `
      select
        id,
        user_id as "userId",
        email,
        purpose,
        code_hash as "codeHash",
        metadata,
        attempts,
        max_attempts as "maxAttempts",
        expires_at as "expiresAt"
      from email_verification_otps
      where lower(email) = lower($1)
        and purpose = $2
        and consumed_at is null
        and expires_at > now()
      order by created_at desc
      limit 1
    `,
    [email, purpose]
  );

  return result.rows[0] || null;
}

async function findLatestOtp(email, purpose) {
  const result = await db.query(
    `
      select
        id,
        user_id as "userId",
        email,
        purpose,
        metadata
      from email_verification_otps
      where lower(email) = lower($1)
        and purpose = $2
      order by created_at desc
      limit 1
    `,
    [email, purpose]
  );

  return result.rows[0] || null;
}

async function incrementAttempts(otpId) {
  await db.query(
    `
      update email_verification_otps
      set attempts = attempts + 1
      where id = $1
    `,
    [otpId]
  );
}

async function consumeOtp(otpId) {
  await db.query(
    `
      update email_verification_otps
      set consumed_at = now()
      where id = $1
    `,
    [otpId]
  );
}

module.exports = {
  consumeOtp,
  createOtp,
  findActiveOtp,
  findLatestOtp,
  incrementAttempts,
};
