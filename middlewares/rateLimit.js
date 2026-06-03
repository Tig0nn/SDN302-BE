const env = require('../config/env');

const buckets = new Map();

function getClientKey(req) {
  return req.user?.id || req.ip || req.socket?.remoteAddress || 'unknown';
}

function getNow() {
  return Date.now();
}

function cleanup(now) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
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

function rateLimit(req, res, next) {
  const maxRequests = Number(env.RATE_LIMIT_MAX || 300);
  const windowMs = Number(env.RATE_LIMIT_WINDOW_MS || 60_000);

  if (maxRequests <= 0 || windowMs <= 0) {
    next();
    return;
  }

  const now = getNow();
  const key = getClientKey(req);
  let bucket = buckets.get(key);

  cleanup(now);

  if (!bucket || bucket.resetAt <= now) {
    bucket = {
      count: 0,
      resetAt: now + windowMs,
    };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  res.setHeader('x-ratelimit-limit', String(maxRequests));
  res.setHeader('x-ratelimit-remaining', String(Math.max(0, maxRequests - bucket.count)));
  res.setHeader('x-ratelimit-reset', new Date(bucket.resetAt).toISOString());

  if (bucket.count > maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    sendRateLimitError(req, res, retryAfterSeconds);
    return;
  }

  next();
}

function resetRateLimit() {
  buckets.clear();
}

module.exports = rateLimit;
module.exports.resetRateLimit = resetRateLimit;
