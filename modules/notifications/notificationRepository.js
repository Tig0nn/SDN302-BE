const db = require('../../config/db');
const pushService = require('./pushService');

const DEVICE_TOKEN_FIELDS = `
  id,
  user_id as "userId",
  platform,
  expo_push_token as "expoPushToken",
  is_active as "isActive",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

const NOTIFICATION_FIELDS = `
  id,
  user_id as "userId",
  type,
  title,
  body,
  payload,
  event_key as "eventKey",
  sent_at as "sentAt",
  read_at as "readAt",
  created_at as "createdAt"
`;

function appError(code, message, status) {
  const err = new Error(message);

  err.code = code;
  err.status = status;
  return err;
}

function notFoundError() {
  return appError('NOTIFICATION_NOT_FOUND', 'Notification not found', 404);
}

function deviceTokenNotFoundError() {
  return appError('DEVICE_TOKEN_NOT_FOUND', 'Device token not found', 404);
}

function mapJson(value) {
  if (!value || typeof value !== 'string') return value || null;

  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function mapNotification(row) {
  if (!row) return null;

  return {
    ...row,
    payload: mapJson(row.payload),
  };
}

async function registerDeviceToken(userId, payload) {
  const result = await db.query(
    `
      insert into device_tokens (
        user_id,
        platform,
        expo_push_token,
        is_active
      )
      values ($1, $2, $3, true)
      on conflict (expo_push_token)
      do update set
        user_id = excluded.user_id,
        platform = excluded.platform,
        is_active = true,
        updated_at = now()
      returning ${DEVICE_TOKEN_FIELDS}
    `,
    [userId, payload.platform, payload.expoPushToken]
  );

  return result.rows[0];
}

async function deactivateDeviceToken(userId, deviceTokenId) {
  const result = await db.query(
    `
      update device_tokens
      set is_active = false
      where user_id = $1
        and id = $2
      returning ${DEVICE_TOKEN_FIELDS}
    `,
    [userId, deviceTokenId]
  );

  if (result.rowCount === 0) {
    throw deviceTokenNotFoundError();
  }

  return result.rows[0];
}

async function listNotifications(userId, filters) {
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 20;
  const unreadOnly = Boolean(filters.unreadOnly);
  const offset = (page - 1) * pageSize;
  const params = [userId, unreadOnly, pageSize, offset];

  const [rows, count] = await Promise.all([
    db.query(
      `
        select ${NOTIFICATION_FIELDS}
        from notification_events
        where user_id = $1
          and ($2::boolean = false or read_at is null)
        order by created_at desc
        limit $3
        offset $4
      `,
      params
    ),
    db.query(
      `
        select count(*)::int as count
        from notification_events
        where user_id = $1
          and ($2::boolean = false or read_at is null)
      `,
      [userId, unreadOnly]
    ),
  ]);

  return {
    notifications: rows.rows.map(mapNotification),
    pagination: {
      page,
      pageSize,
      total: count.rows[0].count,
      totalPages: Math.ceil(count.rows[0].count / pageSize),
    },
  };
}

async function markNotificationRead(userId, notificationId) {
  const result = await db.query(
    `
      update notification_events
      set read_at = coalesce(read_at, now())
      where user_id = $1
        and id = $2
      returning ${NOTIFICATION_FIELDS}
    `,
    [userId, notificationId]
  );

  if (result.rowCount === 0) {
    throw notFoundError();
  }

  return mapNotification(result.rows[0]);
}

async function listActiveTokens(userId) {
  const result = await db.query(
    `
      select ${DEVICE_TOKEN_FIELDS}
      from device_tokens
      where user_id = $1
        and is_active = true
      order by updated_at desc
    `,
    [userId]
  );

  return result.rows;
}

async function deactivateExpoPushTokens(expoPushTokens) {
  if (expoPushTokens.length === 0) return;

  await db.query(
    `
      update device_tokens
      set is_active = false
      where expo_push_token = any($1::text[])
    `,
    [expoPushTokens]
  );
}

async function markSent(notificationId) {
  await db.query(
    `
      update notification_events
      set sent_at = coalesce(sent_at, now())
      where id = $1
    `,
    [notificationId]
  );
}

async function sendEvents(events) {
  const notifications = events.map(mapNotification).filter(Boolean);

  for (const event of notifications) {
    const tokens = await listActiveTokens(event.userId);

    if (tokens.length === 0) {
      continue;
    }

    const result = await pushService.sendExpoNotification(tokens, event);

    await deactivateExpoPushTokens(result.inactiveTokens);

    if (result.attempted) {
      await markSent(event.id);
    }
  }
}

async function sendPendingNotificationEvents(limit = 100) {
  const result = await db.query(
    `
      select ${NOTIFICATION_FIELDS}
      from notification_events n
      left join user_settings s on s.user_id = n.user_id
      where n.sent_at is null
        and (
          n.type = 'goal_completed'
          or (n.type = 'daily_reminder' and s.daily_reminder_enabled = true)
          or (n.type = 'budget_threshold' and s.budget_warning_enabled = true)
          or (n.type in ('debt_due', 'debt_overdue') and s.debt_reminder_enabled = true)
        )
      order by n.created_at asc
      limit $1
    `,
    [limit]
  );

  await sendEvents(result.rows);

  return result.rows.map(mapNotification);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

async function createDailyReminderEvents(runDate = isoDate(new Date())) {
  const result = await db.query(
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
        u.id,
        'daily_reminder',
        'Nhac ghi chep chi tieu',
        'Dung quen cap nhat thu chi hom nay.',
        jsonb_build_object('date', $1::date),
        'daily_reminder:' || u.id::text || ':' || $1::text
      from users u
      join user_settings s on s.user_id = u.id
      where s.daily_reminder_enabled = true
      on conflict (user_id, event_key) where event_key is not null do nothing
      returning ${NOTIFICATION_FIELDS}
    `,
    [runDate]
  );

  await sendEvents(result.rows);
  return result.rows.map(mapNotification);
}

