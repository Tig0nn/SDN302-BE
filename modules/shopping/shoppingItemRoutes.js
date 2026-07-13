const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const shoppingRepository = require('./shoppingRepository');

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

const itemParamsSchema = z.object({
  id: uuidSchema,
});

const itemUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    quantity: z.number().positive().optional(),
    estimatedPriceVnd: z.number().int().min(0).optional(),
    isBought: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

const convertSchema = z.object({
  categoryId: uuidSchema,
  subcategoryId: uuidSchema.nullable().optional(),
  transactionDate: dateSchema,
  paymentMethod: z.enum(['cash', 'transfer']),
  paymentAccountId: uuidSchema.nullable().optional(),
  amountVnd: z.number().int().positive().optional(),
  note: z.string().max(500).nullable().optional(),
  clientMutationId: z.string().trim().min(1).max(120).optional(),
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

router.patch(
  '/:id',
  requireAuth,
  validate({ params: itemParamsSchema, body: itemUpdateSchema }),
  async function updateShoppingItem(req, res, next) {
    try {
      const shoppingItem = await shoppingRepository.updateShoppingItem(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { shoppingItem });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  validate({ params: itemParamsSchema }),
  async function deleteShoppingItem(req, res, next) {
    try {
      const shoppingItem = await shoppingRepository.deleteShoppingItem(
        req.user.id,
        req.params.id
      );

      sendOk(req, res, { shoppingItem });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/convert-to-transaction',
  requireAuth,
  validate({ params: itemParamsSchema, body: convertSchema }),
  async function convertShoppingItemToTransaction(req, res, next) {
    try {
      const result = await shoppingRepository.convertShoppingItemToTransaction(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, result, result.idempotent ? 200 : 201);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
