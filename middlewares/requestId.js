const { randomUUID } = require('crypto');

function requestId(req, res, next) {
  const value = req.get('x-request-id') || randomUUID();

  req.requestId = value;
  res.set('X-Request-Id', value);
  next();
}

module.exports = requestId;
