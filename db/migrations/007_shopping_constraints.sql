create index if not exists shopping_items_user_plan_active_idx
  on shopping_items(user_id, shopping_plan_id)
  where deleted_at is null;

create unique index if not exists shopping_items_linked_transaction_unique_idx
  on shopping_items(linked_transaction_id)
  where linked_transaction_id is not null;
