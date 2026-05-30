const env = require('../../config/env');

const apiPrefix = env.API_PREFIX || '/api/v1';

function getServers(req) {
  const requestBaseUrl = req
    ? `${req.protocol}://${req.get('host')}`
    : 'http://localhost:3000';
  const servers = [{ url: requestBaseUrl, description: 'Current server' }];

  if (env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL !== requestBaseUrl) {
    servers.unshift({
      url: env.PUBLIC_BASE_URL,
      description: 'Public deployment',
    });
  }

  return servers;
}

function standardSuccess(schemaRef) {
  return {
    type: 'object',
    required: ['data', 'meta', 'error'],
    properties: {
      data: schemaRef ? { $ref: schemaRef } : {},
      meta: { $ref: '#/components/schemas/ResponseMeta' },
      error: { nullable: true },
    },
  };
}

function buildOpenApiSpec(req) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Ví Vi Vu API',
      version: '0.3.0',
      description:
        'Backend API for Ví Vi Vu personal finance mobile app. Current public contract covers service health, Google/email auth/session flow, and authenticated profile endpoints.',
    },
    servers: getServers(req),
    tags: [
      { name: 'Health', description: 'Service readiness checks' },
      { name: 'Auth', description: 'Email/password, OTP, Google OAuth, and session management' },
      { name: 'Me', description: 'Authenticated user profile and settings' },
    ],
    paths: {
      '/': {
        get: {
          tags: ['Health'],
          summary: 'Service metadata',
          responses: {
            200: {
              description: 'Service metadata',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ServiceMetadata'),
                },
              },
            },
          },
        },
      },
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check',
          responses: {
            200: {
              description: 'Service is alive',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/Health'),
                },
              },
            },
          },
        },
      },
      '/health/db': {
        get: {
          tags: ['Health'],
          summary: 'Database health check',
          responses: {
            200: {
              description: 'Database is reachable',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/DbHealth'),
                },
              },
            },
            500: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/health`]: {
        get: {
          tags: ['Health'],
          summary: 'Versioned health check',
          responses: {
            200: {
              description: 'Service is alive',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/Health'),
                },
              },
            },
          },
        },
      },
      [`${apiPrefix}/health/db`]: {
        get: {
          tags: ['Health'],
          summary: 'Versioned database health check',
          responses: {
            200: {
              description: 'Database is reachable',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/DbHealth'),
                },
              },
            },
            500: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/auth/email/register`]: {
        post: {
          tags: ['Auth'],
          summary: 'Register with email/password and send signup OTP',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RegisterEmailRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'OTP was created and sent when SMTP is configured',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/OtpChallenge'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
            500: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/auth/email/verify`]: {
        post: {
          tags: ['Auth'],
          summary: 'Verify signup OTP and create an authenticated session',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/VerifyEmailOtpRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Authenticated session',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AuthSession'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
            429: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/auth/email/login`]: {
        post: {
          tags: ['Auth'],
          summary: 'Login with email/password',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginEmailRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Authenticated session',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AuthSession'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            403: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/auth/email/resend-otp`]: {
        post: {
          tags: ['Auth'],
          summary: 'Resend signup OTP for a pending email registration',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ResendEmailOtpRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'OTP was recreated and sent when SMTP is configured',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/OtpChallenge'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
            500: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/auth/google`]: {
        post: {
          tags: ['Auth'],
          summary: 'Login or sign up with Google idToken',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['idToken'],
                  properties: {
                    idToken: {
                      type: 'string',
                      description: 'Google Sign-In ID token from Expo client',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Authenticated session',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AuthSession'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            500: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/auth/refresh`]: {
        post: {
          tags: ['Auth'],
          summary: 'Rotate refresh token and issue a new access token',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['refreshToken'],
                  properties: {
                    refreshToken: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'New token pair',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AuthSession'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/auth/logout`]: {
        post: {
          tags: ['Auth'],
          summary: 'Revoke refresh token',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    refreshToken: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Logout result',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/OkResult'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/me`]: {
        get: {
          tags: ['Me'],
          summary: 'Get current user profile, settings, and default ledger',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Current user payload',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/MePayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
          },
        },
        patch: {
          tags: ['Me'],
          summary: 'Update current user profile and settings',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateMeRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated current user payload',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/MePayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      responses: {
        Error: {
          description: 'Standard error response',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            },
          },
        },
      },
      schemas: {
        ResponseMeta: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
          },
        },
        ErrorEnvelope: {
          type: 'object',
          required: ['data', 'meta', 'error'],
          properties: {
            data: { nullable: true },
            meta: { $ref: '#/components/schemas/ResponseMeta' },
            error: { $ref: '#/components/schemas/ErrorPayload' },
          },
        },
        ErrorPayload: {
          type: 'object',
          required: ['code', 'message', 'details'],
          properties: {
            code: { type: 'string', example: 'VALIDATION_ERROR' },
            message: { type: 'string' },
            details: { type: 'array', items: {} },
          },
        },
        ServiceMetadata: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            service: { type: 'string', example: 'vi-vi-vu-api' },
            health: { type: 'string', example: '/health' },
            apiHealth: { type: 'string', example: '/api/v1/health' },
          },
        },
        Health: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            service: { type: 'string' },
            environment: { type: 'string' },
          },
        },
        DbHealth: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            server_time: { type: 'string', format: 'date-time' },
          },
        },
        OkResult: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
          },
        },
        RegisterEmailRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'user@gmail.com' },
            password: { type: 'string', minLength: 8, maxLength: 128 },
            displayName: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        VerifyEmailOtpRequest: {
          type: 'object',
          required: ['email', 'otpCode'],
          properties: {
            email: { type: 'string', format: 'email', example: 'user@gmail.com' },
            otpCode: {
              type: 'string',
              minLength: env.OTP_LENGTH,
              maxLength: env.OTP_LENGTH,
              pattern: '^\\d+$',
              example: '123456',
            },
          },
        },
        LoginEmailRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'user@gmail.com' },
            password: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        ResendEmailOtpRequest: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email', example: 'user@gmail.com' },
          },
        },
        OtpChallenge: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            otpExpiresAt: { type: 'string', format: 'date-time' },
            otpTtlMinutes: { type: 'integer', example: 10 },
            delivered: {
              type: 'boolean',
              description:
                'False in local development when SMTP is not configured and OTP is logged to the server console.',
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            googleSub: { type: 'string', nullable: true },
            email: { type: 'string', format: 'email' },
            displayName: { type: 'string' },
            avatarUrl: { type: 'string', nullable: true },
            emailVerifiedAt: { type: 'string', format: 'date-time', nullable: true },
            locale: { type: 'string' },
            timezone: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Tokens: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            tokenType: { type: 'string', example: 'Bearer' },
            expiresIn: { type: 'integer', example: 10800 },
            refreshExpiresAt: { type: 'string', format: 'date-time' },
          },
        },
        AuthSession: {
          type: 'object',
          properties: {
            user: { $ref: '#/components/schemas/User' },
            tokens: { $ref: '#/components/schemas/Tokens' },
          },
        },
        UserSettings: {
          type: 'object',
          nullable: true,
          properties: {
            theme: { type: 'string', enum: ['light', 'dark', 'system'] },
            dailyReminderEnabled: { type: 'boolean' },
            budgetWarningEnabled: { type: 'boolean' },
            debtReminderEnabled: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        LedgerSummary: {
          type: 'object',
          nullable: true,
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            isDefault: { type: 'boolean' },
          },
        },
        MePayload: {
          type: 'object',
          properties: {
            user: { $ref: '#/components/schemas/User' },
            settings: { $ref: '#/components/schemas/UserSettings' },
            defaultLedger: { $ref: '#/components/schemas/LedgerSummary' },
          },
        },
        UpdateMeRequest: {
          type: 'object',
          properties: {
            displayName: { type: 'string', minLength: 1, maxLength: 120 },
            avatarUrl: { type: 'string', format: 'uri', nullable: true },
            locale: { type: 'string' },
            timezone: { type: 'string' },
            settings: {
              type: 'object',
              properties: {
                theme: { type: 'string', enum: ['light', 'dark', 'system'] },
                dailyReminderEnabled: { type: 'boolean' },
                budgetWarningEnabled: { type: 'boolean' },
                debtReminderEnabled: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  };
}

module.exports = {
  buildOpenApiSpec,
};
