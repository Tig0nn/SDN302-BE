const db = require('../../config/db');

const MAX_LATENCY_SAMPLES = 500;

const state = {
  startedAt: new Date(),
  requestCount: 0,
  serverErrorCount: 0,
  totalDurationMs: 0,
  maxDurationMs: 0,
  statusCounts: new Map(),
  routeCounts: new Map(),
  latencySamples: [],
};

function incrementMap(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function routeKey(req) {
  const path = (req.originalUrl || req.path || 'unknown').split('?')[0];

  return `${req.method} ${path}`;
}

function recordHttpRequest(req, res, durationMs) {
  state.requestCount += 1;
  state.totalDurationMs += durationMs;
  state.maxDurationMs = Math.max(state.maxDurationMs, durationMs);
  state.latencySamples.push(durationMs);

  if (state.latencySamples.length > MAX_LATENCY_SAMPLES) {
    state.latencySamples.shift();
  }

  if (res.statusCode >= 500) {
    state.serverErrorCount += 1;
  }

  incrementMap(state.statusCounts, String(res.statusCode));
  incrementMap(state.routeCounts, routeKey(req));
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * ratio) - 1
  );

  return sorted[index];
}

function roundMs(value) {
  return Math.round(value * 100) / 100;
}

function mapToObject(map) {
  return Object.fromEntries([...map.entries()].sort());
}

function getHttpMetrics() {
  const average =
    state.requestCount === 0 ? 0 : state.totalDurationMs / state.requestCount;

  return {
    startedAt: state.startedAt.toISOString(),
    requestCount: state.requestCount,
    serverErrorCount: state.serverErrorCount,
    errorRate:
      state.requestCount === 0 ? 0 : state.serverErrorCount / state.requestCount,
    latencyMs: {
      average: roundMs(average),
      max: roundMs(state.maxDurationMs),
      p95: roundMs(percentile(state.latencySamples, 0.95)),
    },
    statusCounts: mapToObject(state.statusCounts),
    routeCounts: mapToObject(state.routeCounts),
  };
}

function getMetricsSnapshot() {
  return {
    http: getHttpMetrics(),
    db: db.getPoolStats(),
  };
}

function resetMetrics() {
  state.startedAt = new Date();
  state.requestCount = 0;
  state.serverErrorCount = 0;
  state.totalDurationMs = 0;
  state.maxDurationMs = 0;
  state.statusCounts.clear();
  state.routeCounts.clear();
  state.latencySamples = [];
}

module.exports = {
  getMetricsSnapshot,
  recordHttpRequest,
  resetMetrics,
};
