var express = require('express');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors');
var helmet = require('helmet');

var env = require('./config/env');
var indexRouter = require('./routes/index');
var healthRouter = require('./routes/health');
var docsRouter = require('./routes/docs');
var metricsRouter = require('./routes/metrics');
var authRouter = require('./modules/auth/authRoutes');
var meRouter = require('./modules/users/meRoutes');
var ledgerRouter = require('./modules/ledgers/ledgerRoutes');
var categoryRouter = require('./modules/categories/categoryRoutes');
var paymentAccountRouter = require('./modules/paymentAccounts/paymentAccountRoutes');
var transactionRouter = require('./modules/transactions/transactionRoutes');
var analyticsRouter = require('./modules/analytics/analyticsRoutes');
var budgetRouter = require('./modules/budgets/budgetRoutes');
var goalRouter = require('./modules/goals/goalRoutes');
var debtRouter = require('./modules/debts/debtRoutes');
var challengeRouter = require('./modules/challenges/challengeRoutes');
var shoppingPlanRouter = require('./modules/shopping/shoppingPlanRoutes');
var shoppingItemRouter = require('./modules/shopping/shoppingItemRoutes');
var aiRouter = require('./modules/ai/aiRoutes');
var importRouter = require('./modules/imports/importRoutes');
var exportRouter = require('./modules/exports/exportRoutes');
var deviceRouter = require('./modules/notifications/deviceRoutes');
var notificationRouter = require('./modules/notifications/notificationRoutes');
var syncRouter = require('./modules/sync/syncRoutes');
var requestId = require('./middlewares/requestId');
var metricsMiddleware = require('./middlewares/metrics');
var rateLimit = require('./middlewares/rateLimit');
var notFound = require('./middlewares/notFound');
var errorHandler = require('./middlewares/errorHandler');

var app = express();
var defaultJsonParser = express.json({ limit: env.JSON_BODY_LIMIT });
var aiReceiptJsonParser = express.json({ limit: env.AI_RECEIPT_BODY_LIMIT });

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(requestId);
app.use(metricsMiddleware);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.use(
  cors({
    origin: function checkOrigin(origin, callback) {
      if (
        !origin ||
        env.CORS_ORIGINS.includes('*') ||
        env.CORS_ORIGINS.includes(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  })
);
app.use(rateLimit);
app.use(logger(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(function selectJsonParser(req, res, next) {
  if (req.path === env.API_PREFIX + '/ai/receipt-scan') {
    aiReceiptJsonParser(req, res, next);
    return;
  }

  defaultJsonParser(req, res, next);
});
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use('/', indexRouter);
app.use('/', docsRouter);
app.use('/metrics', metricsRouter);
app.use('/health', healthRouter);
app.use(env.API_PREFIX + '/health', healthRouter);
app.use(env.API_PREFIX + '/metrics', metricsRouter);
app.use(env.API_PREFIX + '/auth', authRouter);
app.use(env.API_PREFIX + '/me', meRouter);
app.use(env.API_PREFIX + '/ledgers', ledgerRouter);
app.use(env.API_PREFIX + '/categories', categoryRouter);
app.use(env.API_PREFIX + '/payment-accounts', paymentAccountRouter);
app.use(env.API_PREFIX + '/transactions', transactionRouter);
app.use(env.API_PREFIX + '/analytics', analyticsRouter);
app.use(env.API_PREFIX + '/budgets', budgetRouter);
app.use(env.API_PREFIX + '/goals', goalRouter);
app.use(env.API_PREFIX + '/debts', debtRouter);
app.use(env.API_PREFIX + '/challenges', challengeRouter);
app.use(env.API_PREFIX + '/shopping-plans', shoppingPlanRouter);
app.use(env.API_PREFIX + '/shopping-items', shoppingItemRouter);
app.use(env.API_PREFIX + '/ai', aiRouter);
app.use(env.API_PREFIX + '/imports', importRouter);
app.use(env.API_PREFIX + '/exports', exportRouter);
app.use(env.API_PREFIX + '/devices', deviceRouter);
app.use(env.API_PREFIX + '/notifications', notificationRouter);
app.use(env.API_PREFIX + '/sync', syncRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
