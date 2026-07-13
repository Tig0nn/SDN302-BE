const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const analyticsRepository = require('./analyticsRepository');

const router = express.Router();

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const dateSchema = z.string().refine(isValidDateString, {
  message: 'Date must be a valid YYYY-MM-DD value',
});

const baseQuerySchema = z.object({
  ledgerId: z.string().uuid(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
});

const categoryBreakdownQuerySchema = baseQuerySchema.extend({
  type: z.enum(['income', 'expense']).default('expense'),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

function sendOk(req, res, data) {
  res.json({
    data,
    meta: {
      requestId: req.requestId,
    },
    error: null,
  });
}

router.get(
  '/overview',
  requireAuth,
  validate({ query: baseQuerySchema }),
  async function getOverview(req, res, next) {
    try {
      const overview = await analyticsRepository.getOverview(req.user.id, req.query);

      sendOk(req, res, { overview });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/category-breakdown',
  requireAuth,
  validate({ query: categoryBreakdownQuerySchema }),
  async function getCategoryBreakdown(req, res, next) {
    try {
      const categories = await analyticsRepository.getCategoryBreakdown(
        req.user.id,
        req.query
      );

      sendOk(req, res, { categories });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/daily-spending',
  requireAuth,
  validate({ query: baseQuerySchema }),
  async function getDailySpending(req, res, next) {
    try {
      const days = await analyticsRepository.getDailySpending(req.user.id, req.query);

      sendOk(req, res, { days });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/daily-trend',
  requireAuth,
  validate({ query: baseQuerySchema }),
  async function getDailyTrend(req, res, next) {
    try {
      const days = await analyticsRepository.getDailyTrend(req.user.id, req.query);

      sendOk(req, res, { days });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/monthly-trend',
  requireAuth,
  validate({ query: baseQuerySchema }),
  async function getMonthlyTrend(req, res, next) {
    try {
      const months = await analyticsRepository.getMonthlyTrend(req.user.id, req.query);

      sendOk(req, res, { months });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/fluctuation',
  requireAuth,
  validate({ query: baseQuerySchema }),
  async function getFluctuation(req, res, next) {
    try {
      const points = await analyticsRepository.getFluctuation(req.user.id, req.query);

      sendOk(req, res, { points });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
