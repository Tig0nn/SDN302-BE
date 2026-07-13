const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const shoppingRepository = require('./shoppingRepository');

const router = express.Router();

const uuidSchema = z.string().uuid();

const planParamsSchema = z.object({
  id: uuidSchema,
});

const planListQuerySchema = z.object({
  ledgerId: uuidSchema,
});

const planCreateSchema = z.object({
  ledgerId: uuidSchema,
  name: z.string().trim().min(1).max(160),
  budgetAmountVnd: z.number().int().min(0).default(0),
});

const planUpdateSchema = z
  .object({
    ledgerId: uuidSchema.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    budgetAmountVnd: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

const itemCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  quantity: z.number().positive().default(1),
  estimatedPriceVnd: z.number().int().min(0).default(0),
  isBought: z.boolean().default(false),
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
  validate({ query: planListQuerySchema }),
  async function listShoppingPlans(req, res, next) {
    try {
      const shoppingPlans = await shoppingRepository.listShoppingPlans(
        req.user.id,
        req.query
      );

      sendOk(req, res, { shoppingPlans });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireAuth,
  validate({ body: planCreateSchema }),
  async function createShoppingPlan(req, res, next) {
    try {
      const shoppingPlan = await shoppingRepository.createShoppingPlan(
        req.user.id,
        req.body
      );

      sendOk(req, res, { shoppingPlan }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requireAuth,
  validate({ params: planParamsSchema }),
  async function getShoppingPlan(req, res, next) {
    try {
      const result = await shoppingRepository.getShoppingPlan(
        req.user.id,
        req.params.id
      );

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireAuth,
  validate({ params: planParamsSchema, body: planUpdateSchema }),
  async function updateShoppingPlan(req, res, next) {
    try {
      const shoppingPlan = await shoppingRepository.updateShoppingPlan(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { shoppingPlan });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  validate({ params: planParamsSchema }),
  async function deleteShoppingPlan(req, res, next) {
    try {
      const shoppingPlan = await shoppingRepository.deleteShoppingPlan(
        req.user.id,
        req.params.id
      );

      sendOk(req, res, { shoppingPlan });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/items',
  requireAuth,
  validate({ params: planParamsSchema, body: itemCreateSchema }),
  async function createShoppingItem(req, res, next) {
    try {
      const shoppingItem = await shoppingRepository.createShoppingItem(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { shoppingItem }, 201);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
