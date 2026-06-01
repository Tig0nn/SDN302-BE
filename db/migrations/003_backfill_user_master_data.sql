insert into categories (
  user_id,
  type,
  name,
  parent_id,
  icon,
  color,
  is_system,
  sort_order
)
select
  u.id,
  c.type,
  c.name,
  null,
  c.icon,
  c.color,
  true,
  c.sort_order
from users u
cross join categories c
where c.user_id is null
  and c.parent_id is null
  and c.deleted_at is null
  and c.is_system = true
  and not exists (
    select 1
    from categories existing
    where existing.user_id = u.id
      and existing.type = c.type
      and existing.name = c.name
      and existing.parent_id is null
      and existing.deleted_at is null
  );

insert into categories (
  user_id,
  type,
  name,
  parent_id,
  icon,
  color,
  is_system,
  sort_order
)
select
  u.id,
  child.type,
  child.name,
  user_parent.id,
  child.icon,
  child.color,
  true,
  child.sort_order
from users u
join categories system_parent
  on system_parent.user_id is null
  and system_parent.parent_id is null
  and system_parent.deleted_at is null
  and system_parent.is_system = true
join categories child
  on child.parent_id = system_parent.id
  and child.user_id is null
  and child.deleted_at is null
  and child.is_system = true
join categories user_parent
  on user_parent.user_id = u.id
  and user_parent.type = system_parent.type
  and user_parent.name = system_parent.name
  and user_parent.parent_id is null
  and user_parent.deleted_at is null
where not exists (
  select 1
  from categories existing
  where existing.user_id = u.id
    and existing.type = child.type
    and existing.name = child.name
    and existing.parent_id = user_parent.id
    and existing.deleted_at is null
);

insert into payment_accounts (
  user_id,
  name,
  short_name,
  type,
  color,
  is_system,
  sort_order
)
select
  u.id,
  p.name,
  p.short_name,
  p.type,
  p.color,
  true,
  p.sort_order
from users u
cross join payment_accounts p
where p.user_id is null
  and p.deleted_at is null
  and p.is_system = true
  and not exists (
    select 1
    from payment_accounts existing
    where existing.user_id = u.id
      and existing.name = p.name
      and existing.deleted_at is null
  );
