const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const notificationRepository = require('./notificationRepository');

const router = express.Router();

const uuidSchema = z.string().uuid();

const registerDeviceSchema = z.object({
  platform: z.enum(['ios', 'android']),
  expoPushToken: z.string().trim().min(1).max(300),
});

const deviceParamsSchema = z.object({
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

router.use(requireAuth);

router.post(
  '/',
  validate({ body: registerDeviceSchema }),
  async function registerDevice(req, res, next) {
    try {
      const deviceToken = await notificationRepository.registerDeviceToken(
        req.user.id,
        req.body
      );

      sendOk(req, res, { deviceToken }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  validate({ params: deviceParamsSchema }),
  async function deactivateDevice(req, res, next) {
    try {
      const deviceToken = await notificationRepository.deactivateDeviceToken(
        req.user.id,
        req.params.id
      );

      sendOk(req, res, { deviceToken });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
