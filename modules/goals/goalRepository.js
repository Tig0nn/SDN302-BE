const db = require('../../config/db');
const notificationRepository = require('../notifications/notificationRepository');

const GOAL_FIELDS = `
  id,
  user_id as "userId",
  ledger_id as "ledgerId",
  name,
  target_amount_vnd as "targetAmountVnd",
  current_amount_vnd as "currentAmountVnd",
  deadline::text as deadline,
  icon,
  color,
  status,
  completed_at as "completedAt",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function appError(code, message, status) {
  const err = new Error(message);

  err.code = code;
  err.status = status;
  return err;
}

function notFoundError() {
  return appError('GOAL_NOT_FOUND', 'Goal not found', 404);
}

function invalidLedgerError() {
  return appError('INVALID_LEDGER', 'Ledger not found', 400);
}

function cancelledGoalError() {
  return appError('GOAL_CANCELLED', 'Cancelled goals cannot receive deposits', 409);
}

function getExecutor(client) {
  return client || db;
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function mapGoal(row) {
  if (!row) return null;

  return {
    ...row,
    targetAmountVnd: Number(row.targetAmountVnd),
    currentAmountVnd: Number(row.currentAmountVnd),
    deadline: row.deadline || null,
  };
}

async function assertLedger(userId, ledgerId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select id
      from ledgers
      where user_id = $1
        and id = $2
        and deleted_at is null
      limit 1
    `,
    [userId, ledgerId]
  );

  if (result.rowCount === 0) {
    throw invalidLedgerError();
  }
}

function resolveStatus(currentAmountVnd, targetAmountVnd, requestedStatus) {
  if (requestedStatus === 'cancelled') return 'cancelled';
  if (requestedStatus === 'completed') return 'completed';
  if (currentAmountVnd >= targetAmountVnd) return 'completed';

  return 'active';
}

async function createCompletionNotification(userId, goal, client) {
  const executor = getExecutor(client);

  const result = await executor.query(
    `
      insert into notification_events (
        user_id,
        type,
        title,
        body,
        payload,
        event_key
      )
      select
        $1,
        'goal_completed',
        'Goal completed',
        'Your saving goal has been completed.',
        jsonb_build_object(
          'goalId', $2::uuid,
          'ledgerId', $3::uuid,
          'name', $4::text,
          'targetAmountVnd', $5::bigint,
          'currentAmountVnd', $6::bigint
        ),
        'goal_completed:' || $2::text
      on conflict (user_id, event_key) where event_key is not null do nothing
      returning ${notificationRepository.NOTIFICATION_FIELDS}
    `,
    [
      userId,
      goal.id,
      goal.ledgerId,
      goal.name,
      goal.targetAmountVnd,
      goal.currentAmountVnd,
    ]
  );

  if (!client) {
    await notificationRepository.sendEvents(result.rows);
  }
}

async function listGoals(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const result = await db.query(
    `
      select ${GOAL_FIELDS}
      from goals
      where user_id = $1
        and ledger_id = $2
        and deleted_at is null
        and ($3::text is null or status = $3)
      order by
        case status
          when 'active' then 1
          when 'completed' then 2
          else 3
        end,
        deadline nulls last,
        created_at desc
    `,
    [userId, filters.ledgerId, filters.status || null]
  );

  return result.rows.map(mapGoal);
}

async function createGoal(userId, payload) {
  await assertLedger(userId, payload.ledgerId);

  const currentAmountVnd = payload.currentAmountVnd || 0;
  const status = resolveStatus(currentAmountVnd, payload.targetAmountVnd);
  const result = await db.query(
    `
      insert into goals (
        user_id,
        ledger_id,
        name,
        target_amount_vnd,
        current_amount_vnd,
        deadline,
        icon,
        color,
        status,
        completed_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        case when $9 = 'completed' then now() else null end
      )
      returning ${GOAL_FIELDS}
    `,
    [
      userId,
      payload.ledgerId,
      payload.name,
      payload.targetAmountVnd,
      currentAmountVnd,
      payload.deadline || null,
      payload.icon || null,
      payload.color || null,
      status,
    ]
  );

  const goal = mapGoal(result.rows[0]);

  if (goal.status === 'completed') {
    await createCompletionNotification(userId, goal);
  }

  return goal;
}

