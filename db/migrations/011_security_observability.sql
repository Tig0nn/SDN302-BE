create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete set null,
  event_type text not null,
  request_id text,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_event_type_check check (length(trim(event_type)) > 0)
);

create index if not exists audit_events_actor_created_idx
  on audit_events(actor_user_id, created_at desc);

create index if not exists audit_events_event_type_created_idx
  on audit_events(event_type, created_at desc);
