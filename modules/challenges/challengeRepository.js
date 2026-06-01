const db = require('../../config/db');

const CHALLENGE_FIELDS = `
  id,
  user_id as "userId",
  ledger_id as "ledgerId",
  name,
  target_amount_vnd as "targetAmountVnd",
  start_date::text as "startDate",
  end_date::text as "endDate",
  current_amount_vnd as "currentAmountVnd",
  streak_days as "streakDays",
  status,
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

const CHECKIN_FIELDS = `
  id,
  user_id as "userId",
  challenge_id as "challengeId",
  checkin_date::text as "checkinDate",
  amount_vnd as "amountVnd",
  note,
  created_at as "createdAt"
`;

function appError(code, message, status) {
  const err = new Error(message);

  err.code = code;
  err.status = status;
  return err;
}

function notFoundError() {
  return appError('CHALLENGE_NOT_FOUND', 'Challenge not found', 404);
}

function invalidLedgerError() {
  return appError('INVALID_LEDGER', 'Ledger not found', 400);
}

function invalidDateError(message) {
  return appError('INVALID_CHALLENGE_DATE', message, 400);
}

function inactiveChallengeError() {
  return appError(
    'CHALLENGE_INACTIVE',
    'Cancelled challenges cannot receive check-ins',
    409
  );
}

function getExecutor(client) {
  return client || db;
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function mapChallenge(row) {
  if (!row) return null;

  return {
    ...row,
    targetAmountVnd:
      row.targetAmountVnd === null || row.targetAmountVnd === undefined
        ? null
        : Number(row.targetAmountVnd),
    currentAmountVnd: Number(row.currentAmountVnd),
    streakDays: Number(row.streakDays),
  };
}

function mapCheckin(row) {
  if (!row) return null;

  return {
    ...row,
    amountVnd: Number(row.amountVnd),
    note: row.note || null,
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

function assertDateRange(startDate, endDate) {
  if (endDate < startDate) {
    throw invalidDateError('Challenge end date must be on or after start date');
  }
}

function assertCheckinInRange(challenge, checkinDate) {
  if (checkinDate < challenge.startDate || checkinDate > challenge.endDate) {
    throw invalidDateError('Check-in date must be inside challenge date range');
  }
}

function resolveStatus(currentAmountVnd, targetAmountVnd, requestedStatus) {
  if (requestedStatus === 'cancelled') return 'cancelled';
  if (requestedStatus === 'completed') return 'completed';
  if (targetAmountVnd && currentAmountVnd >= targetAmountVnd) return 'completed';

  return 'active';
}

async function getChallenge(userId, challengeId, client) {
  const executor = getExecutor(client);
  const result = await executor.query(
    `
      select ${CHALLENGE_FIELDS}
      from challenges
      where user_id = $1
        and id = $2
        and deleted_at is null
      limit 1
    `,
    [userId, challengeId]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  return mapChallenge(result.rows[0]);
}

async function listChallenges(userId, filters) {
  await assertLedger(userId, filters.ledgerId);

  const result = await db.query(
    `
      select ${CHALLENGE_FIELDS}
      from challenges
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
        start_date desc,
        created_at desc
    `,
    [userId, filters.ledgerId, filters.status || null]
  );

  return result.rows.map(mapChallenge);
}

async function createChallenge(userId, payload) {
  await assertLedger(userId, payload.ledgerId);
  assertDateRange(payload.startDate, payload.endDate);

  const result = await db.query(
    `
      insert into challenges (
        user_id,
        ledger_id,
        name,
        target_amount_vnd,
        start_date,
        end_date,
        status
      )
      values ($1, $2, $3, $4, $5, $6, 'active')
      returning ${CHALLENGE_FIELDS}
    `,
    [
      userId,
      payload.ledgerId,
      payload.name,
      payload.targetAmountVnd || null,
      payload.startDate,
      payload.endDate,
    ]
  );

  return mapChallenge(result.rows[0]);
}

async function updateChallenge(userId, challengeId, payload) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const existingResult = await client.query(
      `
        select ${CHALLENGE_FIELDS}
        from challenges
        where user_id = $1
          and id = $2
          and deleted_at is null
        for update
      `,
      [userId, challengeId]
    );

    if (existingResult.rowCount === 0) {
      throw notFoundError();
    }

    const existing = mapChallenge(existingResult.rows[0]);

    if (payload.ledgerId && payload.ledgerId !== existing.ledgerId) {
      await assertLedger(userId, payload.ledgerId, client);
    }

    const nextStartDate = payload.startDate || existing.startDate;
    const nextEndDate = payload.endDate || existing.endDate;
    const nextTarget = hasOwn(payload, 'targetAmountVnd')
      ? payload.targetAmountVnd
      : existing.targetAmountVnd;

    assertDateRange(nextStartDate, nextEndDate);

    const nextStatus = resolveStatus(
      existing.currentAmountVnd,
      nextTarget,
      payload.status
    );

    const updatedResult = await client.query(
      `
        update challenges
        set ledger_id = $3,
            name = coalesce($4, name),
            target_amount_vnd = $5,
            start_date = $6,
            end_date = $7,
            status = $8
        where user_id = $1
          and id = $2
          and deleted_at is null
        returning ${CHALLENGE_FIELDS}
      `,
      [
        userId,
        challengeId,
        payload.ledgerId || existing.ledgerId,
        payload.name || null,
        nextTarget,
        nextStartDate,
        nextEndDate,
        nextStatus,
      ]
    );

    await client.query('commit');
    return mapChallenge(updatedResult.rows[0]);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function refreshChallengeProgress(userId, challengeId, client) {
  const result = await client.query(
    `
      with totals as (
        select coalesce(sum(amount_vnd), 0) as current_amount_vnd
        from challenge_checkins
        where user_id = $1
          and challenge_id = $2
      ),
      ordered_checkins as (
        select
          checkin_date,
          checkin_date - (row_number() over (order by checkin_date))::int as streak_group
        from challenge_checkins
        where user_id = $1
          and challenge_id = $2
      ),
      latest_group as (
        select streak_group
        from ordered_checkins
        order by checkin_date desc
        limit 1
      ),
      streak as (
        select count(*)::int as streak_days
        from ordered_checkins
        where streak_group = (select streak_group from latest_group)
      )
      update challenges c
      set current_amount_vnd = totals.current_amount_vnd,
          streak_days = coalesce((select streak_days from streak), 0),
          status = case
            when c.status = 'cancelled' then 'cancelled'
            when c.target_amount_vnd is not null
              and totals.current_amount_vnd >= c.target_amount_vnd
              then 'completed'
            else 'active'
          end
      from totals
      where c.user_id = $1
        and c.id = $2
        and c.deleted_at is null
      returning ${CHALLENGE_FIELDS}
    `,
    [userId, challengeId]
  );

  return mapChallenge(result.rows[0]);
}

async function checkInChallenge(userId, challengeId, payload) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const challengeResult = await client.query(
      `
        select ${CHALLENGE_FIELDS}
        from challenges
        where user_id = $1
          and id = $2
          and deleted_at is null
        for update
      `,
      [userId, challengeId]
    );

    if (challengeResult.rowCount === 0) {
      throw notFoundError();
    }

    const challenge = mapChallenge(challengeResult.rows[0]);

    if (challenge.status === 'cancelled') {
      throw inactiveChallengeError();
    }

    assertCheckinInRange(challenge, payload.checkinDate);

    const existingCheckin = await client.query(
      `
        select ${CHECKIN_FIELDS}
        from challenge_checkins
        where user_id = $1
          and challenge_id = $2
          and checkin_date = $3::date
        limit 1
      `,
      [userId, challengeId, payload.checkinDate]
    );

    if (existingCheckin.rowCount > 0) {
      await client.query('commit');
      return {
        challenge,
        checkin: mapCheckin(existingCheckin.rows[0]),
        idempotent: true,
      };
    }

    const checkinResult = await client.query(
      `
        insert into challenge_checkins (
          user_id,
          challenge_id,
          checkin_date,
          amount_vnd,
          note
        )
        values ($1, $2, $3, $4, $5)
        returning ${CHECKIN_FIELDS}
      `,
      [
        userId,
        challengeId,
        payload.checkinDate,
        payload.amountVnd || 0,
        payload.note || null,
      ]
    );

    const updatedChallenge = await refreshChallengeProgress(
      userId,
      challengeId,
      client
    );

    await client.query('commit');
    return {
      challenge: updatedChallenge,
      checkin: mapCheckin(checkinResult.rows[0]),
      idempotent: false,
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteChallenge(userId, challengeId) {
  const result = await db.query(
    `
      update challenges
      set deleted_at = now(),
          status = 'cancelled'
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning ${CHALLENGE_FIELDS}
    `,
    [userId, challengeId]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  return mapChallenge(result.rows[0]);
}

module.exports = {
  checkInChallenge,
  createChallenge,
  deleteChallenge,
  getChallenge,
  listChallenges,
  updateChallenge,
};
