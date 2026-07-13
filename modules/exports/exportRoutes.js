const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const transactionRepository = require('../transactions/transactionRepository');
const exportService = require('./exportService');

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

const exportQuerySchema = z.object({
  ledgerId: uuidSchema,
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  type: z.enum(['income', 'expense']).optional(),
  categoryId: uuidSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

function setDownloadHeaders(res, contentType, filename) {
  res.setHeader('content-type', contentType);
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
}

async function loadTransactions(req) {
  return transactionRepository.exportTransactions(req.user.id, {
    ...req.query,
    limit: 10000,
  });
}

router.use(requireAuth);

router.get(
  '/transactions.csv',
  validate({ query: exportQuerySchema }),
  async function exportCsv(req, res, next) {
    try {
      const transactions = await loadTransactions(req);
      const csv = exportService.createCsv(transactions);

      setDownloadHeaders(res, 'text/csv; charset=utf-8', 'transactions.csv');
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/transactions.xlsx',
  validate({ query: exportQuerySchema }),
  async function exportXlsx(req, res, next) {
    try {
      const transactions = await loadTransactions(req);
      const workbook = await exportService.createXlsx(transactions);

      setDownloadHeaders(
        res,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'transactions.xlsx'
      );
      res.status(200).send(workbook);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/transactions.pdf',
  validate({ query: exportQuerySchema }),
  async function exportPdf(req, res, next) {
    try {
      const transactions = await loadTransactions(req);
      const pdf = await exportService.createPdf(transactions);

      setDownloadHeaders(res, 'application/pdf', 'transactions.pdf');
      res.status(200).send(pdf);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
