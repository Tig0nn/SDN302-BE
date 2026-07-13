const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const paymentAccountRepository = require('./paymentAccountRepository');

const router = express.Router();

const paymentAccountParamsSchema = z.object({
  id: z.string().uuid(),
});

const paymentAccountCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  shortName: z.string().trim().min(1).max(40).nullable().optional(),
  type: z.enum(['cash', 'traditional_bank', 'digital_bank', 'e_wallet']),
  color: z.string().trim().min(1).max(40).nullable().optional(),
});

const paymentAccountUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    shortName: z.string().trim().min(1).max(40).nullable().optional(),
    color: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
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

router.get('/', requireAuth, async function getPaymentAccounts(req, res, next) {
  try {
    const paymentAccounts = await paymentAccountRepository.listPaymentAccounts(
      req.user.id
    );

    sendOk(req, res, { paymentAccounts });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requireAuth,
  validate({ body: paymentAccountCreateSchema }),
  async function createPaymentAccount(req, res, next) {
    try {
      const paymentAccount = await paymentAccountRepository.createPaymentAccount(
        req.user.id,
        req.body
      );

      sendOk(req, res, { paymentAccount }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireAuth,
  validate({ params: paymentAccountParamsSchema, body: paymentAccountUpdateSchema }),
  async function updatePaymentAccount(req, res, next) {
    try {
      const paymentAccount = await paymentAccountRepository.updatePaymentAccount(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { paymentAccount });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  validate({ params: paymentAccountParamsSchema }),
  async function deletePaymentAccount(req, res, next) {
    try {
      const paymentAccount = await paymentAccountRepository.deletePaymentAccount(
        req.user.id,
        req.params.id
      );

      sendOk(req, res, { paymentAccount });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
