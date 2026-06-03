const express = require('express');
const { z } = require('zod');
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
  saveHistory: z.boolean().default(false),
  currentDate: dateSchema.optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
});

const executeActionSchema = z.object({
  action: z.enum([
    'createTransaction',
    'getTransactionsByDateRange',
    'getBalance',
    'getTotalIncome',
    'getTotalExpense',
    'deleteTransaction',
    'deleteMultipleTransactions',
    'getBudgetStatus',
    'getTopCategories',
  ]),
  payload: z.record(z.string(), z.any()).default({}),
});

const receiptScanSchema = z.object({
  imageBase64: z.string().trim().min(1),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
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
      const apiKey = geminiService.requireGeminiApiKey(req);
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
      const apiKey = geminiService.requireGeminiApiKey(req);
      const result = await aiService.scanReceipt(req.body, apiKey);

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
