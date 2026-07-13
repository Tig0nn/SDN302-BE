const metrics = require('../modules/observability/metrics');

function metricsMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', function onFinish() {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    metrics.recordHttpRequest(req, res, durationMs);
  });

  next();
}

module.exports = metricsMiddleware;
