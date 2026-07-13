const createError = require('http-errors');

function notFound(req, res, next) {
  next(createError(404, 'Route not found'));
}

module.exports = notFound;
