const bcrypt = require('bcryptjs');
const env = require('../../config/env');

async function hashPassword(password) {
  return bcrypt.hash(password, env.PASSWORD_HASH_ROUNDS);
}

async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;

  return bcrypt.compare(password, passwordHash);
}

module.exports = {
  hashPassword,
  verifyPassword,
};
