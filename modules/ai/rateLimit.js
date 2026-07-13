const env = require('../../config/env');
const db = require('../../config/db');

function rateLimitKey(req) {
  return req.user?.id || req.ip || 'anonymous';
}

function windowStartFor(now, windowMs) {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/**
 * Đếm request AI theo cửa sổ cố định, lưu ở Postgres (bảng rate_limit_buckets,
 * scope 'ai') thay vì Map() trong RAM - xem middlewares/rateLimit.js.
 */
async function incrementBucket(key, now, windowMs) {
  const windowStart = windowStartFor(now, windowMs);

  const result = await db.query(
    `
      insert into rate_limit_buckets (key, scope, window_start, count)
      values ($1, 'ai', $2, 1)
      on conflict (key, scope) do update
        set count = case
              when rate_limit_buckets.window_start = excluded.window_start
                then rate_limit_buckets.count + 1
              else 1
            end,
            window_start = excluded.window_start
      returning count, window_start
    `,
    [key, windowStart]
  );

  return result.rows[0];
}

async function aiRateLimit(req, res, next) {
  const now = Date.now();
  const key = rateLimitKey(req);
  const windowMs = env.AI_RATE_LIMIT_WINDOW_MS;

  let bucket;

  try {
    bucket = await incrementBucket(key, now, windowMs);
  } catch (err) {
    // Fail open - lỗi ở store rate-limit không được chặn tính năng AI.
    console.error({ event: 'ai_rate_limit_store_error', error: err.message });
    next();
    return;
  }

  const resetAt = new Date(bucket.window_start).getTime() + windowMs;

  if (bucket.count > env.AI_RATE_LIMIT_MAX) {
    const err = new Error('AI rate limit exceeded');

    err.code = 'AI_RATE_LIMITED';
    err.status = 429;
    res.setHeader('retry-after', String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
    next(err);
    return;
  }

  next();
}

module.exports = function aiRateLimitMiddleware(req, res, next) {
  aiRateLimit(req, res, next).catch(next);
};
