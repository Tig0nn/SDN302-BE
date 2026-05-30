const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const authService = require('./authService');
const env = require('../../config/env');

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

router.post(
  '/email/register',
  validate({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(8).max(128),
      displayName: z.string().min(1).max(120).optional(),
    }),
  }),
  async function registerWithEmail(req, res, next) {
    try {
      const result = await authService.registerWithEmail(req.body);

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/email/verify',
  validate({
    body: z.object({
      email: z.string().email(),
      otpCode: z.string().length(env.OTP_LENGTH).regex(/^\d+$/),
    }),
  }),
  async function verifySignupOtp(req, res, next) {
    try {
      const result = await authService.verifySignupOtp(req.body);

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/email/login',
  validate({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(1).max(128),
    }),
  }),
  async function loginWithEmail(req, res, next) {
    try {
      const result = await authService.loginWithEmail(req.body);

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/email/resend-otp',
  validate({
    body: z.object({
      email: z.string().email(),
    }),
  }),
  async function resendSignupOtp(req, res, next) {
    try {
      const result = await authService.resendSignupOtp(req.body.email);

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/google',
  validate({
    body: z.object({
      idToken: z.string().min(1),
    }),
  }),
  async function loginWithGoogle(req, res, next) {
    try {
      const result = await authService.loginWithGoogle(req.body.idToken);

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/refresh',
  validate({
    body: z.object({
      refreshToken: z.string().min(1),
    }),
  }),
  async function refresh(req, res, next) {
    try {
      const result = await authService.refreshTokens(req.body.refreshToken);

      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/logout',
  validate({
    body: z.object({
      refreshToken: z.string().min(1).optional(),
    }),
  }),
  async function logout(req, res, next) {
    try {
      await authService.logout(req.body.refreshToken);

      sendOk(req, res, { ok: true });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
