const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const aiRepository = require('../modules/ai/aiRepository');

const originalQuery = db.query;

const userId = '11111111-1111-4111-8111-111111111111';
const ledgerId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const messageId = '44444444-4444-4444-8444-444444444444';

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function conversation(overrides = {}) {
  return {
    id: conversationId,
    userId,
    ledgerId,
    title: 'Travel assistant',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function message(overrides = {}) {
  return {
    id: messageId,
    conversationId,
    userId,
    role: 'assistant',
    content: 'Done',
    functionName: null,
    functionPayload: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function installQueryHandler(handler) {
  const queries = [];

  db.query = async function fakeQuery(sql, params = []) {
    const normalized = normalizeSql(sql);

    queries.push({ sql: normalized, params });
    return handler(normalized, params);
  };

  return queries;
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
});

test('AI repository asserts ledgers and conversations', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('from ai_conversations')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], conversationId);

      return { rowCount: 1, rows: [conversation()] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  await aiRepository.assertLedger(userId, ledgerId);
  const found = await aiRepository.assertConversation(userId, conversationId);

  assert.equal(found.id, conversationId);
});

test('AI repository throws typed errors for missing ledger and conversation', async function () {
  installQueryHandler(async function handleQuery(sql) {
    if (sql.includes('from ledgers') || sql.includes('from ai_conversations')) {
      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  await assert.rejects(() => aiRepository.assertLedger(userId, ledgerId), {
    code: 'INVALID_LEDGER',
    status: 400,
  });
  await assert.rejects(() => aiRepository.assertConversation(userId, conversationId), {
    code: 'AI_CONVERSATION_NOT_FOUND',
    status: 404,
  });
});

test('AI repository creates or reuses conversations and appends messages', async function () {
  const queries = installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('insert into ai_conversations')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'Travel assistant');

      return {
        rowCount: 1,
        rows: [conversation()],
      };
    }

    if (sql.includes('from ai_conversations')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], conversationId);

      return {
        rowCount: 1,
        rows: [conversation()],
      };
    }

    if (sql.includes('insert into ai_messages')) {
      assert.equal(params[0], conversationId);
      assert.equal(params[1], userId);
      assert.equal(params[2], 'assistant');
      assert.equal(params[3], 'Created transaction');
      assert.equal(params[4], 'create_transaction');
      assert.equal(params[5], JSON.stringify({ id: 'tx-1' }));

      return {
        rowCount: 1,
        rows: [
          message({
            content: 'Created transaction',
            functionName: 'create_transaction',
            functionPayload: { id: 'tx-1' },
          }),
        ],
      };
    }

    if (sql.includes('update ai_conversations')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], conversationId);

      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const created = await aiRepository.getOrCreateConversation(userId, {
    ledgerId,
    title: 'Travel assistant',
  });
  const reused = await aiRepository.getOrCreateConversation(userId, {
    conversationId,
  });
  const appended = await aiRepository.addMessage(userId, {
    conversationId,
    role: 'assistant',
    content: 'Created transaction',
    functionName: 'create_transaction',
    functionPayload: { id: 'tx-1' },
  });

  assert.equal(created.id, conversationId);
  assert.equal(reused.id, conversationId);
  assert.equal(appended.functionName, 'create_transaction');
  assert.ok(queries.some((query) => query.sql.includes('update ai_conversations')));
});

test('AI repository lists conversations, full messages, and recent messages', async function () {
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ai_conversations')) {
      assert.equal(params[0], userId);

      return {
        rowCount: 1,
        rows: [conversation()],
      };
    }

    if (sql.includes('from ai_messages') && sql.includes('order by created_at asc')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], conversationId);

      return {
        rowCount: 2,
        rows: [
          message({ id: 'm1', role: 'user', content: 'Hi' }),
          message({ id: 'm2', role: 'assistant', content: 'Hello' }),
        ],
      };
    }

    if (sql.includes('from ai_messages') && sql.includes('order by created_at desc')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], conversationId);
      assert.equal(params[2], 2);

      return {
        rowCount: 2,
        rows: [
          message({ id: 'new', content: 'new' }),
          message({ id: 'old', content: 'old' }),
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const conversations = await aiRepository.listConversations(userId);
  const messages = await aiRepository.listMessages(userId, conversationId);
  const recent = await aiRepository.listRecentMessages(userId, conversationId, 2);

  assert.equal(conversations[0].id, conversationId);
  assert.equal(messages.length, 2);
  assert.deepEqual(
    recent.map((row) => row.id),
    ['old', 'new']
  );
});
