const env = require('../../config/env');

const buckets = new Map();

function rateLimitKey(req) {
  return req.user?.id || req.ip || 'anonymous';
}

function cleanup(now) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function aiRateLimit(req, res, next) {
  const now = Date.now();
  const key = rateLimitKey(req);
  const existing = buckets.get(key);

  cleanup(now);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + env.AI_RATE_LIMIT_WINDOW_MS,
    });
    next();
    return;
  }

  existing.count += 1;

  if (existing.count > env.AI_RATE_LIMIT_MAX) {
    const err = new Error('AI rate limit exceeded');

    err.code = 'AI_RATE_LIMITED';
    err.status = 429;
    res.setHeader(
      'retry-after',
      String(Math.max(1, Math.ceil((existing.resetAt - now) / 1000)))
    );
    next(err);
    return;
  }

  next();
}

module.exports = aiRateLimit;
