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
      'http://localhost:19006,http://localhost:8081,http://localhost:8082,http://localhost:3000'
  ),
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX || 300),
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
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || '',
  BREVO_API_KEY: process.env.BREVO_API_KEY || '',
  BREVO_FROM: process.env.BREVO_FROM || process.env.SMTP_FROM || '',
  BREVO_API_BASE_URL:
    process.env.BREVO_API_BASE_URL || 'https://api.brevo.com/v3',
  BREVO_TIMEOUT_MS: Number(process.env.BREVO_TIMEOUT_MS || 10000),
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  SMTP_CONNECTION_TIMEOUT_MS: Number(
    process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000
  ),
  SMTP_GREETING_TIMEOUT_MS: Number(
    process.env.SMTP_GREETING_TIMEOUT_MS || 10000
  ),
  SMTP_SOCKET_TIMEOUT_MS: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000),
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  GEMINI_API_BASE_URL:
    process.env.GEMINI_API_BASE_URL ||
    'https://generativelanguage.googleapis.com/v1beta',
  GEMINI_TIMEOUT_MS: Number(process.env.GEMINI_TIMEOUT_MS || 20000),
  GEMINI_CHAT_API_KEY: process.env.GEMINI_CHAT_API_KEY || '',
  GEMINI_RECEIPT_API_KEY: process.env.GEMINI_RECEIPT_API_KEY || '',
  AI_RATE_LIMIT_WINDOW_MS: Number(process.env.AI_RATE_LIMIT_WINDOW_MS || 60000),
  AI_RATE_LIMIT_MAX: Number(process.env.AI_RATE_LIMIT_MAX || 30),
  AI_CHAT_HISTORY_LIMIT: Number(process.env.AI_CHAT_HISTORY_LIMIT || 12),
  AI_RECEIPT_BODY_LIMIT: process.env.AI_RECEIPT_BODY_LIMIT || '4mb',
  AI_RECEIPT_IMAGE_MAX_BYTES: Number(
    process.env.AI_RECEIPT_IMAGE_MAX_BYTES || 3 * 1024 * 1024
  ),
  PDF_FONT_PATH: process.env.PDF_FONT_PATH || '',
  PDF_BOLD_FONT_PATH: process.env.PDF_BOLD_FONT_PATH || '',
  EXPO_PUSH_URL:
    process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send',
  NOTIFICATION_JOBS_ENABLED:
    process.env.NOTIFICATION_JOBS_ENABLED === 'true' ||
    (process.env.NODE_ENV === 'production' &&
      process.env.NOTIFICATION_JOBS_ENABLED !== 'false'),
  NOTIFICATION_JOB_INTERVAL_MS: Number(
    process.env.NOTIFICATION_JOB_INTERVAL_MS || 60 * 60 * 1000
  ),
};

module.exports = env;
