const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const ledgerRepository = require('./ledgerRepository');

const router = express.Router();

const ledgerParamsSchema = z.object({
  id: z.string().uuid(),
});

const ledgerBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
});

function sendOk(req, res, data, statusCode = 200) {
  res.status(statusCode).json({
    data,
    meta: {
      requestId: req.requestId,
    },
    error: null,
  });
}

router.get('/', requireAuth, async function getLedgers(req, res, next) {
  try {
    const ledgers = await ledgerRepository.listLedgers(req.user.id);

    sendOk(req, res, { ledgers });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requireAuth,
  validate({ body: ledgerBodySchema }),
  async function createLedger(req, res, next) {
    try {
      const ledger = await ledgerRepository.createLedger(req.user.id, req.body);

      sendOk(req, res, { ledger }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireAuth,
  validate({ params: ledgerParamsSchema, body: ledgerBodySchema }),
  async function updateLedger(req, res, next) {
    try {
      const ledger = await ledgerRepository.updateLedger(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { ledger });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  validate({ params: ledgerParamsSchema }),
  async function deleteLedger(req, res, next) {
    try {
      const ledger = await ledgerRepository.deleteLedger(req.user.id, req.params.id);

      sendOk(req, res, { ledger });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
