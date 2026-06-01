create index if not exists transactions_active_user_ledger_date_idx
  on transactions(user_id, ledger_id, transaction_date)
  where deleted_at is null;

create index if not exists transactions_active_user_ledger_type_date_idx
  on transactions(user_id, ledger_id, type, transaction_date)
  where deleted_at is null;

create index if not exists transactions_active_user_ledger_category_date_idx
  on transactions(user_id, ledger_id, category_id, transaction_date)
  where deleted_at is null;
