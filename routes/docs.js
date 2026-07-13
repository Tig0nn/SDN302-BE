const express = require('express');
const { buildOpenApiSpec } = require('../docs/api/openapi');

const router = express.Router();

router.get('/openapi.json', function getOpenApiJson(req, res) {
  res.json(buildOpenApiSpec(req));
});

router.get('/docs', function getDocs(req, res) {
  res.type('html').send(`<!doctype html>
<html>
  <head>
    <title>Ví Vi Vu API Docs</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
      }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/openapi.json"
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"
    ></script>
  </body>
</html>`);
});

module.exports = router;
