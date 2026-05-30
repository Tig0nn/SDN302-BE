require('dotenv').config();

function parseCsv(value) {
  if (!value) return [];

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || '3000',
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || '',
  API_PREFIX: process.env.API_PREFIX || '/api/v1',
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_SSL: process.env.DATABASE_SSL !== 'false',
  JSON_BODY_LIMIT: process.env.JSON_BODY_LIMIT || '1mb',
  CORS_ORIGINS: parseCsv(
    process.env.CORS_ORIGINS ||
      'http://localhost:19006,http://localhost:8081,http://localhost:3000'
  ),
  GOOGLE_CLIENT_IDS: parseCsv(
    process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || ''
  ),
  JWT_SECRET: process.env.JWT_SECRET,
  ACCESS_TOKEN_TTL_SECONDS: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 10800),
  REFRESH_TOKEN_TTL_DAYS: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),
  PASSWORD_HASH_ROUNDS: Number(process.env.PASSWORD_HASH_ROUNDS || 12),
  OTP_LENGTH: Number(process.env.OTP_LENGTH || 6),
  OTP_TTL_MINUTES: Number(process.env.OTP_TTL_MINUTES || 10),
  OTP_MAX_ATTEMPTS: Number(process.env.OTP_MAX_ATTEMPTS || 5),
  OTP_SECRET: process.env.OTP_SECRET || process.env.JWT_SECRET,
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || process.env.SMTP_USER || '',
};

module.exports = env;
