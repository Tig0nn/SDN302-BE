var express = require('express');
var router = express.Router();

router.get('/', function(req, res, next) {
  res.json({
    data: {
      ok: true,
      service: 'vi-vi-vu-api',
      health: '/health',
      apiHealth: '/api/v1/health'
    },
    meta: {
      requestId: req.requestId
    },
    error: null
  });
});

module.exports = router;
