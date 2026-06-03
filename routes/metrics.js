const express = require('express');
const metrics = require('../modules/observability/metrics');

const router = express.Router();

router.get('/', function getMetrics(req, res) {
  res.json({
    data: metrics.getMetricsSnapshot(),
    meta: {
      requestId: req.requestId,
    },
    error: null,
  });
});

module.exports = router;
