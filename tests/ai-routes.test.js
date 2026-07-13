const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-enough-length';

const db = require('../config/db');
const env = require('../config/env');
const app = require('../app');

const originalQuery = db.query;
const originalGetPool = db.getPool;
const originalFetch = global.fetch;
const originalGeminiTimeoutMs = env.GEMINI_TIMEOUT_MS;
const originalChatApiKey = env.GEMINI_CHAT_API_KEY;
const originalReceiptApiKey = env.GEMINI_RECEIPT_API_KEY;

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const ledgerId = '33333333-3333-4333-8333-333333333333';
const expenseCategoryId = '44444444-4444-4444-8444-444444444444';
const incomeCategoryId = '55555555-5555-4555-8555-555555555555';
const savedConversationId = '99999999-9999-4999-8999-999999999999';

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
          let raw = '';

          res.setEncoding('utf8');
          res.on('data', function onData(chunk) {
            raw += chunk;
          });
          res.on('end', function onEnd() {
            server.close(function onClose() {
              resolve({
                statusCode: res.statusCode,
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
  const queries = [];

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    queries.push({ sql: normalized, params });

    if (normalized.includes('from users')) {
      assert.equal(params[0], userA);
      return { rowCount: 1, rows: [userRow()] };
    }

    return handler(normalized, params);
  };

  return queries;
}

function handleCategoryQuery(sql, params) {
  if (sql.includes('from categories c')) {
    assert.equal(params[0], userA);

    if (params[1] === 'expense') {
      return {
        rowCount: 1,
        rows: [
          {
            id: expenseCategoryId,
            userId: null,
            type: 'expense',
            name: 'An uong',
            parentId: null,
            icon: 'utensils',
            color: '#EF4444',
            isSystem: true,
            sortOrder: 1,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    return {
      rowCount: 1,
      rows: [
        {
          id: incomeCategoryId,
          userId: null,
          type: 'income',
          name: 'Thu nhap',
          parentId: null,
          icon: 'wallet',
          color: '#22C55E',
          isSystem: true,
          sortOrder: 1,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    };
  }

  throw new Error(`Unexpected query: ${sql}`);
}

function handleSaveHistoryQuery(sql, params) {
  if (sql.includes('insert into ai_conversations')) {
    assert.equal(params[0], userA);
    assert.equal(params[1], ledgerId);

    return {
      rowCount: 1,
      rows: [
        {
          id: savedConversationId,
          userId: userA,
          ledgerId,
          title: params[2],
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    };
  }

  if (sql.includes('insert into ai_messages')) {
    assert.equal(params[0], savedConversationId);
    assert.equal(params[1], userA);

    return {
      rowCount: 1,
      rows: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          conversationId: params[0],
          userId: params[1],
          role: params[2],
          content: params[3],
          functionName: params[4],
          functionPayload: params[5] ? JSON.parse(params[5]) : null,
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    };
  }

  if (sql.includes('update ai_conversations')) {
    assert.equal(params[0], userA);
    assert.equal(params[1], savedConversationId);

    return { rowCount: 1, rows: [] };
  }

  return null;
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
  db.getPool = originalGetPool;
  global.fetch = originalFetch;
  env.GEMINI_TIMEOUT_MS = originalGeminiTimeoutMs;
  env.GEMINI_CHAT_API_KEY = originalChatApiKey;
  env.GEMINI_RECEIPT_API_KEY = originalReceiptApiKey;
});

test('POST /api/v1/ai/transaction-preview parses breakfast expense shorthand', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    return handleCategoryQuery(sql, params);
  });

  const res = await request('/api/v1/ai/transaction-preview', {
    method: 'POST',
    body: {
      text: '\u0102n s\u00e1ng 30',
      currentDate: '2026-06-01',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.preview.type, 'expense');
  assert.equal(res.body.data.preview.amountVnd, 30000);
  assert.equal(res.body.data.preview.categoryId, expenseCategoryId);
  assert.equal(res.body.data.preview.categoryName, 'An uong');
  assert.equal(res.body.data.preview.transactionDate, '2026-06-01');
  assert.deepEqual(res.body.data.missingFields, []);
});

test('POST /api/v1/ai/transaction-preview parses salary income in millions', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    return handleCategoryQuery(sql, params);
  });

  const res = await request('/api/v1/ai/transaction-preview', {
    method: 'POST',
    body: {
      text: 'l\u01b0\u01a1ng v\u1ec1 15 tri\u1ec7u',
      currentDate: '2026-06-01',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.preview.type, 'income');
  assert.equal(res.body.data.preview.amountVnd, 15000000);
  assert.equal(res.body.data.preview.categoryId, incomeCategoryId);
  assert.equal(res.body.data.preview.categoryName, 'Thu nhap');
});

test('POST /api/v1/ai/transaction-preview returns multiple previews from one message', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    return handleCategoryQuery(sql, params);
  });

  const res = await request('/api/v1/ai/transaction-preview', {
    method: 'POST',
    body: {
      text: '\u0110\u01b0\u1ee3c m\u1eb9 cho 500k \u0111i ch\u1ee3 h\u1ebft 200k',
      currentDate: '2026-06-01',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.previews.length, 2);
  assert.equal(res.body.data.previews[0].type, 'income');
  assert.equal(res.body.data.previews[0].amountVnd, 500000);
  assert.equal(res.body.data.previews[1].type, 'expense');
  assert.equal(res.body.data.previews[1].amountVnd, 200000);
  assert.deepEqual(res.body.data.preview, res.body.data.previews[0]);
});

test('POST /api/v1/ai/transaction-preview asks for missing amount', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    return handleCategoryQuery(sql, params);
  });

  const res = await request('/api/v1/ai/transaction-preview', {
    method: 'POST',
    body: {
      text: '\u0102n s\u00e1ng',
      currentDate: '2026-06-01',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.preview.amountVnd, null);
  assert.deepEqual(res.body.data.missingFields, ['amountVnd']);
  assert.match(res.body.data.clarification, /so tien/);
});

test('POST /api/v1/ai/chat requires backend Gemini chat key', async function () {
  env.GEMINI_CHAT_API_KEY = '';

  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/ai/chat', {
    method: 'POST',
    body: {
      ledgerId,
      message: 'thang nay con bao nhieu',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'GEMINI_KEY_REQUIRED');
});

test('POST /api/v1/ai/execute-action requires confirmation for bulk delete', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/ai/execute-action', {
    method: 'POST',
    body: {
      action: 'deleteMultipleTransactions',
      payload: {
        transactionIds: [
          '77777777-7777-4777-8777-777777777777',
          '88888888-8888-4888-8888-888888888888',
        ],
      },
    },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(
    res.body.error.code,
    'AI_BULK_DELETE_CONFIRMATION_REQUIRED'
  );
});

test('POST /api/v1/ai/chat fetches backend balance before Gemini response', async function () {
  env.GEMINI_CHAT_API_KEY = 'server-chat-key';

  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('totalincomevnd')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], '2026-06-01');
      assert.equal(params[3], '2026-06-30');

      return {
        rowCount: 1,
        rows: [
          {
            totalIncomeVnd: '100000',
            totalExpenseVnd: '30000',
            balanceVnd: '70000',
            transactionCount: 2,
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });
  const fetchCalls = [];

  global.fetch = async function fakeFetch(url, options) {
    fetchCalls.push({ url, options });
    assert.equal(options.headers['x-goog-api-key'], 'server-chat-key');
    assert.ok(!options.body.includes('server-chat-key'));

    return {
      ok: true,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [{ text: 'So du hien tai la 70000 VND.' }],
              },
            },
          ],
        };
      },
    };
  };

  const res = await request('/api/v1/ai/chat', {
    method: 'POST',
    body: {
      ledgerId,
      message: 'thang nay con bao nhieu',
      currentDate: '2026-06-15',
      saveHistory: false,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.message, 'So du hien tai la 70000 VND.');
  assert.equal(res.body.data.toolName, 'getBalance');
  assert.equal(res.body.data.toolResult.summary.balanceVnd, 70000);
  assert.ok(queries.some((query) => query.sql.includes('totalincomevnd')));
  assert.equal(fetchCalls.length, 1);
});

test('POST /api/v1/ai/chat detects budget-status intent and grounds the reply in real data', async function () {
  env.GEMINI_CHAT_API_KEY = 'server-chat-key';

  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from budgets b') && sql.includes('left join lateral')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], '2026-06-01');

      return {
        rowCount: 1,
        rows: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            userId: userA,
            ledgerId,
            categoryId: expenseCategoryId,
            categoryName: 'An uong',
            month: '2026-06-01',
            limitAmountVnd: '2000000',
            warningThreshold: 80,
            spentAmountVnd: '1500000',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });
  const fetchCalls = [];

  global.fetch = async function fakeFetch(url, options) {
    fetchCalls.push({ url, options });

    return {
      ok: true,
      async json() {
        return {
          candidates: [
            { content: { parts: [{ text: 'Ban con 500000 VND cho danh muc An uong.' }] } },
          ],
        };
      },
    };
  };

  const res = await request('/api/v1/ai/chat', {
    method: 'POST',
    body: {
      ledgerId,
      message: 'ngan sach thang nay cua toi the nao',
      currentDate: '2026-06-15',
      saveHistory: false,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.toolName, 'getBudgetStatus');
  assert.equal(res.body.data.toolResult.budgets[0].spentAmountVnd, 1500000);
  assert.ok(queries.some((query) => query.sql.includes('from budgets b')));
  assert.equal(fetchCalls.length, 1);
});

test('POST /api/v1/ai/chat detects transaction-history intent and grounds the reply in real data', async function () {
  env.GEMINI_CHAT_API_KEY = 'server-chat-key';

  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from transactions t') && sql.includes('select count(*)')) {
      return { rowCount: 1, rows: [{ count: 1 }] };
    }

    if (sql.includes('from transactions t')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return {
        rowCount: 1,
        rows: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            userId: userA,
            ledgerId,
            type: 'expense',
            amountVnd: '50000',
            categoryId: expenseCategoryId,
            categoryNameSnapshot: 'An uong',
            subcategoryId: null,
            subcategoryNameSnapshot: null,
            transactionDate: '2026-06-15',
            note: 'An trua',
            paymentMethod: 'cash',
            paymentAccountId: null,
            receiptImageUrl: null,
            source: 'manual',
            clientMutationId: null,
            createdAt: '2026-06-15T00:00:00.000Z',
            updatedAt: '2026-06-15T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });
  const fetchCalls = [];

  global.fetch = async function fakeFetch(url, options) {
    fetchCalls.push({ url, options });

    return {
      ok: true,
      async json() {
        return {
          candidates: [
            { content: { parts: [{ text: 'Hom nay ban co 1 giao dich an trua 50000 VND.' }] } },
          ],
        };
      },
    };
  };

  const res = await request('/api/v1/ai/chat', {
    method: 'POST',
    body: {
      ledgerId,
      message: 'giao dich hom nay cua toi',
      currentDate: '2026-06-15',
      saveHistory: false,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.toolName, 'getTransactionsByDateRange');
  assert.equal(res.body.data.toolResult.transactions.length, 1);
  assert.ok(queries.some((query) => query.sql.includes('from transactions t')));
  assert.equal(fetchCalls.length, 1);
});

test('POST /api/v1/ai/chat saves conversation history by default', async function () {
  env.GEMINI_CHAT_API_KEY = 'server-chat-key';

  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    const saveResult = handleSaveHistoryQuery(sql, params);

    if (saveResult) return saveResult;

    throw new Error(`Unexpected query: ${sql}`);
  });

  global.fetch = async function fakeFetch(url, options) {
    assert.equal(options.headers['x-goog-api-key'], 'server-chat-key');

    return {
      ok: true,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [{ text: 'Xin chao, minh co the giup gi?' }],
              },
            },
          ],
        };
      },
    };
  };

  const res = await request('/api/v1/ai/chat', {
    method: 'POST',
    body: {
      ledgerId,
      message: 'xin chao',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.conversation.id, savedConversationId);
  assert.ok(queries.some((query) => query.sql.includes('insert into ai_conversations')));
  assert.equal(
    queries.filter((query) => query.sql.includes('insert into ai_messages')).length,
    2
  );
});

test('POST /api/v1/ai/execute-action rolls back bulk delete when any id is missing', async function () {
  installQueryHandler(async function handleQuery(sql) {
    throw new Error(`Unexpected query: ${sql}`);
  });

  const clientQueries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      clientQueries.push({ sql: normalized, params });

      if (normalized === 'begin' || normalized === 'rollback') {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.includes('from transactions') && normalized.includes('for update')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: '77777777-7777-4777-8777-777777777777',
              userId: userA,
              ledgerId,
              type: 'expense',
              amountVnd: '30000',
              categoryId: expenseCategoryId,
              subcategoryId: null,
              categoryNameSnapshot: 'An uong',
              subcategoryNameSnapshot: null,
              transactionDate: '2026-06-01',
              note: 'Breakfast',
              paymentMethod: 'cash',
              paymentAccountId: null,
              receiptImageUrl: null,
              source: 'ai',
              clientMutationId: null,
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

  const res = await request('/api/v1/ai/execute-action', {
    method: 'POST',
    body: {
      action: 'deleteMultipleTransactions',
      payload: {
        transactionIds: [
          '77777777-7777-4777-8777-777777777777',
          '88888888-8888-4888-8888-888888888888',
        ],
        confirmed: true,
      },
    },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'TRANSACTION_NOT_FOUND');
  assert.ok(clientQueries.some((query) => query.sql === 'rollback'));
  assert.ok(!clientQueries.some((query) => query.sql.includes('update transactions')));
});

test('POST /api/v1/ai/chat includes recent conversation history in Gemini prompt', async function () {
  env.GEMINI_CHAT_API_KEY = 'server-chat-key';

  const conversationId = '99999999-9999-4999-8999-999999999999';
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from ai_conversations')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], conversationId);

      return {
        rowCount: 1,
        rows: [
          {
            id: conversationId,
            userId: userA,
            ledgerId,
            title: 'Last chat',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    if (sql.includes('from ai_messages')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], conversationId);

      return {
        rowCount: 2,
        rows: [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            conversationId,
            userId: userA,
            role: 'assistant',
            content: 'Ban da tieu 30000 VND hom qua.',
            functionName: null,
            functionPayload: null,
            createdAt: '2026-06-01T00:01:00.000Z',
          },
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            conversationId,
            userId: userA,
            role: 'user',
            content: 'Hom qua toi tieu bao nhieu?',
            functionName: null,
            functionPayload: null,
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });
  const fetchCalls = [];

  global.fetch = async function fakeFetch(url, options) {
    fetchCalls.push({ url, options });
    assert.ok(options.body.includes('Lich su hoi thoai gan day'));
    assert.ok(options.body.includes('Hom qua toi tieu bao nhieu?'));
    assert.ok(options.body.includes('Ban da tieu 30000 VND hom qua.'));

    return {
      ok: true,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [{ text: 'Minh da xem lai lich su.' }],
              },
            },
          ],
        };
      },
    };
  };

  const res = await request('/api/v1/ai/chat', {
    method: 'POST',
    body: {
      ledgerId,
      conversationId,
      message: 'Nhac lai giup toi',
      saveHistory: false,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.message, 'Minh da xem lai lich su.');
  assert.equal(fetchCalls.length, 1);
  assert.ok(queries.some((query) => query.sql.includes('from ai_messages')));
});

test('POST /api/v1/ai/chat rejects conversation ledger mismatch', async function () {
  env.GEMINI_CHAT_API_KEY = 'server-chat-key';

  const conversationId = '99999999-9999-4999-8999-999999999999';
  const otherLedgerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  installQueryHandler(async function handleQuery(sql) {
    if (sql.includes('from ledgers')) {
      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from ai_conversations')) {
      return {
        rowCount: 1,
        rows: [
          {
            id: conversationId,
            userId: userA,
            ledgerId: otherLedgerId,
            title: 'Other ledger',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const res = await request('/api/v1/ai/chat', {
    method: 'POST',
    body: {
      ledgerId,
      conversationId,
      message: 'Nhac lai giup toi',
    },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'AI_CONVERSATION_LEDGER_MISMATCH');
});

test('POST /api/v1/ai/receipt-scan validates Gemini receipt JSON and returns preview', async function () {
  env.GEMINI_RECEIPT_API_KEY = 'server-receipt-key';

  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    return handleCategoryQuery(sql, params);
  });

  global.fetch = async function fakeFetch(url, options) {
    assert.equal(options.headers['x-goog-api-key'], 'server-receipt-key');

    return {
      ok: true,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      merchantName: 'Cafe Test',
                      description: 'Cafe Test - Latte',
                      transactionDate: '2026-06-01',
                      totalAmountVnd: 45000,
                      categoryName: 'An uong',
                      paymentMethod: 'cash',
                      items: [{ name: 'Latte', quantity: 1, amountVnd: 45000 }],
                      suggestedNote: 'Cafe Test - Latte',
                      confidence: 0.93,
                    }),
                  },
                ],
              },
            },
          ],
        };
      },
    };
  };

  const res = await request('/api/v1/ai/receipt-scan', {
    method: 'POST',
    body: {
      ledgerId,
      imageBase64: Buffer.from('fake-image').toString('base64'),
      mimeType: 'image/png',
      currentDate: '2026-06-02',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.receipt.merchantName, 'Cafe Test');
  assert.equal(res.body.data.receipt.totalAmountVnd, 45000);
  assert.equal(res.body.data.receipt.items[0].amountVnd, 45000);
  assert.equal(res.body.data.legacy.amount, 45000);
  assert.equal(res.body.data.legacy.description, 'Cafe Test - Latte');
  assert.equal(res.body.data.transactionPreview.amountVnd, 45000);
  assert.equal(res.body.data.transactionPreview.categoryId, expenseCategoryId);
  assert.equal(res.body.data.transactionPreview.source, 'receipt_scan');
  assert.deepEqual(res.body.data.missingFields, []);
});

test('POST /api/v1/ai/chat returns timeout error when Gemini hangs', async function () {
  env.GEMINI_TIMEOUT_MS = 1;
  env.GEMINI_CHAT_API_KEY = 'server-chat-key';

  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userA);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  global.fetch = async function hangingFetch(url, options) {
    return new Promise(function waitForAbort(resolve, reject) {
      options.signal.addEventListener('abort', function onAbort() {
        const err = new Error('aborted');

        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  const res = await request('/api/v1/ai/chat', {
    method: 'POST',
    body: {
      ledgerId,
      message: 'xin chao',
    },
  });

  assert.equal(res.statusCode, 504);
  assert.equal(res.body.error.code, 'GEMINI_REQUEST_TIMEOUT');
});
