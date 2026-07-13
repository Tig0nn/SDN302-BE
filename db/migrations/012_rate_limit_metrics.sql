create table if not exists rate_limit_buckets (
  key text not null,
  scope text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  constraint rate_limit_buckets_pkey primary key (key, scope)
);

create table if not exists request_metrics (
  id bigserial primary key,
  method text not null,
  route text not null,
  status_code integer not null,
  duration_ms numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists request_metrics_created_at_idx
  on request_metrics(created_at);
