const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const authService = require('./authService');
const env = require('../../config/env');
const auditRepository = require('../security/auditRepository');
const { maskEmail } = require('../../utils/redact');

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

      await auditRepository.recordAuditEvent(req, 'auth.email_register_requested', {
        email: maskEmail(result.email),
        delivered: result.delivered,
      });
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

      await auditRepository.recordAuditEvent(
        req,
        'auth.email_signup_verified',
        {
          email: maskEmail(result.user.email),
        },
        result.user.id
      );
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

      await auditRepository.recordAuditEvent(
        req,
        'auth.email_login',
        {
          email: maskEmail(result.user.email),
        },
        result.user.id
      );
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

      await auditRepository.recordAuditEvent(req, 'auth.email_otp_resent', {
        email: maskEmail(result.email),
        delivered: result.delivered,
      });
      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/email/forgot-password',
  validate({
    body: z.object({
      email: z.string().email(),
    }),
  }),
  async function forgotPassword(req, res, next) {
    try {
      const result = await authService.requestPasswordReset(req.body.email);

      await auditRepository.recordAuditEvent(req, 'auth.password_reset_requested', {
        email: maskEmail(result.email),
      });
      sendOk(req, res, { ok: true });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/email/reset-password',
  validate({
    body: z.object({
      email: z.string().email(),
      otpCode: z.string().length(env.OTP_LENGTH).regex(/^\d+$/),
      newPassword: z.string().min(8).max(128),
    }),
  }),
  async function resetPassword(req, res, next) {
    try {
      const result = await authService.resetPassword(req.body);

      await auditRepository.recordAuditEvent(req, 'auth.password_reset_completed', {
        email: maskEmail(result.email),
      });
      sendOk(req, res, { ok: true });
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

      await auditRepository.recordAuditEvent(
        req,
        'auth.google_login',
        {
          email: maskEmail(result.user.email),
        },
        result.user.id
      );
      sendOk(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/google/link',
  requireAuth,
  validate({
    body: z.object({
      idToken: z.string().min(1),
    }),
  }),
  async function linkGoogleAccount(req, res, next) {
    try {
      const result = await authService.linkGoogleAccount(req.user, req.body.idToken);

      await auditRepository.recordAuditEvent(
        req,
        'auth.google_linked',
        {
          email: maskEmail(result.user.email),
        },
        result.user.id
      );
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

      await auditRepository.recordAuditEvent(
        req,
        'auth.refresh',
        {},
        result.user.id
      );
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

      await auditRepository.recordAuditEvent(req, 'auth.logout');
      sendOk(req, res, { ok: true });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
