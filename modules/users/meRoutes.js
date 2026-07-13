const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const userRepository = require('./userRepository');

const router = express.Router();

function sendOk(req, res, data) {
  res.json({
    data,
    meta: {
      requestId: req.requestId,
    },
    error: null,
  });
}

async function buildMePayload(userId) {
  const user = await userRepository.findUserById(userId);
  const settings = await userRepository.getUserSettings(userId);
  const defaultLedger = await userRepository.getDefaultLedger(userId);

  return {
    user,
    settings,
    defaultLedger,
  };
}

router.get('/', requireAuth, async function getMe(req, res, next) {
  try {
    sendOk(req, res, await buildMePayload(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/',
  requireAuth,
  validate({
    body: z.object({
      displayName: z.string().min(1).max(120).optional(),
      avatarUrl: z.string().url().nullable().optional(),
      locale: z.string().min(2).max(20).optional(),
      timezone: z.string().min(1).max(80).optional(),
      settings: z
        .object({
          theme: z.enum(['light', 'dark', 'system']).optional(),
          dailyReminderEnabled: z.boolean().optional(),
          budgetWarningEnabled: z.boolean().optional(),
          debtReminderEnabled: z.boolean().optional(),
        })
        .optional(),
    }),
  }),
  async function updateMe(req, res, next) {
    try {
      await userRepository.updateUserProfile(req.user.id, req.body);

      if (req.body.settings) {
        await userRepository.updateUserSettings(req.user.id, req.body.settings);
      }

      sendOk(req, res, await buildMePayload(req.user.id));
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
