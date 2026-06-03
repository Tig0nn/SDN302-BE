const db = require('../../config/db');
const { redact } = require('../../utils/redact');

async function createAuditEvent(event) {
  const metadata = redact(event.metadata || {});

  await db.query(
    `
      insert into audit_events (
        actor_user_id,
        event_type,
        request_id,
        ip_address,
        user_agent,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      event.userId || null,
      event.eventType,
      event.requestId || null,
      event.ipAddress || null,
      event.userAgent || null,
      JSON.stringify(metadata),
    ]
  );
}

function recordAuditEvent(req, eventType, metadata = {}, userId) {
  return createAuditEvent({
    userId: userId || req.user?.id || null,
    eventType,
    requestId: req.requestId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null,
    metadata,
  }).catch(() => {});
}

module.exports = {
  createAuditEvent,
  recordAuditEvent,
};
