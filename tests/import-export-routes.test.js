const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const db = require('../config/db');
const app = require('../app');

const originalQuery = db.query;
const originalGetPool = db.getPool;

const userA = '11111111-1111-4111-8111-111111111111';
const ledgerId = '33333333-3333-4333-8333-333333333333';
const categoryId = '44444444-4444-4444-8444-444444444444';
const transactionId = '77777777-7777-4777-8777-777777777777';
const importJobId = '99999999-9999-4999-8999-999999999999';

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function authToken() {
  return jwt.sign(
    {
      sub: userA,
      email: 'user-a@example.com',
    },
    process.env.JWT_SECRET,
    {
      expiresIn: 60,
      issuer: 'vi-vi-vu-api',
      audience: 'vi-vi-vu-mobile',
    }
  );
}

function userRow() {
  return {
    id: userA,
    googleSub: 'google-user-a',
    email: 'user-a@example.com',
    displayName: 'User A',
    avatarUrl: null,
    emailVerifiedAt: '2026-06-01T00:00:00.000Z',
    locale: 'vi-VN',
    timezone: 'Asia/Ho_Chi_Minh',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function categoryRows() {
  return [
    {
      id: categoryId,
      userId: userA,
      type: 'expense',
      name: 'Food',
      parentId: null,
      icon: 'utensils',
      color: '#00875A',
      isSystem: false,
      sortOrder: 1,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
  ];
}

function transactionRow(overrides = {}) {
  return {
    id: transactionId,
    userId: userA,
    ledgerId,
    type: 'expense',
    amountVnd: '30000',
    categoryId,
    subcategoryId: null,
    categoryNameSnapshot: 'Food',
    subcategoryNameSnapshot: null,
    transactionDate: '2026-06-01',
    note: 'Breakfast',
    paymentMethod: 'cash',
    paymentAccountId: null,
    receiptImageUrl: null,
    source: 'import',
    clientMutationId: `import:${importJobId}:2`,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function importSummary() {
  return {
    sourceType: 'csv',
    totalRows: 1,
    validCount: 1,
    invalidCount: 0,
    rows: [
      {
        rowNumber: 2,
        isValid: true,
        raw: {},
        errors: [],
        normalized: {
          type: 'expense',
          amountVnd: 30000,
          categoryId,
          subcategoryId: null,
          transactionDate: '2026-06-01',
          note: 'Breakfast',
          paymentMethod: 'cash',
          paymentAccountId: null,
          receiptImageUrl: null,
          source: 'import',
        },
      },
    ],
  };
}

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
            authorization: `Bearer ${authToken()}`,
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
          const chunks = [];

          res.on('data', function onData(chunk) {
            chunks.push(Buffer.from(chunk));
          });
          res.on('end', function onEnd() {
            server.close(function onClose() {
              const buffer = Buffer.concat(chunks);
              const raw = buffer.toString('utf8');

              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                buffer,
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

function installQueryHandler(handler) {
  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    if (normalized.includes('from users')) {
      assert.equal(params[0], userA);
      return { rowCount: 1, rows: [userRow()] };
    }

    return handler(normalized, params);
  };
}

function installExportQueryHandler() {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from transactions t')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], '2026-06-01');
      assert.equal(params[4], 'expense');
      assert.equal(params[7], 10000);

      return { rowCount: 1, rows: [transactionRow()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
  db.getPool = originalGetPool;
});

test('POST /api/v1/imports/preview validates rows and supported date formats', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('with user_category_count')) {
      return { rowCount: 1, rows: categoryRows() };
    }

    if (sql.includes('from payment_accounts')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('insert into import_jobs')) {
      const summary = JSON.parse(params[3]);

      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'csv');
      assert.equal(summary.validCount, 5);
      assert.equal(summary.invalidCount, 1);

      return {
        rowCount: 1,
        rows: [
          {
            id: importJobId,
            userId: userA,
            ledgerId,
            sourceType: 'csv',
            status: 'preview',
            summary,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const content = [
    'type,amountVnd,date,category,note',
    'expense,30000,01/06/2026,Food,A',
    'expense,30000,01-06-2026,Food,B',
    'expense,30000,2026-06-01,Food,C',
    'expense,30000,01/06/26,Food,D',
    'expense,30000,01-06-26,Food,E',
    'expense,abc,2026/99/01,Food,Bad',
  ].join('\n');
  const res = await request('/api/v1/imports/preview', {
    method: 'POST',
    body: {
      ledgerId,
      sourceType: 'csv',
      content,
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.job.summary.validCount, 5);
  assert.equal(res.body.data.job.summary.invalidCount, 1);
  assert.deepEqual(
    res.body.data.job.summary.rows[5].errors.map((error) => error.field),
    ['amountVnd', 'transactionDate']
  );
});

test('POST /api/v1/imports/:id/commit writes valid rows in a database transaction', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      clientQueries.push({ sql: normalized, params });

      if (['begin', 'commit', 'rollback'].includes(normalized)) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('from import_jobs') && normalized.includes('for update')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: importJobId,
              userId: userA,
              ledgerId,
              sourceType: 'csv',
              status: 'preview',
              summary: importSummary(),
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (normalized.includes('client_mutation_id = $2')) {
        assert.equal(params[1], `import:${importJobId}:2`);
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('from ledgers')) {
        return { rowCount: 1, rows: [{ id: ledgerId }] };
      }

      if (normalized.includes('from categories')) {
        return { rowCount: 1, rows: categoryRows() };
      }

      if (normalized.includes('insert into transactions')) {
        assert.equal(params[13], 'import');
        assert.equal(params[14], `import:${importJobId}:2`);
        return { rowCount: 1, rows: [transactionRow()] };
      }

      if (normalized.includes('from budgets')) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('update import_jobs')) {
        const summary = JSON.parse(params[2]);

        assert.equal(summary.committedCount, 1);

        return {
          rowCount: 1,
          rows: [
            {
              id: importJobId,
              userId: userA,
              ledgerId,
              sourceType: 'csv',
              status: 'completed',
              summary,
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ],
        };
      }

      throw new Error(`Unexpected client query: ${normalized}`);
    },
    release() {},
  };

  db.getPool = function getFakePool() {
    return {
      connect: async function connect() {
        return client;
      },
    };
  };

  const res = await request(`/api/v1/imports/${importJobId}/commit`, {
    method: 'POST',
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.transactions[0].id, transactionId);
  assert.ok(clientQueries.some((query) => query.sql === 'begin'));
  assert.ok(clientQueries.some((query) => query.sql === 'commit'));
});

test('POST /api/v1/imports/:id/commit rolls back on system errors', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected db query: ${sql}`);
  });

  const clientQueries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      clientQueries.push({ sql: normalized, params });

      if (['begin', 'commit', 'rollback'].includes(normalized)) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('from import_jobs') && normalized.includes('for update')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: importJobId,
              userId: userA,
              ledgerId,
              sourceType: 'csv',
              status: 'preview',
              summary: importSummary(),
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (normalized.includes('client_mutation_id = $2')) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('from ledgers')) {
        return { rowCount: 1, rows: [{ id: ledgerId }] };
      }

      if (normalized.includes('from categories')) {
        return { rowCount: 1, rows: categoryRows() };
      }

      if (normalized.includes('insert into transactions')) {
        throw new Error('database write failed');
      }

      throw new Error(`Unexpected client query: ${normalized}`);
    },
    release() {},
  };

  db.getPool = function getFakePool() {
    return {
      connect: async function connect() {
        return client;
      },
    };
  };

  const res = await request(`/api/v1/imports/${importJobId}/commit`, {
    method: 'POST',
  });

  assert.equal(res.statusCode, 500);
  assert.ok(clientQueries.some((query) => query.sql === 'rollback'));
  assert.ok(!clientQueries.some((query) => query.sql === 'commit'));
});

test('GET /api/v1/exports/transactions.csv uses transaction list filters', async function () {
  installExportQueryHandler();

  const res = await request(
    `/api/v1/exports/transactions.csv?ledgerId=${ledgerId}&dateFrom=2026-06-01&type=expense`
  );

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.body, /Amount VND/);
  assert.match(res.body, /30000/);
  assert.match(res.body, /Food/);
});

test('GET /api/v1/exports/transactions.xlsx returns an openable workbook', async function () {
  installExportQueryHandler();

  const res = await request(
    `/api/v1/exports/transactions.xlsx?ledgerId=${ledgerId}&dateFrom=2026-06-01&type=expense`
  );
  const workbook = new ExcelJS.Workbook();

  assert.equal(res.statusCode, 200);
  assert.equal(res.buffer.slice(0, 2).toString('utf8'), 'PK');

  await workbook.xlsx.load(res.buffer);

  const worksheet = workbook.getWorksheet('Transactions');

  assert.equal(worksheet.getCell('A1').value, 'Date');
  assert.equal(worksheet.getCell('C2').value, 30000);
});

test('GET /api/v1/exports/transactions.pdf returns a PDF document', async function () {
  installExportQueryHandler();

  const res = await request(
    `/api/v1/exports/transactions.pdf?ledgerId=${ledgerId}&dateFrom=2026-06-01&type=expense`
  );

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  assert.equal(res.buffer.slice(0, 4).toString('utf8'), '%PDF');
});
