const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const debtRepository = require('./debtRepository');

const router = express.Router();

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const uuidSchema = z.string().uuid();
const dateSchema = z.string().refine(isValidDateString, {
  message: 'Date must be a valid YYYY-MM-DD value',
});
const nullableDateSchema = dateSchema.nullable();
const statusSchema = z.enum(['active', 'paid', 'overdue', 'cancelled']);

const debtParamsSchema = z.object({
  id: uuidSchema,
});

const debtListQuerySchema = z.object({
  ledgerId: uuidSchema,
  status: statusSchema.optional(),
});

const debtCreateSchema = z.object({
  ledgerId: uuidSchema,
  direction: z.enum(['borrowed', 'lent']),
  counterpartyName: z.string().trim().min(1).max(160),
  amountVnd: z.number().int().positive(),
  dueDate: nullableDateSchema.optional(),
  note: z.string().max(500).nullable().optional(),
});

const debtUpdateSchema = z
  .object({
    ledgerId: uuidSchema.optional(),
    direction: z.enum(['borrowed', 'lent']).optional(),
    counterpartyName: z.string().trim().min(1).max(160).optional(),
    amountVnd: z.number().int().positive().optional(),
    remainingAmountVnd: z.number().int().min(0).optional(),
    dueDate: nullableDateSchema.optional(),
    note: z.string().max(500).nullable().optional(),
    status: statusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

const debtPaymentSchema = z.object({
  amountVnd: z.number().int().positive(),
  paidAt: dateSchema,
  note: z.string().max(500).nullable().optional(),
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

router.get(
  '/',
  requireAuth,
  validate({ query: debtListQuerySchema }),
  async function listDebts(req, res, next) {
    try {
      const debts = await debtRepository.listDebts(req.user.id, req.query);

      sendOk(req, res, { debts });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireAuth,
  validate({ body: debtCreateSchema }),
  async function createDebt(req, res, next) {
    try {
      const debt = await debtRepository.createDebt(req.user.id, req.body);

      sendOk(req, res, { debt }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireAuth,
  validate({ params: debtParamsSchema, body: debtUpdateSchema }),
  async function updateDebt(req, res, next) {
    try {
      const debt = await debtRepository.updateDebt(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { debt });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/payments',
  requireAuth,
  validate({ params: debtParamsSchema, body: debtPaymentSchema }),
  async function payDebt(req, res, next) {
    try {
      const result = await debtRepository.payDebt(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, result, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  validate({ params: debtParamsSchema }),
  async function deleteDebt(req, res, next) {
    try {
      const debt = await debtRepository.deleteDebt(req.user.id, req.params.id);

      sendOk(req, res, { debt });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
