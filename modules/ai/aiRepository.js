const db = require('../../config/db');

const CONVERSATION_FIELDS = `
  id,
  user_id as "userId",
  ledger_id as "ledgerId",
  title,
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

const MESSAGE_FIELDS = `
  id,
  conversation_id as "conversationId",
  user_id as "userId",
  role,
  content,
  function_name as "functionName",
  function_payload as "functionPayload",
  created_at as "createdAt"
`;

function notFoundError() {
  const err = new Error('AI conversation not found');

  err.code = 'AI_CONVERSATION_NOT_FOUND';
  err.status = 404;
  return err;
}

function getExecutor(client) {
  return client || db;
}

async function assertConversation(userId, conversationId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select ${CONVERSATION_FIELDS}
      from ai_conversations
      where user_id = $1
        and id = $2
        and deleted_at is null
      limit 1
    `,
    [userId, conversationId]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  return result.rows[0];
}

async function createConversation(userId, payload, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      insert into ai_conversations (
        user_id,
        ledger_id,
        title
      )
      values ($1, $2, $3)
      returning ${CONVERSATION_FIELDS}
    `,
    [userId, payload.ledgerId || null, payload.title || null]
  );

  return result.rows[0];
}

async function getOrCreateConversation(userId, payload, client) {
  if (payload.conversationId) {
    return assertConversation(userId, payload.conversationId, client);
  }

  return createConversation(userId, payload, client);
}

async function addMessage(userId, payload, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      insert into ai_messages (
        conversation_id,
        user_id,
        role,
        content,
        function_name,
        function_payload
      )
      values ($1, $2, $3, $4, $5, $6)
      returning ${MESSAGE_FIELDS}
    `,
    [
      payload.conversationId,
      userId,
      payload.role,
      payload.content || null,
      payload.functionName || null,
      payload.functionPayload ? JSON.stringify(payload.functionPayload) : null,
    ]
  );

  return result.rows[0];
}

async function listConversations(userId) {
  const result = await db.query(
    `
      select ${CONVERSATION_FIELDS}
      from ai_conversations
      where user_id = $1
        and deleted_at is null
      order by updated_at desc, created_at desc
      limit 50
    `,
    [userId]
  );

  return result.rows;
}

async function listMessages(userId, conversationId) {
  await assertConversation(userId, conversationId);

  const result = await db.query(
    `
      select ${MESSAGE_FIELDS}
      from ai_messages
      where user_id = $1
        and conversation_id = $2
      order by created_at asc
      limit 200
    `,
    [userId, conversationId]
  );

  return result.rows;
}

module.exports = {
  addMessage,
  createConversation,
  getOrCreateConversation,
  listConversations,
  listMessages,
};
