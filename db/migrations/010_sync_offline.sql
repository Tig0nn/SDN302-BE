alter table debt_payments
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

alter table challenge_checkins
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

alter table notification_events
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

drop trigger if exists debt_payments_set_updated_at on debt_payments;
create trigger debt_payments_set_updated_at
before update on debt_payments
for each row execute function set_updated_at();

drop trigger if exists challenge_checkins_set_updated_at on challenge_checkins;
create trigger challenge_checkins_set_updated_at
before update on challenge_checkins
for each row execute function set_updated_at();

drop trigger if exists notification_events_set_updated_at on notification_events;
create trigger notification_events_set_updated_at
before update on notification_events
for each row execute function set_updated_at();

create table if not exists sync_mutations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_mutation_id text not null,
  operation text not null,
  status text not null default 'processing',
  request_payload jsonb,
  response_payload jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_mutations_status_check check (
    status in ('processing', 'completed', 'failed')
  ),
  constraint sync_mutations_client_mutation_id_check check (
    length(trim(client_mutation_id)) > 0
  )
);

drop trigger if exists sync_mutations_set_updated_at on sync_mutations;
create trigger sync_mutations_set_updated_at
before update on sync_mutations
for each row execute function set_updated_at();

create unique index if not exists sync_mutations_user_client_unique_idx
  on sync_mutations(user_id, client_mutation_id);

create index if not exists sync_mutations_user_created_idx
  on sync_mutations(user_id, created_at desc);

create index if not exists ledgers_user_updated_idx
  on ledgers(user_id, updated_at);

create index if not exists categories_user_updated_idx
  on categories(user_id, updated_at);

create index if not exists payment_accounts_user_updated_idx
  on payment_accounts(user_id, updated_at);

create index if not exists transactions_user_updated_idx
  on transactions(user_id, updated_at);

create index if not exists budgets_user_updated_idx
  on budgets(user_id, updated_at);

create index if not exists goals_user_updated_idx
  on goals(user_id, updated_at);

create index if not exists debts_user_updated_idx
  on debts(user_id, updated_at);

create index if not exists debt_payments_user_updated_idx
  on debt_payments(user_id, updated_at);

create index if not exists challenges_user_updated_idx
  on challenges(user_id, updated_at);

create index if not exists challenge_checkins_user_updated_idx
  on challenge_checkins(user_id, updated_at);

create index if not exists shopping_plans_user_updated_idx
  on shopping_plans(user_id, updated_at);

create index if not exists shopping_items_user_updated_idx
  on shopping_items(user_id, updated_at);

create index if not exists notification_events_user_updated_idx
  on notification_events(user_id, updated_at);
