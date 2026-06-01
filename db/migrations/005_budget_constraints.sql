drop index if exists budgets_unique_month_category_idx;

create unique index if not exists budgets_unique_month_category_idx
  on budgets(
    user_id,
    ledger_id,
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    month
  )
  where deleted_at is null;

create unique index if not exists notification_events_budget_threshold_unique_idx
  on notification_events(
    user_id,
    type,
    (payload->>'budgetId'),
    (payload->>'threshold'),
    (payload->>'month')
  )
  where type = 'budget_threshold';
