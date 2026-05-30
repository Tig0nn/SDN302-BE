const { ZodError } = require('zod');
const env = require('../config/env');

function isProduction() {
  return env.NODE_ENV === 'production';
}

function normalizeError(err) {
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: err.issues,
    };
  }

  const status = err.status || err.statusCode || 500;

  return {
    status,
    code: err.code || (status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR'),
    message:
      status >= 500 && isProduction()
        ? 'Internal server error'
        : err.message || 'Internal server error',
    details: err.details || [],
  };
}

function errorHandler(err, req, res, next) {
  const normalized = normalizeError(err);

  if (normalized.status >= 500) {
    console.error({
      requestId: req.requestId,
      error: err.message,
      stack: isProduction() ? undefined : err.stack,
    });
  }

  const body = {
    data: null,
    meta: {
      requestId: req.requestId,
    },
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
    },
  };

  if (!isProduction() && err.stack) {
    body.error.stack = err.stack;
  }

  res.status(normalized.status).json(body);
}

module.exports = errorHandler;
