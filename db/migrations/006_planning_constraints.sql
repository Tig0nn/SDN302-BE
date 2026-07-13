alter table debts
  drop constraint if exists debts_remaining_not_greater_than_amount_check;

alter table debts
  add constraint debts_remaining_not_greater_than_amount_check
  check (remaining_amount_vnd <= amount_vnd)
  not valid;

create index if not exists debts_overdue_scan_idx
  on debts(due_date)
  where deleted_at is null
    and status in ('active', 'overdue')
    and remaining_amount_vnd > 0;

create unique index if not exists notification_events_goal_completed_unique_idx
  on notification_events(
    user_id,
    type,
    (payload->>'goalId')
  )
  where type = 'goal_completed';
