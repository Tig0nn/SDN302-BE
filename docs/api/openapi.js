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

function transactionExportParameters() {
  return [
    {
      name: 'ledgerId',
      in: 'query',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    },
    {
      name: 'dateFrom',
      in: 'query',
      schema: { type: 'string', format: 'date' },
    },
    {
      name: 'dateTo',
      in: 'query',
      schema: { type: 'string', format: 'date' },
    },
    {
      name: 'type',
      in: 'query',
      schema: { type: 'string', enum: ['income', 'expense'] },
    },
    {
      name: 'categoryId',
      in: 'query',
      schema: { type: 'string', format: 'uuid' },
    },
    {
      name: 'search',
      in: 'query',
      schema: { type: 'string', minLength: 1, maxLength: 120 },
    },
  ];
}

function buildOpenApiSpec(req) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Ví Vi Vu API',
      version: '1.1.0',
      description:
        'Backend API for Ví Vi Vu personal finance mobile app. Current public contract covers service health, auth/session flow, profile endpoints, master data APIs, transaction MVP APIs, analytics APIs, budget APIs, planning APIs, shopping list APIs, and AI assistant APIs.',
    },
    servers: getServers(req),
    tags: [
      { name: 'Health', description: 'Service readiness checks' },
      { name: 'Metrics', description: 'Basic operational metrics' },
      { name: 'Auth', description: 'Email/password, OTP, Google OAuth, and session management' },
      { name: 'Me', description: 'Authenticated user profile and settings' },
      { name: 'Ledgers', description: 'User ledgers' },
      { name: 'Categories', description: 'Income and expense categories' },
      { name: 'Payment Accounts', description: 'Banks, wallets, and cash accounts' },
      { name: 'Transactions', description: 'Income and expense transaction MVP' },
      { name: 'Analytics', description: 'Dashboard and chart aggregations' },
      { name: 'Budgets', description: 'Monthly budget limits and alerts' },
      { name: 'Goals', description: 'Saving goals and deposits' },
      { name: 'Debts', description: 'Borrowed and lent debt tracking' },
      { name: 'Challenges', description: 'Saving challenges and daily check-ins' },
      { name: 'Shopping', description: 'Shopping plans, items, and transaction conversion' },
      { name: 'AI', description: 'BYOK Gemini assistant, transaction preview, actions, and receipt scan' },
      { name: 'Imports', description: 'CSV, XLSX, and pasted transaction imports' },
      { name: 'Exports', description: 'Transaction CSV, XLSX, and PDF exports' },
      { name: 'Devices', description: 'Expo push device token registration' },
      { name: 'Notifications', description: 'Notification event history and read state' },
      { name: 'Sync', description: 'Delta sync and offline mutation queue' },
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
      '/metrics': {
        get: {
          tags: ['Metrics'],
          summary: 'Basic HTTP and database pool metrics',
          responses: {
            200: {
              description: 'Metrics snapshot',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/MetricsPayload'),
                },
              },
            },
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
      [`${apiPrefix}/metrics`]: {
        get: {
          tags: ['Metrics'],
          summary: 'Versioned basic HTTP and database pool metrics',
          responses: {
            200: {
              description: 'Metrics snapshot',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/MetricsPayload'),
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
              description: 'OTP was created and sent when email delivery is configured',
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
      [`${apiPrefix}/ledgers`]: {
        get: {
          tags: ['Ledgers'],
          summary: 'List ledgers for the authenticated user',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Ledger list',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/LedgerListPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
          },
        },
        post: {
          tags: ['Ledgers'],
          summary: 'Create a ledger',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LedgerWriteRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created ledger',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/LedgerPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/ledgers/{id}`]: {
        patch: {
          tags: ['Ledgers'],
          summary: 'Rename a ledger',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LedgerWriteRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated ledger',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/LedgerPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
        delete: {
          tags: ['Ledgers'],
          summary: 'Soft delete a ledger',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Deleted ledger',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/LedgerPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/categories`]: {
        get: {
          tags: ['Categories'],
          summary: 'List categories and grouped category tree',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'type',
              in: 'query',
              schema: { type: 'string', enum: ['income', 'expense'] },
            },
            {
              name: 'parentId',
              in: 'query',
              schema: {
                oneOf: [
                  { type: 'string', format: 'uuid' },
                  { type: 'string', enum: ['root'] },
                ],
              },
            },
          ],
          responses: {
            200: {
              description: 'Category list',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/CategoryListPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
        post: {
          tags: ['Categories'],
          summary: 'Create a custom category or subcategory',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateCategoryRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created category',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/CategoryPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/categories/{id}`]: {
        patch: {
          tags: ['Categories'],
          summary: 'Update a custom category',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateCategoryRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated category',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/CategoryPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            403: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
          },
        },
        delete: {
          tags: ['Categories'],
          summary: 'Soft delete a custom category',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Deleted categories',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/DeleteCategoryPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            403: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/payment-accounts`]: {
        get: {
          tags: ['Payment Accounts'],
          summary: 'List payment accounts for the authenticated user',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Payment account list',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/PaymentAccountListPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/transactions`]: {
        get: {
          tags: ['Transactions'],
          summary: 'List transactions with filters and pagination',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'type', in: 'query', schema: { type: 'string', enum: ['income', 'expense'] } },
            { name: 'categoryId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          ],
          responses: {
            200: {
              description: 'Transaction page',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/TransactionListPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
        post: {
          tags: ['Transactions'],
          summary: 'Create a transaction',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateTransactionRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created transaction',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/TransactionPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/transactions/bulk`]: {
        post: {
          tags: ['Transactions'],
          summary: 'Create many transactions with client mutation idempotency',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BulkCreateTransactionRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created or idempotently reused transactions',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/TransactionBulkPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/transactions/summary`]: {
        get: {
          tags: ['Transactions'],
          summary: 'Get income, expense, balance, and count summary',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: {
            200: {
              description: 'Transaction summary',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/TransactionSummaryPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/transactions/calendar`]: {
        get: {
          tags: ['Transactions'],
          summary: 'Get day-level summary for a calendar month',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'month', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } },
          ],
          responses: {
            200: {
              description: 'Calendar summary',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/TransactionCalendarPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/transactions/{id}`]: {
        get: {
          tags: ['Transactions'],
          summary: 'Get a transaction by id',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Transaction detail',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/TransactionPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
        patch: {
          tags: ['Transactions'],
          summary: 'Update a transaction',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateTransactionRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated transaction',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/TransactionPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
        delete: {
          tags: ['Transactions'],
          summary: 'Soft delete a transaction',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Deleted transaction',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/TransactionPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/analytics/overview`]: {
        get: {
          tags: ['Analytics'],
          summary: 'Get dashboard overview cards',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: {
            200: {
              description: 'Overview cards',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AnalyticsOverviewPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/analytics/category-breakdown`]: {
        get: {
          tags: ['Analytics'],
          summary: 'Get category pie chart data',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'type', in: 'query', schema: { type: 'string', enum: ['income', 'expense'], default: 'expense' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 } },
          ],
          responses: {
            200: {
              description: 'Category breakdown rows',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AnalyticsCategoryBreakdownPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/analytics/daily-spending`]: {
        get: {
          tags: ['Analytics'],
          summary: 'Get daily expense bar chart data',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: {
            200: {
              description: 'Daily spending rows',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AnalyticsDailySpendingPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/analytics/monthly-trend`]: {
        get: {
          tags: ['Analytics'],
          summary: 'Get monthly income versus expense trend',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: {
            200: {
              description: 'Monthly trend rows',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AnalyticsMonthlyTrendPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/analytics/fluctuation`]: {
        get: {
          tags: ['Analytics'],
          summary: 'Get daily expense fluctuation data',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: {
            200: {
              description: 'Fluctuation rows',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AnalyticsFluctuationPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/budgets`]: {
        get: {
          tags: ['Budgets'],
          summary: 'List monthly budgets with spent, progress, and status',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'month', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } },
          ],
          responses: {
            200: {
              description: 'Budget list',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/BudgetListPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
        post: {
          tags: ['Budgets'],
          summary: 'Create a monthly budget',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateBudgetRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created budget',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/BudgetPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/budgets/{id}`]: {
        patch: {
          tags: ['Budgets'],
          summary: 'Update budget limit or warning threshold',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateBudgetRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated budget',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/BudgetPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
        delete: {
          tags: ['Budgets'],
          summary: 'Soft delete a budget',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Deleted budget marker',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/DeleteBudgetPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/goals`]: {
        get: {
          tags: ['Goals'],
          summary: 'List saving goals',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'completed', 'cancelled'] } },
          ],
          responses: {
            200: {
              description: 'Goal list',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/GoalListPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
        post: {
          tags: ['Goals'],
          summary: 'Create a saving goal',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateGoalRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created goal',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/GoalPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/goals/{id}`]: {
        patch: {
          tags: ['Goals'],
          summary: 'Update a saving goal',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateGoalRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated goal',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/GoalPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
        delete: {
          tags: ['Goals'],
          summary: 'Soft delete a saving goal',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Deleted goal',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/GoalPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/goals/{id}/deposits`]: {
        post: {
          tags: ['Goals'],
          summary: 'Deposit money into a saving goal',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GoalDepositRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated goal progress',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/GoalPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/debts`]: {
        get: {
          tags: ['Debts'],
          summary: 'List debts',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'paid', 'overdue', 'cancelled'] } },
          ],
          responses: {
            200: {
              description: 'Debt list',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/DebtListPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
        post: {
          tags: ['Debts'],
          summary: 'Create a borrowed or lent debt',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateDebtRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created debt',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/DebtPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/debts/{id}`]: {
        patch: {
          tags: ['Debts'],
          summary: 'Update a debt',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateDebtRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated debt',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/DebtPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
        delete: {
          tags: ['Debts'],
          summary: 'Soft delete a debt',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Deleted debt',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/DebtPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/debts/{id}/payments`]: {
        post: {
          tags: ['Debts'],
          summary: 'Record a partial debt payment',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DebtPaymentRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created payment and updated debt',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/DebtPaymentPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/challenges`]: {
        get: {
          tags: ['Challenges'],
          summary: 'List saving challenges',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'completed', 'cancelled'] } },
          ],
          responses: {
            200: {
              description: 'Challenge list',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ChallengeListPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
        post: {
          tags: ['Challenges'],
          summary: 'Create a saving challenge',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateChallengeRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created challenge',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ChallengePayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/challenges/{id}`]: {
        patch: {
          tags: ['Challenges'],
          summary: 'Update a saving challenge',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateChallengeRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated challenge',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ChallengePayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
        delete: {
          tags: ['Challenges'],
          summary: 'Soft delete a saving challenge',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Deleted challenge',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ChallengePayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/challenges/{id}/checkins`]: {
        post: {
          tags: ['Challenges'],
          summary: 'Check in to a saving challenge for one day',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChallengeCheckinRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created check-in',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ChallengeCheckinPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/shopping-plans`]: {
        get: {
          tags: ['Shopping'],
          summary: 'List shopping plans with item totals',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'ledgerId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: {
              description: 'Shopping plan list',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ShoppingPlanListPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
        post: {
          tags: ['Shopping'],
          summary: 'Create a shopping plan',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateShoppingPlanRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created shopping plan',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ShoppingPlanPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/shopping-plans/{id}`]: {
        get: {
          tags: ['Shopping'],
          summary: 'Get a shopping plan with items',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Shopping plan detail',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ShoppingPlanDetailPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
        patch: {
          tags: ['Shopping'],
          summary: 'Update a shopping plan',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateShoppingPlanRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated shopping plan',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ShoppingPlanPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
        delete: {
          tags: ['Shopping'],
          summary: 'Soft delete a shopping plan and its items',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Deleted shopping plan',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ShoppingPlanPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/shopping-plans/{id}/items`]: {
        post: {
          tags: ['Shopping'],
          summary: 'Add an item to a shopping plan',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateShoppingItemRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created shopping item',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ShoppingItemPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/shopping-items/{id}`]: {
        patch: {
          tags: ['Shopping'],
          summary: 'Update or toggle a shopping item',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateShoppingItemRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Updated shopping item',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ShoppingItemPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
          },
        },
        delete: {
          tags: ['Shopping'],
          summary: 'Soft delete a shopping item',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Deleted shopping item',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ShoppingItemPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/shopping-items/{id}/convert-to-transaction`]: {
        post: {
          tags: ['Shopping'],
          summary: 'Convert a bought shopping item into an expense transaction',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ConvertShoppingItemRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created transaction and linked shopping item',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ShoppingItemConversionPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/ai/transaction-preview`]: {
        post: {
          tags: ['AI'],
          summary: 'Parse natural language into a transaction preview',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AiTransactionPreviewRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Transaction preview',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AiTransactionPreviewPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
            429: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/ai/execute-action`]: {
        post: {
          tags: ['AI'],
          summary: 'Execute a confirmed AI action',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AiExecuteActionRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Action result',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AiActionResultPayload'),
                },
              },
            },
            201: {
              description: 'Created resource from action',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AiActionResultPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            429: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/ai/chat`]: {
        post: {
          tags: ['AI'],
          summary: 'Chat with Gemini using BYOK',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/GeminiApiKeyHeader' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AiChatRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Assistant response',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AiChatPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            429: { $ref: '#/components/responses/Error' },
            502: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/ai/receipt-scan`]: {
        post: {
          tags: ['AI'],
          summary: 'Scan receipt image with Gemini Vision using BYOK',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/GeminiApiKeyHeader' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AiReceiptScanRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Structured receipt extraction',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AiReceiptScanPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            429: { $ref: '#/components/responses/Error' },
            502: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/ai/conversations`]: {
        get: {
          tags: ['AI'],
          summary: 'List saved AI conversations',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Conversation list',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AiConversationListPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            429: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/ai/conversations/{id}/messages`]: {
        get: {
          tags: ['AI'],
          summary: 'List messages in a saved AI conversation',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Conversation messages',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/AiMessageListPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            429: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/imports/preview`]: {
        post: {
          tags: ['Imports'],
          summary: 'Preview transaction import rows',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ImportPreviewRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created import preview job',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ImportJobPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/imports/{id}/commit`]: {
        post: {
          tags: ['Imports'],
          summary: 'Commit valid rows from an import preview job',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            201: {
              description: 'Committed valid import rows',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/ImportCommitPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
            409: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/exports/transactions.csv`]: {
        get: {
          tags: ['Exports'],
          summary: 'Export filtered transactions as CSV',
          security: [{ bearerAuth: [] }],
          parameters: transactionExportParameters(),
          responses: {
            200: {
              description: 'CSV transaction export',
              content: {
                'text/csv': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/exports/transactions.xlsx`]: {
        get: {
          tags: ['Exports'],
          summary: 'Export filtered transactions as Excel workbook',
          security: [{ bearerAuth: [] }],
          parameters: transactionExportParameters(),
          responses: {
            200: {
              description: 'XLSX transaction export',
              content: {
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/exports/transactions.pdf`]: {
        get: {
          tags: ['Exports'],
          summary: 'Export filtered transactions as PDF',
          security: [{ bearerAuth: [] }],
          parameters: transactionExportParameters(),
          responses: {
            200: {
              description: 'PDF transaction export',
              content: {
                'application/pdf': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/devices`]: {
        post: {
          tags: ['Devices'],
          summary: 'Register or reactivate an Expo push token',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RegisterDeviceRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Registered device token',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/DeviceTokenPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/devices/{id}`]: {
        delete: {
          tags: ['Devices'],
          summary: 'Deactivate a registered device token',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Deactivated device token',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/DeviceTokenPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/notifications`]: {
        get: {
          tags: ['Notifications'],
          summary: 'List notification event history',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'unreadOnly',
              in: 'query',
              schema: { type: 'boolean', default: false },
            },
            {
              name: 'page',
              in: 'query',
              schema: { type: 'integer', minimum: 1, default: 1 },
            },
            {
              name: 'pageSize',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            },
          ],
          responses: {
            200: {
              description: 'Notification list',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/NotificationListPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/notifications/{id}/read`]: {
        patch: {
          tags: ['Notifications'],
          summary: 'Mark a notification as read',
          security: [{ bearerAuth: [] }],
          parameters: [{ $ref: '#/components/parameters/IdParam' }],
          responses: {
            200: {
              description: 'Read notification',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/NotificationPayload'),
                },
              },
            },
            401: { $ref: '#/components/responses/Error' },
            404: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/sync/changes`]: {
        get: {
          tags: ['Sync'],
          summary: 'Fetch delta changes since a server timestamp',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'since',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'date-time' },
            },
          ],
          responses: {
            200: {
              description: 'Delta changes for syncable tables',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/SyncChangesPayload'),
                },
              },
            },
            400: { $ref: '#/components/responses/Error' },
            401: { $ref: '#/components/responses/Error' },
          },
        },
      },
      [`${apiPrefix}/sync/mutations`]: {
        post: {
          tags: ['Sync'],
          summary: 'Apply queued offline mutations idempotently',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SyncMutationsRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Mutation application results',
              content: {
                'application/json': {
                  schema: standardSuccess('#/components/schemas/SyncMutationsPayload'),
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
      parameters: {
        IdParam: {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        GeminiApiKeyHeader: {
          name: 'X-Gemini-Api-Key',
          in: 'header',
          required: true,
          schema: { type: 'string' },
          description: 'Gemini BYOK key supplied by the mobile client. The API does not persist this key.',
        },
      },
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
        MetricsPayload: {
          type: 'object',
          properties: {
            http: {
              type: 'object',
              properties: {
                startedAt: { type: 'string', format: 'date-time' },
                requestCount: { type: 'integer' },
                serverErrorCount: { type: 'integer' },
                errorRate: { type: 'number' },
                latencyMs: {
                  type: 'object',
                  properties: {
                    average: { type: 'number' },
                    max: { type: 'number' },
                    p95: { type: 'number' },
                  },
                },
                statusCounts: {
                  type: 'object',
                  additionalProperties: { type: 'integer' },
                },
                routeCounts: {
                  type: 'object',
                  additionalProperties: { type: 'integer' },
                },
              },
            },
            db: {
              type: 'object',
              properties: {
                configured: { type: 'boolean' },
                active: { type: 'boolean' },
                totalCount: { type: 'integer' },
                idleCount: { type: 'integer' },
                waitingCount: { type: 'integer' },
              },
            },
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
        Ledger: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            isDefault: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        LedgerPayload: {
          type: 'object',
          properties: {
            ledger: { $ref: '#/components/schemas/Ledger' },
          },
        },
        LedgerListPayload: {
          type: 'object',
          properties: {
            ledgers: {
              type: 'array',
              items: { $ref: '#/components/schemas/Ledger' },
            },
          },
        },
        LedgerWriteRequest: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        Category: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid', nullable: true },
            type: { type: 'string', enum: ['income', 'expense'] },
            name: { type: 'string' },
            parentId: { type: 'string', format: 'uuid', nullable: true },
            icon: { type: 'string', nullable: true },
            color: { type: 'string', nullable: true },
            isSystem: { type: 'boolean' },
            sortOrder: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CategoryTreeNode: {
          allOf: [
            { $ref: '#/components/schemas/Category' },
            {
              type: 'object',
              properties: {
                subcategories: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Category' },
                },
              },
            },
          ],
        },
        CategoryPayload: {
          type: 'object',
          properties: {
            category: { $ref: '#/components/schemas/Category' },
          },
        },
        CategoryListPayload: {
          type: 'object',
          properties: {
            categories: {
              type: 'array',
              items: { $ref: '#/components/schemas/Category' },
            },
            tree: {
              type: 'array',
              items: { $ref: '#/components/schemas/CategoryTreeNode' },
            },
          },
        },
        DeleteCategoryPayload: {
          type: 'object',
          properties: {
            deletedCategories: {
              type: 'array',
              items: { $ref: '#/components/schemas/Category' },
            },
          },
        },
        CreateCategoryRequest: {
          type: 'object',
          required: ['type', 'name'],
          properties: {
            type: { type: 'string', enum: ['income', 'expense'] },
            name: { type: 'string', minLength: 1, maxLength: 120 },
            parentId: { type: 'string', format: 'uuid', nullable: true },
            icon: { type: 'string', nullable: true, maxLength: 80 },
            color: { type: 'string', nullable: true, maxLength: 40 },
          },
        },
        UpdateCategoryRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            icon: { type: 'string', nullable: true, maxLength: 80 },
            color: { type: 'string', nullable: true, maxLength: 40 },
          },
        },
        PaymentAccount: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid', nullable: true },
            name: { type: 'string' },
            shortName: { type: 'string', nullable: true },
            type: {
              type: 'string',
              enum: ['cash', 'traditional_bank', 'digital_bank', 'e_wallet'],
            },
            color: { type: 'string', nullable: true },
            isSystem: { type: 'boolean' },
            sortOrder: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        PaymentAccountListPayload: {
          type: 'object',
          properties: {
            paymentAccounts: {
              type: 'array',
              items: { $ref: '#/components/schemas/PaymentAccount' },
            },
          },
        },
        Transaction: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            ledgerId: { type: 'string', format: 'uuid' },
            type: { type: 'string', enum: ['income', 'expense'] },
            amountVnd: { type: 'integer', minimum: 1 },
            categoryId: { type: 'string', format: 'uuid' },
            subcategoryId: { type: 'string', format: 'uuid', nullable: true },
            categoryNameSnapshot: { type: 'string' },
            subcategoryNameSnapshot: { type: 'string', nullable: true },
            transactionDate: { type: 'string', format: 'date' },
            note: { type: 'string' },
            paymentMethod: { type: 'string', enum: ['cash', 'transfer'] },
            paymentAccountId: { type: 'string', format: 'uuid', nullable: true },
            receiptImageUrl: { type: 'string', nullable: true },
            source: {
              type: 'string',
              enum: ['manual', 'ai', 'receipt_scan', 'import', 'shopping_plan'],
            },
            clientMutationId: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        TransactionPayload: {
          type: 'object',
          properties: {
            transaction: { $ref: '#/components/schemas/Transaction' },
          },
        },
        TransactionBulkPayload: {
          type: 'object',
          properties: {
            transactions: {
              type: 'array',
              items: { $ref: '#/components/schemas/Transaction' },
            },
          },
        },
        TransactionListPayload: {
          type: 'object',
          properties: {
            transactions: {
              type: 'array',
              items: { $ref: '#/components/schemas/Transaction' },
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                pageSize: { type: 'integer' },
                total: { type: 'integer' },
                totalPages: { type: 'integer' },
              },
            },
          },
        },
        TransactionSummary: {
          type: 'object',
          properties: {
            totalIncomeVnd: { type: 'integer' },
            totalExpenseVnd: { type: 'integer' },
            balanceVnd: { type: 'integer' },
            transactionCount: { type: 'integer' },
          },
        },
        TransactionSummaryPayload: {
          type: 'object',
          properties: {
            summary: { $ref: '#/components/schemas/TransactionSummary' },
          },
        },
        TransactionCalendarDay: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date' },
            totalIncomeVnd: { type: 'integer' },
            totalExpenseVnd: { type: 'integer' },
            balanceVnd: { type: 'integer' },
            transactionCount: { type: 'integer' },
          },
        },
        TransactionCalendarPayload: {
          type: 'object',
          properties: {
            calendar: {
              type: 'array',
              items: { $ref: '#/components/schemas/TransactionCalendarDay' },
            },
          },
        },
        CreateTransactionRequest: {
          type: 'object',
          required: [
            'ledgerId',
            'type',
            'amountVnd',
            'categoryId',
            'transactionDate',
            'paymentMethod',
          ],
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            type: { type: 'string', enum: ['income', 'expense'] },
            amountVnd: { type: 'integer', minimum: 1 },
            categoryId: { type: 'string', format: 'uuid' },
            subcategoryId: { type: 'string', format: 'uuid', nullable: true },
            transactionDate: { type: 'string', format: 'date' },
            note: { type: 'string', maxLength: 500 },
            paymentMethod: { type: 'string', enum: ['cash', 'transfer'] },
            paymentAccountId: { type: 'string', format: 'uuid', nullable: true },
            receiptImageUrl: { type: 'string', format: 'uri', nullable: true },
            source: {
              type: 'string',
              enum: ['manual', 'ai', 'receipt_scan', 'import', 'shopping_plan'],
              default: 'manual',
            },
            clientMutationId: { type: 'string', maxLength: 120 },
          },
        },
        UpdateTransactionRequest: {
          type: 'object',
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            type: { type: 'string', enum: ['income', 'expense'] },
            amountVnd: { type: 'integer', minimum: 1 },
            categoryId: { type: 'string', format: 'uuid' },
            subcategoryId: { type: 'string', format: 'uuid', nullable: true },
            transactionDate: { type: 'string', format: 'date' },
            note: { type: 'string', maxLength: 500 },
            paymentMethod: { type: 'string', enum: ['cash', 'transfer'] },
            paymentAccountId: { type: 'string', format: 'uuid', nullable: true },
            receiptImageUrl: { type: 'string', format: 'uri', nullable: true },
          },
        },
        BulkCreateTransactionRequest: {
          type: 'object',
          required: ['transactions'],
          properties: {
            transactions: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: { $ref: '#/components/schemas/CreateTransactionRequest' },
            },
          },
        },
        AnalyticsOverviewPayload: {
          type: 'object',
          properties: {
            overview: { $ref: '#/components/schemas/TransactionSummary' },
          },
        },
        AnalyticsCategoryBreakdownItem: {
          type: 'object',
          properties: {
            categoryId: { type: 'string', format: 'uuid', nullable: true },
            categoryName: { type: 'string' },
            totalAmountVnd: { type: 'integer' },
            transactionCount: { type: 'integer' },
            percentage: { type: 'number' },
          },
        },
        AnalyticsCategoryBreakdownPayload: {
          type: 'object',
          properties: {
            categories: {
              type: 'array',
              items: { $ref: '#/components/schemas/AnalyticsCategoryBreakdownItem' },
            },
          },
        },
        AnalyticsDailySpendingItem: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date' },
            totalExpenseVnd: { type: 'integer' },
            transactionCount: { type: 'integer' },
          },
        },
        AnalyticsDailySpendingPayload: {
          type: 'object',
          properties: {
            days: {
              type: 'array',
              items: { $ref: '#/components/schemas/AnalyticsDailySpendingItem' },
            },
          },
        },
        AnalyticsMonthlyTrendItem: {
          type: 'object',
          properties: {
            month: { type: 'string', format: 'date' },
            totalIncomeVnd: { type: 'integer' },
            totalExpenseVnd: { type: 'integer' },
            balanceVnd: { type: 'integer' },
            transactionCount: { type: 'integer' },
          },
        },
        AnalyticsMonthlyTrendPayload: {
          type: 'object',
          properties: {
            months: {
              type: 'array',
              items: { $ref: '#/components/schemas/AnalyticsMonthlyTrendItem' },
            },
          },
        },
        AnalyticsFluctuationItem: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date' },
            totalExpenseVnd: { type: 'integer' },
            previousExpenseVnd: { type: 'integer', nullable: true },
            changeVnd: { type: 'integer', nullable: true },
            changePercent: { type: 'number', nullable: true },
          },
        },
        AnalyticsFluctuationPayload: {
          type: 'object',
          properties: {
            points: {
              type: 'array',
              items: { $ref: '#/components/schemas/AnalyticsFluctuationItem' },
            },
          },
        },
        Budget: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            ledgerId: { type: 'string', format: 'uuid' },
            categoryId: { type: 'string', format: 'uuid', nullable: true },
            categoryName: { type: 'string', nullable: true },
            month: { type: 'string', format: 'date' },
            limitAmountVnd: { type: 'integer', minimum: 1 },
            warningThreshold: { type: 'integer', minimum: 1, maximum: 100 },
            spentAmountVnd: { type: 'integer' },
            progressPercent: { type: 'number' },
            status: { type: 'string', enum: ['ok', 'warning', 'exceeded'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        BudgetPayload: {
          type: 'object',
          properties: {
            budget: { $ref: '#/components/schemas/Budget' },
          },
        },
        BudgetListPayload: {
          type: 'object',
          properties: {
            budgets: {
              type: 'array',
              items: { $ref: '#/components/schemas/Budget' },
            },
          },
        },
        DeleteBudgetPayload: {
          type: 'object',
          properties: {
            budget: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
        CreateBudgetRequest: {
          type: 'object',
          required: ['ledgerId', 'month', 'limitAmountVnd'],
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            categoryId: { type: 'string', format: 'uuid', nullable: true },
            month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
            limitAmountVnd: { type: 'integer', minimum: 1 },
            warningThreshold: { type: 'integer', minimum: 1, maximum: 100, default: 80 },
          },
        },
        UpdateBudgetRequest: {
          type: 'object',
          properties: {
            limitAmountVnd: { type: 'integer', minimum: 1 },
            warningThreshold: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
        Goal: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            ledgerId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            targetAmountVnd: { type: 'integer', minimum: 1 },
            currentAmountVnd: { type: 'integer', minimum: 0 },
            deadline: { type: 'string', format: 'date', nullable: true },
            icon: { type: 'string', nullable: true },
            color: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['active', 'completed', 'cancelled'] },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        GoalPayload: {
          type: 'object',
          properties: {
            goal: { $ref: '#/components/schemas/Goal' },
          },
        },
        GoalListPayload: {
          type: 'object',
          properties: {
            goals: {
              type: 'array',
              items: { $ref: '#/components/schemas/Goal' },
            },
          },
        },
        CreateGoalRequest: {
          type: 'object',
          required: ['ledgerId', 'name', 'targetAmountVnd'],
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            targetAmountVnd: { type: 'integer', minimum: 1 },
            currentAmountVnd: { type: 'integer', minimum: 0 },
            deadline: { type: 'string', format: 'date', nullable: true },
            icon: { type: 'string', nullable: true, maxLength: 80 },
            color: { type: 'string', nullable: true, maxLength: 40 },
          },
        },
        UpdateGoalRequest: {
          type: 'object',
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            targetAmountVnd: { type: 'integer', minimum: 1 },
            currentAmountVnd: { type: 'integer', minimum: 0 },
            deadline: { type: 'string', format: 'date', nullable: true },
            icon: { type: 'string', nullable: true, maxLength: 80 },
            color: { type: 'string', nullable: true, maxLength: 40 },
            status: { type: 'string', enum: ['active', 'completed', 'cancelled'] },
          },
        },
        GoalDepositRequest: {
          type: 'object',
          required: ['amountVnd'],
          properties: {
            amountVnd: { type: 'integer', minimum: 1 },
          },
        },
        Debt: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            ledgerId: { type: 'string', format: 'uuid' },
            direction: { type: 'string', enum: ['borrowed', 'lent'] },
            counterpartyName: { type: 'string' },
            amountVnd: { type: 'integer', minimum: 1 },
            remainingAmountVnd: { type: 'integer', minimum: 0 },
            dueDate: { type: 'string', format: 'date', nullable: true },
            note: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['active', 'paid', 'overdue', 'cancelled'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        DebtPayment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            debtId: { type: 'string', format: 'uuid' },
            amountVnd: { type: 'integer', minimum: 1 },
            paidAt: { type: 'string', format: 'date' },
            note: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        DebtPayload: {
          type: 'object',
          properties: {
            debt: { $ref: '#/components/schemas/Debt' },
          },
        },
        DebtListPayload: {
          type: 'object',
          properties: {
            debts: {
              type: 'array',
              items: { $ref: '#/components/schemas/Debt' },
            },
          },
        },
        DebtPaymentPayload: {
          type: 'object',
          properties: {
            debt: { $ref: '#/components/schemas/Debt' },
            payment: { $ref: '#/components/schemas/DebtPayment' },
          },
        },
        CreateDebtRequest: {
          type: 'object',
          required: ['ledgerId', 'direction', 'counterpartyName', 'amountVnd'],
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            direction: { type: 'string', enum: ['borrowed', 'lent'] },
            counterpartyName: { type: 'string', minLength: 1, maxLength: 160 },
            amountVnd: { type: 'integer', minimum: 1 },
            dueDate: { type: 'string', format: 'date', nullable: true },
            note: { type: 'string', nullable: true, maxLength: 500 },
          },
        },
        UpdateDebtRequest: {
          type: 'object',
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            direction: { type: 'string', enum: ['borrowed', 'lent'] },
            counterpartyName: { type: 'string', minLength: 1, maxLength: 160 },
            amountVnd: { type: 'integer', minimum: 1 },
            remainingAmountVnd: { type: 'integer', minimum: 0 },
            dueDate: { type: 'string', format: 'date', nullable: true },
            note: { type: 'string', nullable: true, maxLength: 500 },
            status: { type: 'string', enum: ['active', 'paid', 'overdue', 'cancelled'] },
          },
        },
        DebtPaymentRequest: {
          type: 'object',
          required: ['amountVnd', 'paidAt'],
          properties: {
            amountVnd: { type: 'integer', minimum: 1 },
            paidAt: { type: 'string', format: 'date' },
            note: { type: 'string', nullable: true, maxLength: 500 },
          },
        },
        Challenge: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            ledgerId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            targetAmountVnd: { type: 'integer', minimum: 1, nullable: true },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            currentAmountVnd: { type: 'integer', minimum: 0 },
            streakDays: { type: 'integer', minimum: 0 },
            status: { type: 'string', enum: ['active', 'completed', 'cancelled'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ChallengeCheckin: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            challengeId: { type: 'string', format: 'uuid' },
            checkinDate: { type: 'string', format: 'date' },
            amountVnd: { type: 'integer', minimum: 0 },
            note: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ChallengePayload: {
          type: 'object',
          properties: {
            challenge: { $ref: '#/components/schemas/Challenge' },
          },
        },
        ChallengeListPayload: {
          type: 'object',
          properties: {
            challenges: {
              type: 'array',
              items: { $ref: '#/components/schemas/Challenge' },
            },
          },
        },
        ChallengeCheckinPayload: {
          type: 'object',
          properties: {
            challenge: { $ref: '#/components/schemas/Challenge' },
            checkin: { $ref: '#/components/schemas/ChallengeCheckin' },
            idempotent: { type: 'boolean' },
          },
        },
        CreateChallengeRequest: {
          type: 'object',
          required: ['ledgerId', 'name', 'startDate', 'endDate'],
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            targetAmountVnd: { type: 'integer', minimum: 1, nullable: true },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
          },
        },
        UpdateChallengeRequest: {
          type: 'object',
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            targetAmountVnd: { type: 'integer', minimum: 1, nullable: true },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            status: { type: 'string', enum: ['active', 'completed', 'cancelled'] },
          },
        },
        ChallengeCheckinRequest: {
          type: 'object',
          required: ['checkinDate'],
          properties: {
            checkinDate: { type: 'string', format: 'date' },
            amountVnd: { type: 'integer', minimum: 0, default: 0 },
            note: { type: 'string', nullable: true, maxLength: 500 },
          },
        },
        ShoppingPlan: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            ledgerId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            budgetAmountVnd: { type: 'integer', minimum: 0 },
            estimatedTotalVnd: { type: 'integer', minimum: 0 },
            boughtTotalVnd: { type: 'integer', minimum: 0 },
            itemCount: { type: 'integer', minimum: 0 },
            boughtCount: { type: 'integer', minimum: 0 },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ShoppingItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            shoppingPlanId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            quantity: { type: 'number', minimum: 0, exclusiveMinimum: true },
            estimatedPriceVnd: { type: 'integer', minimum: 0 },
            isBought: { type: 'boolean' },
            linkedTransactionId: { type: 'string', format: 'uuid', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ShoppingPlanPayload: {
          type: 'object',
          properties: {
            shoppingPlan: { $ref: '#/components/schemas/ShoppingPlan' },
          },
        },
        ShoppingPlanListPayload: {
          type: 'object',
          properties: {
            shoppingPlans: {
              type: 'array',
              items: { $ref: '#/components/schemas/ShoppingPlan' },
            },
          },
        },
        ShoppingPlanDetailPayload: {
          type: 'object',
          properties: {
            plan: { $ref: '#/components/schemas/ShoppingPlan' },
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/ShoppingItem' },
            },
          },
        },
        ShoppingItemPayload: {
          type: 'object',
          properties: {
            shoppingItem: { $ref: '#/components/schemas/ShoppingItem' },
          },
        },
        ShoppingItemConversionPayload: {
          type: 'object',
          properties: {
            item: { $ref: '#/components/schemas/ShoppingItem' },
            transaction: { $ref: '#/components/schemas/Transaction' },
            idempotent: { type: 'boolean' },
          },
        },
        CreateShoppingPlanRequest: {
          type: 'object',
          required: ['ledgerId', 'name'],
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            budgetAmountVnd: { type: 'integer', minimum: 0, default: 0 },
          },
        },
        UpdateShoppingPlanRequest: {
          type: 'object',
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            budgetAmountVnd: { type: 'integer', minimum: 0 },
          },
        },
        CreateShoppingItemRequest: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 160 },
            quantity: { type: 'number', minimum: 0, exclusiveMinimum: true, default: 1 },
            estimatedPriceVnd: { type: 'integer', minimum: 0, default: 0 },
            isBought: { type: 'boolean', default: false },
          },
        },
        UpdateShoppingItemRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 160 },
            quantity: { type: 'number', minimum: 0, exclusiveMinimum: true },
            estimatedPriceVnd: { type: 'integer', minimum: 0 },
            isBought: { type: 'boolean' },
          },
        },
        ConvertShoppingItemRequest: {
          type: 'object',
          required: ['categoryId', 'transactionDate', 'paymentMethod'],
          properties: {
            categoryId: { type: 'string', format: 'uuid' },
            subcategoryId: { type: 'string', format: 'uuid', nullable: true },
            transactionDate: { type: 'string', format: 'date' },
            paymentMethod: { type: 'string', enum: ['cash', 'transfer'] },
            paymentAccountId: { type: 'string', format: 'uuid', nullable: true },
            amountVnd: { type: 'integer', minimum: 1 },
            note: { type: 'string', nullable: true, maxLength: 500 },
            clientMutationId: { type: 'string', minLength: 1, maxLength: 120 },
          },
        },
        AiTransactionPreview: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['income', 'expense'] },
            amountVnd: { type: 'integer', nullable: true },
            categoryId: { type: 'string', format: 'uuid', nullable: true },
            categoryName: { type: 'string', nullable: true },
            subcategoryId: { type: 'string', format: 'uuid', nullable: true },
            transactionDate: { type: 'string', format: 'date' },
            note: { type: 'string' },
            paymentMethod: { type: 'string', enum: ['cash', 'transfer'] },
            source: { type: 'string', enum: ['ai'] },
            confidence: { type: 'number' },
            rawText: { type: 'string' },
          },
        },
        AiTransactionPreviewRequest: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 500 },
            transactionDate: { type: 'string', format: 'date' },
            paymentMethod: { type: 'string', enum: ['cash', 'transfer'] },
            currentDate: { type: 'string', format: 'date' },
            timeZone: { type: 'string' },
          },
        },
        AiTransactionPreviewPayload: {
          type: 'object',
          properties: {
            preview: { $ref: '#/components/schemas/AiTransactionPreview' },
            missingFields: {
              type: 'array',
              items: { type: 'string' },
            },
            clarification: { type: 'string', nullable: true },
          },
        },
        AiExecuteActionRequest: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: [
                'createTransaction',
                'getTransactionsByDateRange',
                'getBalance',
                'getTotalIncome',
                'getTotalExpense',
                'deleteTransaction',
                'deleteMultipleTransactions',
                'getBudgetStatus',
                'getTopCategories',
              ],
            },
            payload: {
              type: 'object',
              description:
                'Action payload. deleteMultipleTransactions requires confirmed=true.',
            },
          },
        },
        AiActionResultPayload: {
          type: 'object',
          properties: {
            action: { type: 'string' },
          },
          additionalProperties: true,
        },
        AiChatRequest: {
          type: 'object',
          required: ['message', 'ledgerId'],
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 2000 },
            ledgerId: { type: 'string', format: 'uuid' },
            conversationId: { type: 'string', format: 'uuid' },
            saveHistory: { type: 'boolean', default: false },
            currentDate: { type: 'string', format: 'date' },
            timeZone: { type: 'string' },
          },
        },
        AiChatPayload: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            toolName: { type: 'string', nullable: true },
            toolResult: { type: 'object', nullable: true },
            conversation: { $ref: '#/components/schemas/AiConversation' },
          },
        },
        AiReceiptScanRequest: {
          type: 'object',
          required: ['imageBase64', 'mimeType'],
          properties: {
            imageBase64: { type: 'string' },
            mimeType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] },
          },
        },
        AiReceiptScanPayload: {
          type: 'object',
          properties: {
            receipt: { type: 'object' },
          },
        },
        AiConversation: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            ledgerId: { type: 'string', format: 'uuid', nullable: true },
            title: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        AiMessage: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            conversationId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            role: { type: 'string', enum: ['user', 'assistant', 'tool'] },
            content: { type: 'string', nullable: true },
            functionName: { type: 'string', nullable: true },
            functionPayload: { type: 'object', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        AiConversationListPayload: {
          type: 'object',
          properties: {
            conversations: {
              type: 'array',
              items: { $ref: '#/components/schemas/AiConversation' },
            },
          },
        },
        AiMessageListPayload: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              items: { $ref: '#/components/schemas/AiMessage' },
            },
          },
        },
        ImportPreviewRequest: {
          type: 'object',
          required: ['ledgerId', 'sourceType'],
          properties: {
            ledgerId: { type: 'string', format: 'uuid' },
            sourceType: { type: 'string', enum: ['csv', 'xlsx', 'paste_text'] },
            content: {
              type: 'string',
              description: 'CSV or pasted table text with a header row.',
            },
            contentBase64: {
              type: 'string',
              description: 'Base64 encoded XLSX workbook for sourceType=xlsx.',
            },
          },
        },
        ImportRowError: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
        ImportRow: {
          type: 'object',
          properties: {
            rowNumber: { type: 'integer' },
            raw: { type: 'object' },
            isValid: { type: 'boolean' },
            errors: {
              type: 'array',
              items: { $ref: '#/components/schemas/ImportRowError' },
            },
            normalized: {
              allOf: [{ $ref: '#/components/schemas/CreateTransactionRequest' }],
              nullable: true,
            },
          },
        },
        ImportJob: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            ledgerId: { type: 'string', format: 'uuid' },
            sourceType: { type: 'string', enum: ['csv', 'xlsx', 'paste_text'] },
            status: {
              type: 'string',
              enum: ['preview', 'processing', 'completed', 'failed'],
            },
            summary: {
              type: 'object',
              properties: {
                sourceType: { type: 'string' },
                totalRows: { type: 'integer' },
                validCount: { type: 'integer' },
                invalidCount: { type: 'integer' },
                committedCount: { type: 'integer' },
                rows: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ImportRow' },
                },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ImportJobPayload: {
          type: 'object',
          properties: {
            job: { $ref: '#/components/schemas/ImportJob' },
          },
        },
        ImportCommitPayload: {
          type: 'object',
          properties: {
            job: { $ref: '#/components/schemas/ImportJob' },
            transactions: {
              type: 'array',
              items: { $ref: '#/components/schemas/Transaction' },
            },
          },
        },
        RegisterDeviceRequest: {
          type: 'object',
          required: ['platform', 'expoPushToken'],
          properties: {
            platform: { type: 'string', enum: ['ios', 'android'] },
            expoPushToken: { type: 'string', minLength: 1, maxLength: 300 },
          },
        },
        DeviceToken: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            platform: { type: 'string', enum: ['ios', 'android'] },
            expoPushToken: { type: 'string' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        DeviceTokenPayload: {
          type: 'object',
          properties: {
            deviceToken: { $ref: '#/components/schemas/DeviceToken' },
          },
        },
        NotificationEvent: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            type: {
              type: 'string',
              enum: [
                'daily_reminder',
                'budget_threshold',
                'debt_due',
                'debt_overdue',
                'goal_completed',
              ],
            },
            title: { type: 'string' },
            body: { type: 'string' },
            payload: { type: 'object', nullable: true },
            eventKey: { type: 'string', nullable: true },
            sentAt: { type: 'string', format: 'date-time', nullable: true },
            readAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        NotificationPayload: {
          type: 'object',
          properties: {
            notification: { $ref: '#/components/schemas/NotificationEvent' },
          },
        },
        NotificationListPayload: {
          type: 'object',
          properties: {
            notifications: {
              type: 'array',
              items: { $ref: '#/components/schemas/NotificationEvent' },
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                pageSize: { type: 'integer' },
                total: { type: 'integer' },
                totalPages: { type: 'integer' },
              },
            },
          },
        },
        SyncRecord: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        SyncChangesPayload: {
          type: 'object',
          properties: {
            since: { type: 'string', format: 'date-time' },
            serverTime: { type: 'string', format: 'date-time' },
            changes: {
              type: 'object',
              properties: {
                userSettings: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                ledgers: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                categories: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                paymentAccounts: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                transactions: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                budgets: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                goals: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                debts: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                debtPayments: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                challenges: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                challengeCheckins: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                shoppingPlans: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                shoppingItems: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
                notifications: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SyncRecord' },
                },
              },
            },
          },
        },
        SyncMutation: {
          type: 'object',
          required: ['clientMutationId', 'operation'],
          properties: {
            clientMutationId: { type: 'string', minLength: 1, maxLength: 120 },
            operation: {
              type: 'string',
              enum: [
                'transactions.create',
                'transactions.update',
                'transactions.delete',
              ],
            },
            payload: { type: 'object' },
          },
        },
        SyncMutationsRequest: {
          type: 'object',
          required: ['mutations'],
          properties: {
            mutations: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              items: { $ref: '#/components/schemas/SyncMutation' },
            },
          },
        },
        SyncMutationResult: {
          type: 'object',
          properties: {
            clientMutationId: { type: 'string' },
            operation: { type: 'string' },
            status: {
              type: 'string',
              enum: ['completed', 'replayed', 'processing', 'failed'],
            },
            result: { type: 'object', nullable: true },
          },
        },
        SyncMutationsPayload: {
          type: 'object',
          properties: {
            serverTime: { type: 'string', format: 'date-time' },
            results: {
              type: 'array',
              items: { $ref: '#/components/schemas/SyncMutationResult' },
            },
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
