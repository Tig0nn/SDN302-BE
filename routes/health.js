const express = require('express');
const db = require('../config/db');
const env = require('../config/env');

const router = express.Router();

function sendOk(req, res, data, meta) {
  res.json({
    data,
    meta: {
      requestId: req.requestId,
      ...(meta || {}),
    },
    error: null,
  });
}

router.get('/', function getHealth(req, res) {
  sendOk(req, res, {
    ok: true,
    service: 'vi-vi-vu-api',
    environment: env.NODE_ENV,
  });
});

router.get('/db', async function getDbHealth(req, res, next) {
  try {
    const result = await db.query('select now() as server_time');

    sendOk(req, res, {
      ok: true,
      server_time: result.rows[0].server_time,
    });
  } catch (err) {
    err.code = err.code || 'DB_HEALTH_CHECK_FAILED';
    next(err);
  }
});

module.exports = router;
