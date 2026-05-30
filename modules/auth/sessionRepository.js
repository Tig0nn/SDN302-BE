const db = require('../../config/db');
const {
  hashRefreshToken,
  getRefreshTokenExpiry,
} = require('./tokenService');

async function createSession(userId, refreshToken) {
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = getRefreshTokenExpiry();

  const result = await db.query(
    `
      insert into sessions (user_id, refresh_token_hash, expires_at)
      values ($1, $2, $3)
      returning id, expires_at as "expiresAt"
    `,
    [userId, tokenHash, expiresAt]
  );

  return result.rows[0];
}

async function findActiveSessionByRefreshToken(refreshToken) {
  const tokenHash = hashRefreshToken(refreshToken);
  const result = await db.query(
    `
      select
        s.id,
        s.user_id as "userId",
        s.expires_at as "expiresAt"
      from sessions s
      where s.refresh_token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
      limit 1
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
}

async function revokeSessionByRefreshToken(refreshToken) {
  const tokenHash = hashRefreshToken(refreshToken);

  await db.query(
    `
      update sessions
      set revoked_at = now()
      where refresh_token_hash = $1
        and revoked_at is null
    `,
    [tokenHash]
  );
}

async function rotateSession(sessionId, refreshToken) {
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = getRefreshTokenExpiry();

  const result = await db.query(
    `
      update sessions
      set refresh_token_hash = $2,
          expires_at = $3,
          revoked_at = null
      where id = $1
      returning id, expires_at as "expiresAt"
    `,
    [sessionId, tokenHash, expiresAt]
  );

  return result.rows[0];
}

module.exports = {
  createSession,
  findActiveSessionByRefreshToken,
  revokeSessionByRefreshToken,
  rotateSession,
};
