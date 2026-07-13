const db = require('../../config/db');

const SNAPSHOT_WINDOW = "interval '1 hour'";

let startedAt = new Date();

function routeKey(req) {
  const path = (req.originalUrl || req.path || 'unknown').split('?')[0];

  return { method: req.method, route: path };
}

/**
 * Ghi 1 dòng metrics vào Postgres (bảng request_metrics) thay vì cộng dồn
 * trong biến RAM - giữ được số liệu qua restart và đúng khi chạy nhiều
 * instance. Fire-and-forget: không await ở middleware gọi hàm này, nên tự
 * nuốt lỗi ở đây để không bao giờ tạo unhandled rejection.
 */
function recordHttpRequest(req, res, durationMs) {
  const { method, route } = routeKey(req);

  return db
    .query(
      `
        insert into request_metrics (method, route, status_code, duration_ms)
        values ($1, $2, $3, $4)
      `,
      [method, route, res.statusCode, durationMs]
    )
    .catch((err) => {
      console.error({ event: 'metrics_write_failed', error: err.message });
    });
}

function roundMs(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function getHttpMetrics() {
  const [summaryResult, statusResult, routeResult] = await Promise.all([
    db.query(`
      select
        count(*)::int as "requestCount",
        count(*) filter (where status_code >= 500)::int as "serverErrorCount",
        coalesce(avg(duration_ms), 0) as "averageDurationMs",
        coalesce(max(duration_ms), 0) as "maxDurationMs",
        coalesce(percentile_cont(0.95) within group (order by duration_ms), 0) as "p95DurationMs"
      from request_metrics
      where created_at > now() - ${SNAPSHOT_WINDOW}
    `),
    db.query(`
      select status_code::text as status, count(*)::int as count
      from request_metrics
      where created_at > now() - ${SNAPSHOT_WINDOW}
      group by status_code
      order by status_code
    `),
    db.query(`
      select method || ' ' || route as route, count(*)::int as count
      from request_metrics
      where created_at > now() - ${SNAPSHOT_WINDOW}
      group by method, route
      order by method || ' ' || route
    `),
  ]);

  const summary = summaryResult.rows[0] || {
    requestCount: 0,
    serverErrorCount: 0,
    averageDurationMs: 0,
    maxDurationMs: 0,
    p95DurationMs: 0,
  };

  return {
    startedAt: startedAt.toISOString(),
    windowSeconds: 3600,
    requestCount: summary.requestCount,
    serverErrorCount: summary.serverErrorCount,
    errorRate:
      summary.requestCount === 0 ? 0 : summary.serverErrorCount / summary.requestCount,
    latencyMs: {
      average: roundMs(summary.averageDurationMs),
      max: roundMs(summary.maxDurationMs),
      p95: roundMs(summary.p95DurationMs),
    },
    statusCounts: Object.fromEntries(statusResult.rows.map((row) => [row.status, row.count])),
    routeCounts: Object.fromEntries(routeResult.rows.map((row) => [row.route, row.count])),
  };
}

async function getMetricsSnapshot() {
  return {
    http: await getHttpMetrics(),
    db: db.getPoolStats(),
  };
}

async function resetMetrics() {
  startedAt = new Date();
  await db.query('truncate table request_metrics');
}

module.exports = {
  getMetricsSnapshot,
  recordHttpRequest,
  resetMetrics,
};
