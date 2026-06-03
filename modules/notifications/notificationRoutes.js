const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const notificationRepository = require('./notificationRepository');

const router = express.Router();

const uuidSchema = z.string().uuid();

const notificationParamsSchema = z.object({
  id: uuidSchema,
});

const booleanQuerySchema = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
}, z.boolean());

const listNotificationsQuerySchema = z.object({
  unreadOnly: booleanQuerySchema.default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
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
  '/',
  validate({ query: listNotificationsQuerySchema }),
  async function listNotifications(req, res, next) {
    try {
      const result = await notificationRepository.listNotifications(
        req.user.id,
        req.query
      );

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id/read',
  validate({ params: notificationParamsSchema }),
  async function markNotificationRead(req, res, next) {
    try {
      const notification = await notificationRepository.markNotificationRead(
        req.user.id,
        req.params.id
      );

      sendOk(req, res, { notification });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
