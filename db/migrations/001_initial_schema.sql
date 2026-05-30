create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  google_sub text unique not null,
  email text unique not null,
  display_name text,
  avatar_url text,
  locale text not null default 'vi-VN',
  timezone text not null default 'Asia/Ho_Chi_Minh',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  refresh_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists user_settings (
  user_id uuid primary key references users(id) on delete cascade,
  theme text not null default 'system',
  daily_reminder_enabled boolean not null default false,
  budget_warning_enabled boolean not null default true,
  debt_reminder_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_theme_check check (theme in ('light', 'dark', 'system'))
);

create table if not exists ledgers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  type text not null,
  name text not null,
  parent_id uuid references categories(id) on delete restrict,
  icon text,
  color text,
  is_system boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint categories_type_check check (type in ('income', 'expense'))
);

create table if not exists payment_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  short_name text,
  type text not null,
  color text,
  is_system boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint payment_accounts_type_check check (
    type in ('cash', 'traditional_bank', 'digital_bank', 'e_wallet')
  )
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  ledger_id uuid not null references ledgers(id) on delete restrict,
  type text not null,
  amount_vnd bigint not null,
  category_id uuid references categories(id) on delete set null,
  subcategory_id uuid references categories(id) on delete set null,
  category_name_snapshot text not null,
  subcategory_name_snapshot text,
  transaction_date date not null,
  note text not null default '',
  payment_method text not null,
  payment_account_id uuid references payment_accounts(id) on delete set null,
  receipt_image_url text,
  source text not null default 'manual',
  client_mutation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint transactions_type_check check (type in ('income', 'expense')),
  constraint transactions_amount_check check (amount_vnd > 0),
  constraint transactions_payment_method_check check (payment_method in ('cash', 'transfer')),
  constraint transactions_source_check check (
    source in ('manual', 'ai', 'receipt_scan', 'import', 'shopping_plan')
  )
);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  ledger_id uuid not null references ledgers(id) on delete restrict,
  category_id uuid references categories(id) on delete set null,
  month date not null,
  limit_amount_vnd bigint not null,
  warning_threshold integer not null default 80,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint budgets_limit_check check (limit_amount_vnd > 0),
  constraint budgets_warning_threshold_check check (
    warning_threshold > 0 and warning_threshold <= 100
  )
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  ledger_id uuid not null references ledgers(id) on delete restrict,
  name text not null,
  target_amount_vnd bigint not null,
  current_amount_vnd bigint not null default 0,
  deadline date,
  icon text,
  color text,
  status text not null default 'active',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint goals_target_amount_check check (target_amount_vnd > 0),
  constraint goals_current_amount_check check (current_amount_vnd >= 0),
  constraint goals_status_check check (status in ('active', 'completed', 'cancelled'))
);

create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  ledger_id uuid not null references ledgers(id) on delete restrict,
  direction text not null,
  counterparty_name text not null,
  amount_vnd bigint not null,
  remaining_amount_vnd bigint not null,
  due_date date,
  note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint debts_direction_check check (direction in ('borrowed', 'lent')),
  constraint debts_amount_check check (amount_vnd > 0),
  constraint debts_remaining_amount_check check (remaining_amount_vnd >= 0),
  constraint debts_status_check check (status in ('active', 'paid', 'overdue', 'cancelled'))
);

create table if not exists debt_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  debt_id uuid not null references debts(id) on delete cascade,
  amount_vnd bigint not null,
  paid_at date not null,
  note text,
  created_at timestamptz not null default now(),
  constraint debt_payments_amount_check check (amount_vnd > 0)
);

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  ledger_id uuid not null references ledgers(id) on delete restrict,
  name text not null,
  target_amount_vnd bigint,
  start_date date not null,
  end_date date not null,
  current_amount_vnd bigint not null default 0,
  streak_days integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint challenges_target_amount_check check (
    target_amount_vnd is null or target_amount_vnd > 0
  ),
  constraint challenges_current_amount_check check (current_amount_vnd >= 0),
  constraint challenges_streak_days_check check (streak_days >= 0),
  constraint challenges_status_check check (status in ('active', 'completed', 'cancelled')),
  constraint challenges_date_range_check check (end_date >= start_date)
);

create table if not exists challenge_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  challenge_id uuid not null references challenges(id) on delete cascade,
  checkin_date date not null,
  amount_vnd bigint not null default 0,
  note text,
  created_at timestamptz not null default now(),
  constraint challenge_checkins_amount_check check (amount_vnd >= 0),
  constraint challenge_checkins_unique_day unique (challenge_id, checkin_date)
);

create table if not exists shopping_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  ledger_id uuid not null references ledgers(id) on delete restrict,
  name text not null,
  budget_amount_vnd bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint shopping_plans_budget_check check (budget_amount_vnd >= 0)
);

create table if not exists shopping_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  shopping_plan_id uuid not null references shopping_plans(id) on delete cascade,
  name text not null,
  quantity numeric not null default 1,
  estimated_price_vnd bigint not null default 0,
  is_bought boolean not null default false,
  linked_transaction_id uuid references transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint shopping_items_quantity_check check (quantity > 0),
  constraint shopping_items_estimated_price_check check (estimated_price_vnd >= 0)
);

create table if not exists ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  ledger_id uuid references ledgers(id) on delete set null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  content text,
  function_name text,
  function_payload jsonb,
  created_at timestamptz not null default now(),
  constraint ai_messages_role_check check (role in ('user', 'assistant', 'tool'))
);

