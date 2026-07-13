alter table notification_events
  add column if not exists event_key text;

create unique index if not exists notification_events_user_event_key_unique_idx
  on notification_events(user_id, event_key)
  where event_key is not null;

create index if not exists notification_events_user_unread_idx
  on notification_events(user_id, created_at desc)
  where read_at is null;

create index if not exists notification_events_pending_send_idx
  on notification_events(sent_at, created_at)
  where sent_at is null;

create index if not exists device_tokens_active_user_idx
  on device_tokens(user_id, updated_at desc)
  where is_active = true;
