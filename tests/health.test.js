const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app');

function request(path, options = {}) {
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', function onListen() {
      const address = server.address();
      const body = options.body ? JSON.stringify(options.body) : null;

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: options.method || 'GET',
          headers: {
            ...(body
              ? {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(body),
                }
              : {}),
            ...(options.headers || {}),
          },
        },
        function onResponse(res) {
          let raw = '';

          res.setEncoding('utf8');
          res.on('data', function onData(chunk) {
            raw += chunk;
          });
          res.on('end', function onEnd() {
            server.close(function onClose() {
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body:
                  raw && res.headers['content-type']?.includes('application/json')
                    ? JSON.parse(raw)
                    : raw,
              });
            });
          });
        }
      );

      req.on('error', function onError(err) {
        server.close(function onClose() {
          reject(err);
        });
      });

      if (body) {
        req.write(body);
      }

      req.end();
    });
  });
}

test('GET /health returns standard success payload', async function () {
  const res = await request('/health');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.ok, true);
  assert.equal(res.body.data.service, 'vi-vi-vu-api');
  assert.equal(res.body.error, null);
  assert.ok(res.body.meta.requestId);
  assert.equal(res.headers['x-request-id'], res.body.meta.requestId);
});

test('GET / returns service metadata as JSON', async function () {
  const res = await request('/');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.ok, true);
  assert.equal(res.body.data.service, 'vi-vi-vu-api');
  assert.equal(res.body.data.health, '/health');
  assert.equal(res.body.error, null);
});

test('unknown routes return standard error payload', async function () {
  const res = await request('/missing-route');

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.equal(res.body.error.message, 'Route not found');
  assert.ok(res.body.meta.requestId);
});

test('GET /api/v1/me requires an access token', async function () {
  const res = await request('/api/v1/me');

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.code, 'AUTH_REQUIRED');
});

test('POST /api/v1/auth/google validates idToken', async function () {
  const res = await request('/api/v1/auth/google', {
    method: 'POST',
    body: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/email/register validates required fields', async function () {
  const res = await request('/api/v1/auth/email/register', {
    method: 'POST',
    body: {
      email: 'not-an-email',
      password: 'short',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/email/verify validates OTP shape', async function () {
  const res = await request('/api/v1/auth/email/verify', {
    method: 'POST',
    body: {
      email: 'user@example.com',
      otpCode: 'abc',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('GET /openapi.json exposes documented routes', async function () {
  const res = await request('/openapi.json');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.openapi, '3.0.3');
  assert.equal(res.body.info.title, 'Ví Vi Vu API');
  assert.ok(res.body.paths['/api/v1/auth/email/register']);
  assert.ok(res.body.paths['/api/v1/auth/email/verify']);
  assert.ok(res.body.paths['/api/v1/auth/email/login']);
  assert.ok(res.body.paths['/api/v1/auth/google']);
  assert.ok(res.body.paths['/api/v1/me']);
});

test('GET /docs serves interactive API documentation shell', async function () {
  const res = await request('/docs');

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Ví Vi Vu API Docs/);
  assert.match(res.body, /\/openapi\.json/);
});
