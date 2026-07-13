const express = require('express');
const { z } = require('zod');
const env = require('../../config/env');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const aiRateLimit = require('./rateLimit');
const aiService = require('./aiService');
const geminiService = require('./geminiService');
const auditRepository = require('../security/auditRepository');

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
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must use YYYY-MM format');
const pageSchema = z.number().int().min(1).default(1);
const pageSizeSchema = z.number().int().min(1).max(100).default(20);

function hasUniqueItems(values) {
  return new Set(values).size === values.length;
}

function isValidBase64(value) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return false;
  }

  try {
    const normalized = value.replace(/=+$/, '');
    const encoded = Buffer.from(value, 'base64').toString('base64').replace(/=+$/, '');

    return encoded === normalized;
  } catch (err) {
    return false;
  }
}

function getBase64DecodedBytes(value) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;

  return Math.floor((value.length * 3) / 4) - padding;
}

const transactionPreviewSchema = z.object({
  text: z.string().trim().min(1).max(500),
  transactionDate: dateSchema.optional(),
  paymentMethod: z.enum(['cash', 'transfer']).optional(),
  currentDate: dateSchema.optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
});

const chatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  ledgerId: uuidSchema,
  conversationId: uuidSchema.optional(),
  saveHistory: z.boolean().default(true),
  currentDate: dateSchema.optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
});

const transactionCreatePayloadSchema = z
  .object({
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
    clientMutationId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
const transactionListPayloadSchema = z
  .object({
    ledgerId: uuidSchema,
    dateFrom: dateSchema.optional(),
    dateTo: dateSchema.optional(),
    type: z.enum(['income', 'expense']).optional(),
    categoryId: uuidSchema.optional(),
    search: z.string().trim().min(1).max(120).optional(),
    page: pageSchema,
    pageSize: pageSizeSchema,
  })
  .strict();
const summaryPayloadSchema = z
  .object({
    ledgerId: uuidSchema,
    dateFrom: dateSchema.optional(),
    dateTo: dateSchema.optional(),
  })
  .strict();
const deleteTransactionPayloadSchema = z
  .object({
    transactionId: uuidSchema,
  })
  .strict();
const deleteMultipleTransactionsPayloadSchema = z
  .object({
    transactionIds: z
      .array(uuidSchema)
      .min(1)
      .max(100)
      .refine(hasUniqueItems, 'transactionIds must be unique'),
    confirmed: z.boolean().optional(),
  })
  .strict();
const budgetStatusPayloadSchema = z
  .object({
    ledgerId: uuidSchema,
    month: monthSchema,
  })
  .strict();
const topCategoriesPayloadSchema = z
  .object({
    ledgerId: uuidSchema,
    type: z.enum(['income', 'expense']).default('expense'),
    dateFrom: dateSchema.optional(),
    dateTo: dateSchema.optional(),
    limit: z.number().int().min(1).max(20).default(5),
  })
  .strict();

const executeActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('createTransaction'),
    payload: transactionCreatePayloadSchema,
  }),
  z.object({
    action: z.literal('getTransactionsByDateRange'),
    payload: transactionListPayloadSchema,
  }),
  z.object({
    action: z.enum(['getBalance', 'getTotalIncome', 'getTotalExpense']),
    payload: summaryPayloadSchema,
  }),
  z.object({
    action: z.literal('deleteTransaction'),
    payload: deleteTransactionPayloadSchema,
  }),
  z.object({
    action: z.literal('deleteMultipleTransactions'),
    payload: deleteMultipleTransactionsPayloadSchema,
  }),
  z.object({
    action: z.literal('getBudgetStatus'),
    payload: budgetStatusPayloadSchema,
  }),
  z.object({
    action: z.literal('getTopCategories'),
    payload: topCategoriesPayloadSchema,
  }),
]);

const receiptScanSchema = z.object({
  ledgerId: uuidSchema,
  imageBase64: z
    .string()
    .trim()
    .min(1)
    .refine(isValidBase64, 'imageBase64 must be valid base64')
    .refine(
      (value) => getBase64DecodedBytes(value) <= env.AI_RECEIPT_IMAGE_MAX_BYTES,
      'imageBase64 exceeds the configured receipt image size limit'
    ),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  currentDate: dateSchema.optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
  preferredPaymentMethod: z.enum(['cash', 'transfer']).optional(),
});

const conversationParamsSchema = z.object({
  id: uuidSchema,
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

router.use(requireAuth, aiRateLimit);

router.post(
  '/transaction-preview',
  validate({ body: transactionPreviewSchema }),
  async function transactionPreview(req, res, next) {
    try {
      const result = await aiService.inferTransactionPreview(req.user.id, req.body);

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/execute-action',
  validate({ body: executeActionSchema }),
  async function executeAction(req, res, next) {
    try {
      const result = await aiService.executeAction(
        req.user.id,
        req.body.action,
        req.body.payload
      );

      await auditRepository.recordAuditEvent(req, 'ai.action_executed', {
        action: req.body.action,
        ledgerId: req.body.payload?.ledgerId || null,
        transactionCount: Array.isArray(result.transactions)
          ? result.transactions.length
          : result.transaction
            ? 1
            : 0,
      });

      if (req.body.action === 'deleteMultipleTransactions') {
        await auditRepository.recordAuditEvent(req, 'transactions.bulk_delete', {
          source: 'ai',
          transactionCount: result.transactions.length,
        });
      }

      sendOk(req, res, result, req.body.action === 'createTransaction' ? 201 : 200);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/chat',
  validate({ body: chatSchema }),
  async function chat(req, res, next) {
    try {
      const apiKey = geminiService.requireChatGeminiApiKey();
      const result = await aiService.chat(req.user.id, req.body, apiKey);

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/receipt-scan',
  validate({ body: receiptScanSchema }),
  async function receiptScan(req, res, next) {
    try {
      const apiKey = geminiService.requireReceiptGeminiApiKey(req);
      const result = await aiService.scanReceipt(req.user.id, req.body, apiKey);

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.get('/conversations', async function listConversations(req, res, next) {
  try {
    const conversations = await aiService.listConversations(req.user.id);

    sendOk(req, res, { conversations });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/conversations/:id/messages',
  validate({ params: conversationParamsSchema }),
  async function listMessages(req, res, next) {
    try {
      const messages = await aiService.listMessages(req.user.id, req.params.id);

      sendOk(req, res, { messages });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
