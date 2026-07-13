const env = require('../config/env');
const db = require('../config/db');

function getClientKey(req) {
  return req.user?.id || req.ip || req.socket?.remoteAddress || 'unknown';
}

function windowStartFor(now, windowMs) {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

function sendRateLimitError(req, res, retryAfterSeconds) {
  res.setHeader('retry-after', String(retryAfterSeconds));
  res.status(429).json({
    data: null,
    meta: {
      requestId: req.requestId,
    },
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests',
      details: [],
    },
  });
}

/**
 * Đếm request theo cửa sổ cố định, lưu ở Postgres (bảng rate_limit_buckets)
 * thay vì Map() trong RAM - đảm bảo đúng khi chạy nhiều instance và không
 * mất đếm khi restart. 1 UPSERT nguyên tử mỗi request.
 */
async function incrementBucket(scope, key, now, windowMs) {
  const windowStart = windowStartFor(now, windowMs);

  const result = await db.query(
    `
      insert into rate_limit_buckets (key, scope, window_start, count)
      values ($1, $2, $3, 1)
      on conflict (key, scope) do update
        set count = case
              when rate_limit_buckets.window_start = excluded.window_start
                then rate_limit_buckets.count + 1
              else 1
            end,
            window_start = excluded.window_start
      returning count, window_start
    `,
    [key, scope, windowStart]
  );

  return result.rows[0];
}

async function rateLimit(req, res, next) {
  const maxRequests = Number(env.RATE_LIMIT_MAX || 300);
  const windowMs = Number(env.RATE_LIMIT_WINDOW_MS || 60_000);

  if (maxRequests <= 0 || windowMs <= 0) {
    next();
    return;
  }

  const now = Date.now();
  const key = getClientKey(req);

  let bucket;

  try {
    bucket = await incrementBucket('global', key, now, windowMs);
  } catch (err) {
    // Fail open: 1 lỗi thoáng qua ở store rate-limit không được phép làm
    // sập cả API - thà tạm thời không giới hạn còn hơn từ chối mọi request.
    console.error({ event: 'rate_limit_store_error', error: err.message });
    next();
    return;
  }

  const resetAt = new Date(bucket.window_start).getTime() + windowMs;

  res.setHeader('x-ratelimit-limit', String(maxRequests));
  res.setHeader('x-ratelimit-remaining', String(Math.max(0, maxRequests - bucket.count)));
  res.setHeader('x-ratelimit-reset', new Date(resetAt).toISOString());

  if (bucket.count > maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

    sendRateLimitError(req, res, retryAfterSeconds);
    return;
  }

  next();
}

async function resetRateLimit() {
  await db.query('truncate table rate_limit_buckets');
}

module.exports = function rateLimitMiddleware(req, res, next) {
  rateLimit(req, res, next).catch(next);
};
module.exports.resetRateLimit = resetRateLimit;
