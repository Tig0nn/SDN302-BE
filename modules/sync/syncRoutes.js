const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const syncRepository = require('./syncRepository');

const router = express.Router();

function isValidDateTime(value) {
  const date = new Date(value);

  return !Number.isNaN(date.getTime());
}

const syncChangesQuerySchema = z.object({
  since: z.string().refine(isValidDateTime, {
    message: 'since must be a valid ISO date-time value',
  }),
});

const mutationSchema = z.object({
  clientMutationId: z.string().trim().min(1).max(120),
  operation: z.enum([
    'transactions.create',
    'transactions.update',
    'transactions.delete',
  ]),
  payload: z.record(z.string(), z.any()).default({}),
});

const syncMutationsSchema = z.object({
  mutations: z.array(mutationSchema).min(1).max(50),
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

router.use(requireAuth);

router.get(
  '/changes',
  validate({ query: syncChangesQuerySchema }),
  async function listChanges(req, res, next) {
    try {
      const result = await syncRepository.listChanges(req.user.id, req.query.since);

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/mutations',
  validate({ body: syncMutationsSchema }),
  async function applyMutations(req, res, next) {
    try {
      const result = await syncRepository.applyMutations(
        req.user.id,
        req.body.mutations
      );

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
