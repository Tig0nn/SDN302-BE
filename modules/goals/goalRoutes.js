const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const goalRepository = require('./goalRepository');

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
const statusSchema = z.enum(['active', 'completed', 'cancelled']);

const goalParamsSchema = z.object({
  id: uuidSchema,
});

const goalListQuerySchema = z.object({
  ledgerId: uuidSchema,
  status: statusSchema.optional(),
});

const goalCreateSchema = z.object({
  ledgerId: uuidSchema,
  name: z.string().trim().min(1).max(160),
  targetAmountVnd: z.number().int().positive(),
  currentAmountVnd: z.number().int().min(0).optional(),
  deadline: nullableDateSchema.optional(),
  icon: z.string().trim().min(1).max(80).nullable().optional(),
  color: z.string().trim().min(1).max(40).nullable().optional(),
});

const goalUpdateSchema = z
  .object({
    ledgerId: uuidSchema.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    targetAmountVnd: z.number().int().positive().optional(),
    currentAmountVnd: z.number().int().min(0).optional(),
    deadline: nullableDateSchema.optional(),
    icon: z.string().trim().min(1).max(80).nullable().optional(),
    color: z.string().trim().min(1).max(40).nullable().optional(),
    status: statusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

const goalDepositSchema = z.object({
  amountVnd: z.number().int().positive(),
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
  validate({ query: goalListQuerySchema }),
  async function listGoals(req, res, next) {
    try {
      const goals = await goalRepository.listGoals(req.user.id, req.query);

      sendOk(req, res, { goals });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireAuth,
  validate({ body: goalCreateSchema }),
  async function createGoal(req, res, next) {
    try {
      const goal = await goalRepository.createGoal(req.user.id, req.body);

      sendOk(req, res, { goal }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireAuth,
  validate({ params: goalParamsSchema, body: goalUpdateSchema }),
  async function updateGoal(req, res, next) {
    try {
      const goal = await goalRepository.updateGoal(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { goal });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/deposits',
  requireAuth,
  validate({ params: goalParamsSchema, body: goalDepositSchema }),
  async function depositGoal(req, res, next) {
    try {
      const goal = await goalRepository.depositGoal(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { goal });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  validate({ params: goalParamsSchema }),
  async function deleteGoal(req, res, next) {
    try {
      const goal = await goalRepository.deleteGoal(req.user.id, req.params.id);

      sendOk(req, res, { goal });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
