const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const budgetRepository = require('./budgetRepository');

const router = express.Router();

const uuidSchema = z.string().uuid();
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must use YYYY-MM format');

const budgetParamsSchema = z.object({
  id: uuidSchema,
});

const budgetListQuerySchema = z.object({
  ledgerId: uuidSchema,
  month: monthSchema.transform((value) => `${value}-01`),
});

const budgetCreateSchema = z.object({
  ledgerId: uuidSchema,
  categoryId: uuidSchema.nullable().optional(),
  month: monthSchema,
  limitAmountVnd: z.number().int().positive(),
  warningThreshold: z.number().int().min(1).max(100).default(80),
});

const budgetUpdateSchema = z
  .object({
    limitAmountVnd: z.number().int().positive().optional(),
    warningThreshold: z.number().int().min(1).max(100).optional(),
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

router.get(
  '/',
  requireAuth,
  validate({ query: budgetListQuerySchema }),
  async function listBudgets(req, res, next) {
    try {
      const budgets = await budgetRepository.listBudgets(req.user.id, req.query);

      sendOk(req, res, { budgets });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requireAuth,
  validate({ params: budgetParamsSchema }),
  async function getBudget(req, res, next) {
    try {
      const budget = await budgetRepository.getBudgetWithProgress(
        req.user.id,
        req.params.id
      );

      sendOk(req, res, { budget });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireAuth,
  validate({ body: budgetCreateSchema }),
  async function createBudget(req, res, next) {
    try {
      const budget = await budgetRepository.createBudget(req.user.id, req.body);

      sendOk(req, res, { budget }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireAuth,
  validate({ params: budgetParamsSchema, body: budgetUpdateSchema }),
  async function updateBudget(req, res, next) {
    try {
      const budget = await budgetRepository.updateBudget(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { budget });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  validate({ params: budgetParamsSchema }),
  async function deleteBudget(req, res, next) {
    try {
      const budget = await budgetRepository.deleteBudget(req.user.id, req.params.id);

      sendOk(req, res, { budget });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
