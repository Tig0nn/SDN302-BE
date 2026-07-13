const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const challengeRepository = require('./challengeRepository');

const router = express.Router();

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidRange(value) {
  if (!value.startDate || !value.endDate) return true;

  return value.endDate >= value.startDate;
}

const uuidSchema = z.string().uuid();
const dateSchema = z.string().refine(isValidDateString, {
  message: 'Date must be a valid YYYY-MM-DD value',
});
const statusSchema = z.enum(['active', 'completed', 'cancelled']);

const challengeParamsSchema = z.object({
  id: uuidSchema,
});

const challengeListQuerySchema = z.object({
  ledgerId: uuidSchema,
  status: statusSchema.optional(),
});

const challengeCreateSchema = z
  .object({
    ledgerId: uuidSchema,
    name: z.string().trim().min(1).max(160),
    targetAmountVnd: z.number().int().positive().nullable().optional(),
    startDate: dateSchema,
    endDate: dateSchema,
  })
  .refine(isValidRange, {
    message: 'endDate must be on or after startDate',
  });

const challengeUpdateSchema = z
  .object({
    ledgerId: uuidSchema.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    targetAmountVnd: z.number().int().positive().nullable().optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    status: statusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  })
  .refine(isValidRange, {
    message: 'endDate must be on or after startDate',
  });

const challengeCheckinSchema = z.object({
  checkinDate: dateSchema,
  amountVnd: z.number().int().min(0).default(0),
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
  validate({ query: challengeListQuerySchema }),
  async function listChallenges(req, res, next) {
    try {
      const challenges = await challengeRepository.listChallenges(
        req.user.id,
        req.query
      );

      sendOk(req, res, { challenges });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireAuth,
  validate({ body: challengeCreateSchema }),
  async function createChallenge(req, res, next) {
    try {
      const challenge = await challengeRepository.createChallenge(
        req.user.id,
        req.body
      );

      sendOk(req, res, { challenge }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireAuth,
  validate({ params: challengeParamsSchema, body: challengeUpdateSchema }),
  async function updateChallenge(req, res, next) {
    try {
      const challenge = await challengeRepository.updateChallenge(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { challenge });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/checkins',
  requireAuth,
  validate({ params: challengeParamsSchema, body: challengeCheckinSchema }),
  async function checkInChallenge(req, res, next) {
    try {
      const result = await challengeRepository.checkInChallenge(
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

router.delete(
  '/:id',
  requireAuth,
  validate({ params: challengeParamsSchema }),
  async function deleteChallenge(req, res, next) {
    try {
      const challenge = await challengeRepository.deleteChallenge(
        req.user.id,
        req.params.id
      );

      sendOk(req, res, { challenge });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