create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  ledger_id uuid not null references ledgers(id) on delete restrict,
  source_type text not null,
  status text not null,
  summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_jobs_source_type_check check (source_type in ('csv', 'xlsx', 'paste_text')),
  constraint import_jobs_status_check check (status in ('preview', 'processing', 'completed', 'failed'))
);

create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null,
  expo_push_token text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_tokens_platform_check check (platform in ('ios', 'android'))
);

create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  payload jsonb,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists ledgers_one_default_per_user_idx
  on ledgers(user_id)
  where is_default = true and deleted_at is null;

create unique index if not exists categories_system_unique_idx
  on categories(type, name, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where user_id is null and deleted_at is null;

create unique index if not exists categories_user_unique_idx
  on categories(user_id, type, name, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where user_id is not null and deleted_at is null;

create unique index if not exists payment_accounts_system_unique_idx
  on payment_accounts(name)
  where user_id is null and deleted_at is null;

create unique index if not exists payment_accounts_user_unique_idx
  on payment_accounts(user_id, name)
  where user_id is not null and deleted_at is null;

create unique index if not exists transactions_client_mutation_unique_idx
  on transactions(user_id, client_mutation_id)
  where client_mutation_id is not null;

create unique index if not exists budgets_unique_month_category_idx
  on budgets(user_id, ledger_id, category_id, month)
  where deleted_at is null;

create index if not exists sessions_user_id_idx on sessions(user_id);
create index if not exists sessions_expires_at_idx on sessions(expires_at);
create index if not exists ledgers_user_id_idx on ledgers(user_id);
create index if not exists categories_user_type_idx on categories(user_id, type);
create index if not exists categories_parent_id_idx on categories(parent_id);
create index if not exists payment_accounts_user_id_idx on payment_accounts(user_id);
create index if not exists transactions_user_ledger_date_idx on transactions(user_id, ledger_id, transaction_date desc);
create index if not exists transactions_user_ledger_type_date_idx on transactions(user_id, ledger_id, type, transaction_date desc);
create index if not exists transactions_user_ledger_category_date_idx on transactions(user_id, ledger_id, category_id, transaction_date desc);
create index if not exists transactions_note_search_idx on transactions using gin (to_tsvector('simple', note));
create index if not exists budgets_user_ledger_month_idx on budgets(user_id, ledger_id, month);
create index if not exists goals_user_ledger_status_idx on goals(user_id, ledger_id, status);
create index if not exists debts_user_ledger_status_idx on debts(user_id, ledger_id, status);
create index if not exists debts_due_date_idx on debts(due_date) where deleted_at is null;
create index if not exists challenges_user_ledger_status_idx on challenges(user_id, ledger_id, status);
create index if not exists shopping_plans_user_ledger_idx on shopping_plans(user_id, ledger_id);
create index if not exists shopping_items_plan_idx on shopping_items(shopping_plan_id);
create index if not exists ai_conversations_user_id_idx on ai_conversations(user_id);
create index if not exists ai_messages_conversation_id_idx on ai_messages(conversation_id, created_at);
create index if not exists import_jobs_user_status_idx on import_jobs(user_id, status);
create index if not exists device_tokens_user_id_idx on device_tokens(user_id);
create index if not exists notification_events_user_created_idx on notification_events(user_id, created_at desc);

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at
before update on users
for each row execute function set_updated_at();

drop trigger if exists user_settings_set_updated_at on user_settings;
create trigger user_settings_set_updated_at
before update on user_settings
for each row execute function set_updated_at();

drop trigger if exists ledgers_set_updated_at on ledgers;
create trigger ledgers_set_updated_at
before update on ledgers
for each row execute function set_updated_at();

drop trigger if exists categories_set_updated_at on categories;
create trigger categories_set_updated_at
before update on categories
for each row execute function set_updated_at();

drop trigger if exists payment_accounts_set_updated_at on payment_accounts;
create trigger payment_accounts_set_updated_at
before update on payment_accounts
for each row execute function set_updated_at();

drop trigger if exists transactions_set_updated_at on transactions;
create trigger transactions_set_updated_at
before update on transactions
for each row execute function set_updated_at();

drop trigger if exists budgets_set_updated_at on budgets;
create trigger budgets_set_updated_at
before update on budgets
for each row execute function set_updated_at();

drop trigger if exists goals_set_updated_at on goals;
create trigger goals_set_updated_at
before update on goals
for each row execute function set_updated_at();

drop trigger if exists debts_set_updated_at on debts;
create trigger debts_set_updated_at
before update on debts
for each row execute function set_updated_at();

drop trigger if exists challenges_set_updated_at on challenges;
create trigger challenges_set_updated_at
before update on challenges
for each row execute function set_updated_at();

drop trigger if exists shopping_plans_set_updated_at on shopping_plans;
create trigger shopping_plans_set_updated_at
before update on shopping_plans
for each row execute function set_updated_at();

drop trigger if exists shopping_items_set_updated_at on shopping_items;
create trigger shopping_items_set_updated_at
before update on shopping_items
for each row execute function set_updated_at();

drop trigger if exists ai_conversations_set_updated_at on ai_conversations;
create trigger ai_conversations_set_updated_at
before update on ai_conversations
for each row execute function set_updated_at();

drop trigger if exists import_jobs_set_updated_at on import_jobs;
create trigger import_jobs_set_updated_at
before update on import_jobs
for each row execute function set_updated_at();

drop trigger if exists device_tokens_set_updated_at on device_tokens;
create trigger device_tokens_set_updated_at
before update on device_tokens
for each row execute function set_updated_at();
