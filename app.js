var express = require('express');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors');
var helmet = require('helmet');

var env = require('./config/env');
var indexRouter = require('./routes/index');
var healthRouter = require('./routes/health');
var docsRouter = require('./routes/docs');
var authRouter = require('./modules/auth/authRoutes');
var meRouter = require('./modules/users/meRoutes');
var requestId = require('./middlewares/requestId');
var notFound = require('./middlewares/notFound');
var errorHandler = require('./middlewares/errorHandler');

var app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(requestId);
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
app.use(logger(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use('/', indexRouter);
app.use('/', docsRouter);
app.use('/health', healthRouter);
app.use(env.API_PREFIX + '/health', healthRouter);
app.use(env.API_PREFIX + '/auth', authRouter);
app.use(env.API_PREFIX + '/me', meRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
