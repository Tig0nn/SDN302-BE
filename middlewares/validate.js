const { ZodError } = require('zod');

function validate(schemas) {
  return function validateRequest(req, res, next) {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }

      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }

      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      next();
    } catch (err) {
      if (err instanceof ZodError) {
        err.status = 400;
        err.code = 'VALIDATION_ERROR';
      }

      next(err);
    }
  };
}

module.exports = validate;