async function createBudgetThresholdEvents() {
  const result = await db.query(
    `
      with budget_status as (
        select
          b.id,
          b.user_id,
          b.ledger_id,
          b.category_id,
          b.month,
          b.limit_amount_vnd,
          b.warning_threshold,
          coalesce(spent.spent_amount_vnd, 0) as spent_amount_vnd
        from budgets b
        join user_settings s
          on s.user_id = b.user_id
         and s.budget_warning_enabled = true
        left join lateral (
          select sum(t.amount_vnd) as spent_amount_vnd
          from transactions t
          where t.user_id = b.user_id
            and t.ledger_id = b.ledger_id
            and t.deleted_at is null
            and t.type = 'expense'
            and t.transaction_date >= b.month
            and t.transaction_date < b.month + interval '1 month'
            and (
              b.category_id is null
              or t.category_id = b.category_id
              or t.subcategory_id = b.category_id
            )
        ) spent on true
        where b.deleted_at is null
      ),
      thresholds as (
        select distinct
          b.*,
          threshold
        from budget_status b
        cross join lateral (
          values (warning_threshold), (100)
        ) as threshold_values(threshold)
      )
      insert into notification_events (
        user_id,
        type,
        title,
        body,
        payload,
        event_key
      )
      select
        t.user_id,
        'budget_threshold',
        'Canh bao ngan sach',
        'Ngan sach cua ban da vuot nguong ' || t.threshold || '%',
        jsonb_build_object(
          'budgetId', t.id,
          'ledgerId', t.ledger_id,
          'categoryId', t.category_id,
          'month', to_char(t.month, 'YYYY-MM'),
          'threshold', t.threshold,
          'spentAmountVnd', t.spent_amount_vnd,
          'limitAmountVnd', t.limit_amount_vnd
        ),
        'budget_threshold:' || t.id::text || ':' || to_char(t.month, 'YYYY-MM') || ':' || t.threshold::text
      from thresholds t
      where t.spent_amount_vnd * 100 >= t.limit_amount_vnd * t.threshold
      on conflict (user_id, event_key) where event_key is not null do nothing
      returning ${NOTIFICATION_FIELDS}
    `
  );

  await sendEvents(result.rows);
  return result.rows.map(mapNotification);
}

async function createDebtReminderEvents(runDate = isoDate(new Date())) {
  await db.query(
    `
      update debts
      set status = 'overdue'
      where deleted_at is null
        and status = 'active'
        and remaining_amount_vnd > 0
        and due_date is not null
        and due_date < $1::date
    `,
    [runDate]
  );

  const due = await db.query(
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
        d.user_id,
        'debt_due',
        'Nhac han khoan no',
        'Hom nay den han khoan no voi ' || d.counterparty_name || '.',
        jsonb_build_object(
          'debtId', d.id,
          'ledgerId', d.ledger_id,
          'direction', d.direction,
          'counterpartyName', d.counterparty_name,
          'remainingAmountVnd', d.remaining_amount_vnd,
          'dueDate', d.due_date
        ),
        'debt_due:' || d.id::text || ':' || d.due_date::text
      from debts d
      join user_settings s
        on s.user_id = d.user_id
       and s.debt_reminder_enabled = true
      where d.deleted_at is null
        and d.remaining_amount_vnd > 0
        and d.due_date = $1::date
        and d.status in ('active', 'overdue')
      on conflict (user_id, event_key) where event_key is not null do nothing
      returning ${NOTIFICATION_FIELDS}
    `,
    [runDate]
  );
  const overdue = await db.query(
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
        d.user_id,
        'debt_overdue',
        'Khoan no qua han',
        'Khoan no voi ' || d.counterparty_name || ' da qua han.',
        jsonb_build_object(
          'debtId', d.id,
          'ledgerId', d.ledger_id,
          'direction', d.direction,
          'counterpartyName', d.counterparty_name,
          'remainingAmountVnd', d.remaining_amount_vnd,
          'dueDate', d.due_date
        ),
        'debt_overdue:' || d.id::text || ':' || d.due_date::text
      from debts d
      join user_settings s
        on s.user_id = d.user_id
       and s.debt_reminder_enabled = true
      where d.deleted_at is null
        and d.remaining_amount_vnd > 0
        and d.due_date < $1::date
        and d.status = 'overdue'
      on conflict (user_id, event_key) where event_key is not null do nothing
      returning ${NOTIFICATION_FIELDS}
    `,
    [runDate]
  );
  const events = [...due.rows, ...overdue.rows];

  await sendEvents(events);
  return events.map(mapNotification);
}

module.exports = {
  DEVICE_TOKEN_FIELDS,
  NOTIFICATION_FIELDS,
  createBudgetThresholdEvents,
  createDailyReminderEvents,
  createDebtReminderEvents,
  deactivateDeviceToken,
  listNotifications,
  markNotificationRead,
  registerDeviceToken,
  sendEvents,
  sendPendingNotificationEvents,
};
