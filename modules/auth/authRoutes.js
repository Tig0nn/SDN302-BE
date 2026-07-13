const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
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

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  path: '/api/v1/auth',
};

function setRefreshCookie(res, refreshToken, expiresAt) {
  res.cookie(env.REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    ...REFRESH_COOKIE_OPTIONS,
    expires: new Date(expiresAt),
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(env.REFRESH_TOKEN_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
}

function sendTokenResult(req, res, result) {
  setRefreshCookie(res, result.tokens.refreshToken, result.tokens.refreshExpiresAt);

  const { refreshToken, ...tokensWithoutRefresh } = result.tokens;

  sendOk(req, res, { ...result, tokens: tokensWithoutRefresh });
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
      sendTokenResult(req, res, result);
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
      sendTokenResult(req, res, result);
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
      sendTokenResult(req, res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post('/refresh', async function refresh(req, res, next) {
  try {
    const refreshToken = req.cookies?.[env.REFRESH_TOKEN_COOKIE_NAME];

    if (!refreshToken) {
      const err = new Error('Invalid or expired refresh token');

      err.code = 'INVALID_REFRESH_TOKEN';
      err.status = 401;
      next(err);
      return;
    }

    const result = await authService.refreshTokens(refreshToken);

    await auditRepository.recordAuditEvent(
      req,
      'auth.refresh',
      {},
      result.user.id
    );
    sendTokenResult(req, res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async function logout(req, res, next) {
  try {
    const refreshToken = req.cookies?.[env.REFRESH_TOKEN_COOKIE_NAME];

    await authService.logout(refreshToken);
    clearRefreshCookie(res);

    await auditRepository.recordAuditEvent(req, 'auth.logout');
    sendOk(req, res, { ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
