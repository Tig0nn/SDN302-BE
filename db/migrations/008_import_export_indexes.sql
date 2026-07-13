create index if not exists import_jobs_user_created_idx
on import_jobs(user_id, created_at desc);

create index if not exists import_jobs_user_ledger_status_idx
on import_jobs(user_id, ledger_id, status);
