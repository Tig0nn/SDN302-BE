const tokenService = require('../modules/auth/tokenService');
const userRepository = require('../modules/users/userRepository');

function getBearerToken(req) {
  const value = req.get('authorization') || '';
  const parts = value.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
    return null;
  }

  return parts[1];
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      const err = new Error('Access token is required');

      err.code = 'AUTH_REQUIRED';
      err.status = 401;
      throw err;
    }

    const payload = tokenService.verifyAccessToken(token);
    const user = await userRepository.findUserById(payload.sub);

    if (!user) {
      const err = new Error('User not found');

      err.code = 'USER_NOT_FOUND';
      err.status = 401;
      throw err;
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  requireAuth,
};