async function updateGoal(userId, goalId, payload) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const existingResult = await client.query(
      `
        select ${GOAL_FIELDS}
        from goals
        where user_id = $1
          and id = $2
          and deleted_at is null
        for update
      `,
      [userId, goalId]
    );

    if (existingResult.rowCount === 0) {
      throw notFoundError();
    }

    const existing = mapGoal(existingResult.rows[0]);

    if (payload.ledgerId && payload.ledgerId !== existing.ledgerId) {
      await assertLedger(userId, payload.ledgerId, client);
    }

    const nextLedgerId = payload.ledgerId || existing.ledgerId;
    const nextTarget = hasOwn(payload, 'targetAmountVnd')
      ? payload.targetAmountVnd
      : existing.targetAmountVnd;
    const nextCurrent = hasOwn(payload, 'currentAmountVnd')
      ? payload.currentAmountVnd
      : existing.currentAmountVnd;
    const nextStatus = resolveStatus(nextCurrent, nextTarget, payload.status);

    const updatedResult = await client.query(
      `
        update goals
        set ledger_id = $3,
            name = coalesce($4, name),
            target_amount_vnd = $5,
            current_amount_vnd = $6,
            deadline = case when $7 then $8::date else deadline end,
            icon = case when $9 then $10 else icon end,
            color = case when $11 then $12 else color end,
            status = $13,
            completed_at = case
              when $13 = 'completed' and completed_at is null then now()
              when $13 <> 'completed' then null
              else completed_at
            end
        where user_id = $1
          and id = $2
          and deleted_at is null
        returning ${GOAL_FIELDS}
      `,
      [
        userId,
        goalId,
        nextLedgerId,
        payload.name || null,
        nextTarget,
        nextCurrent,
        hasOwn(payload, 'deadline'),
        payload.deadline || null,
        hasOwn(payload, 'icon'),
        payload.icon || null,
        hasOwn(payload, 'color'),
        payload.color || null,
        nextStatus,
      ]
    );

    const goal = mapGoal(updatedResult.rows[0]);

    if (existing.status !== 'completed' && goal.status === 'completed') {
      await createCompletionNotification(userId, goal, client);
    }

    await client.query('commit');
    return goal;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function depositGoal(userId, goalId, payload) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const existingResult = await client.query(
      `
        select ${GOAL_FIELDS}
        from goals
        where user_id = $1
          and id = $2
          and deleted_at is null
        for update
      `,
      [userId, goalId]
    );

    if (existingResult.rowCount === 0) {
      throw notFoundError();
    }

    const existing = mapGoal(existingResult.rows[0]);

    if (existing.status === 'cancelled') {
      throw cancelledGoalError();
    }

    const nextCurrent = existing.currentAmountVnd + payload.amountVnd;
    const nextStatus = resolveStatus(nextCurrent, existing.targetAmountVnd);
    const updatedResult = await client.query(
      `
        update goals
        set current_amount_vnd = $3,
            status = $4,
            completed_at = case
              when $4 = 'completed' and completed_at is null then now()
              else completed_at
            end
        where user_id = $1
          and id = $2
          and deleted_at is null
        returning ${GOAL_FIELDS}
      `,
      [userId, goalId, nextCurrent, nextStatus]
    );

    const goal = mapGoal(updatedResult.rows[0]);

    if (existing.status !== 'completed' && goal.status === 'completed') {
      await createCompletionNotification(userId, goal, client);
    }

    await client.query('commit');
    return goal;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteGoal(userId, goalId) {
  const result = await db.query(
    `
      update goals
      set deleted_at = now(),
          status = 'cancelled'
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning ${GOAL_FIELDS}
    `,
    [userId, goalId]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  return mapGoal(result.rows[0]);
}

module.exports = {
  createGoal,
  deleteGoal,
  depositGoal,
  listGoals,
  updateGoal,
};
