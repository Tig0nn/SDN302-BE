const express = require('express');
const metrics = require('../modules/observability/metrics');

const router = express.Router();

router.get('/', async function getMetrics(req, res, next) {
  try {
    res.json({
      data: await metrics.getMetricsSnapshot(),
      meta: {
        requestId: req.requestId,
      },
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
