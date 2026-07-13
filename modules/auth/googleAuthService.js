const { OAuth2Client } = require('google-auth-library');
const env = require('../../config/env');

const client = new OAuth2Client();

function isVerifiedEmailClaim(value) {
  return value === true || value === 'true';
}

function isGoogleAuthoritativeForEmail(payload) {
  const email = String(payload.email || '').toLowerCase();

  return (
    email.endsWith('@gmail.com') ||
    email.endsWith('@googlemail.com') ||
    Boolean(payload.hd)
  );
}

function assertGoogleClientIds() {
  if (env.GOOGLE_CLIENT_IDS.length === 0) {
    const err = new Error('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_IDS is not configured');

    err.code = 'GOOGLE_CLIENT_ID_MISSING';
    err.status = 500;
    throw err;
  }
}

async function verifyGoogleIdToken(idToken) {
  assertGoogleClientIds();

  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_IDS,
    });
    const payload = ticket.getPayload();

    if (!payload || !payload.sub || !payload.email) {
      const err = new Error('Google token is missing required profile claims');

      err.code = 'INVALID_GOOGLE_TOKEN';
      err.status = 401;
      throw err;
    }

    if (!isVerifiedEmailClaim(payload.email_verified)) {
      const err = new Error('Google token email is not verified');

      err.code = 'INVALID_GOOGLE_TOKEN';
      err.status = 401;
      throw err;
    }

    return {
      googleSub: payload.sub,
      email: payload.email,
      displayName: payload.name || payload.email,
      avatarUrl: payload.picture || null,
      emailAuthoritative: isGoogleAuthoritativeForEmail(payload),
      hostedDomain: payload.hd || null,
    };
  } catch (err) {
    if (err.status) throw err;

    const authError = new Error('Invalid Google idToken');

    authError.code = 'INVALID_GOOGLE_TOKEN';
    authError.status = 401;
    throw authError;
  }
}

module.exports = {
  verifyGoogleIdToken,
};
