alter table users
  alter column google_sub drop not null;

alter table users
  add column if not exists password_hash text,
  add column if not exists email_verified_at timestamptz,
  add column if not exists password_updated_at timestamptz;

create table if not exists email_verification_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  email text not null,
  purpose text not null,
  code_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint email_verification_otps_purpose_check check (purpose in ('signup')),
  constraint email_verification_otps_attempts_check check (attempts >= 0),
  constraint email_verification_otps_max_attempts_check check (max_attempts > 0)
);

create index if not exists email_verification_otps_email_purpose_idx
  on email_verification_otps(lower(email), purpose, created_at desc);

create index if not exists email_verification_otps_active_idx
  on email_verification_otps(lower(email), purpose, expires_at)
  where consumed_at is null;
