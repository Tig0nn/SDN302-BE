const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const transactionRepository = require('./transactionRepository');

const router = express.Router();

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function monthBounds(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;

  return {
    monthStart: `${year.toString().padStart(4, '0')}-${monthNumber
      .toString()
      .padStart(2, '0')}-01`,
    nextMonthStart: `${nextYear.toString().padStart(4, '0')}-${nextMonth
      .toString()
      .padStart(2, '0')}-01`,
  };
}

const dateSchema = z.string().refine(isValidDateString, {
  message: 'Date must be a valid YYYY-MM-DD value',
});

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must use YYYY-MM format');

const uuidSchema = z.string().uuid();

const transactionParamsSchema = z.object({
  id: uuidSchema,
});

const listQuerySchema = z.object({
  ledgerId: uuidSchema,
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  type: z.enum(['income', 'expense']).optional(),
  categoryId: uuidSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const summaryQuerySchema = z.object({
  ledgerId: uuidSchema,
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
});

const calendarQuerySchema = z.object({
  ledgerId: uuidSchema,
  month: monthSchema,
});

const transactionCreateSchema = z.object({
  ledgerId: uuidSchema,
  type: z.enum(['income', 'expense']),
  amountVnd: z.number().int().positive(),
  categoryId: uuidSchema,
  subcategoryId: uuidSchema.nullable().optional(),
  transactionDate: dateSchema,
  note: z.string().max(500).optional(),
  paymentMethod: z.enum(['cash', 'transfer']),
  paymentAccountId: uuidSchema.nullable().optional(),
  receiptImageUrl: z.string().url().nullable().optional(),
  source: z
    .enum(['manual', 'ai', 'receipt_scan', 'import', 'shopping_plan'])
    .default('manual'),
  clientMutationId: z.string().trim().min(1).max(120).optional(),
});

const transactionUpdateSchema = z
  .object({
    ledgerId: uuidSchema.optional(),
    type: z.enum(['income', 'expense']).optional(),
    amountVnd: z.number().int().positive().optional(),
    categoryId: uuidSchema.optional(),
    subcategoryId: uuidSchema.nullable().optional(),
    transactionDate: dateSchema.optional(),
    note: z.string().max(500).optional(),
    paymentMethod: z.enum(['cash', 'transfer']).optional(),
    paymentAccountId: uuidSchema.nullable().optional(),
    receiptImageUrl: z.string().url().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

const transactionBulkSchema = z.object({
  transactions: z.array(transactionCreateSchema).min(1).max(100),
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
  validate({ query: listQuerySchema }),
  async function listTransactions(req, res, next) {
    try {
      const result = await transactionRepository.listTransactions(
        req.user.id,
        req.query
      );

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireAuth,
  validate({ body: transactionCreateSchema }),
  async function createTransaction(req, res, next) {
    try {
      const transaction = await transactionRepository.createTransaction(
        req.user.id,
        req.body
      );

      sendOk(req, res, { transaction }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/bulk',
  requireAuth,
  validate({ body: transactionBulkSchema }),
  async function bulkCreateTransactions(req, res, next) {
    try {
      const transactions = await transactionRepository.bulkCreateTransactions(
        req.user.id,
        req.body.transactions
      );

      sendOk(req, res, { transactions }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/summary',
  requireAuth,
  validate({ query: summaryQuerySchema }),
  async function getSummary(req, res, next) {
    try {
      const summary = await transactionRepository.getSummary(req.user.id, req.query);

      sendOk(req, res, { summary });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/calendar',
  requireAuth,
  validate({ query: calendarQuerySchema }),
  async function getCalendarSummary(req, res, next) {
    try {
      const calendar = await transactionRepository.getCalendarSummary(req.user.id, {
        ledgerId: req.query.ledgerId,
        ...monthBounds(req.query.month),
      });

      sendOk(req, res, { calendar });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requireAuth,
  validate({ params: transactionParamsSchema }),
  async function getTransaction(req, res, next) {
    try {
      const transaction = await transactionRepository.getTransaction(
        req.user.id,
        req.params.id
      );

      sendOk(req, res, { transaction });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireAuth,
  validate({ params: transactionParamsSchema, body: transactionUpdateSchema }),
  async function updateTransaction(req, res, next) {
    try {
      const transaction = await transactionRepository.updateTransaction(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { transaction });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  validate({ params: transactionParamsSchema }),
  async function deleteTransaction(req, res, next) {
    try {
      const transaction = await transactionRepository.deleteTransaction(
        req.user.id,
        req.params.id
      );

      sendOk(req, res, { transaction });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
