const db = require('../../config/db');

const CATEGORY_FIELDS = `
  id,
  user_id as "userId",
  type,
  name,
  parent_id as "parentId",
  icon,
  color,
  is_system as "isSystem",
  sort_order as "sortOrder",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function notFoundError() {
  const err = new Error('Category not found');

  err.code = 'CATEGORY_NOT_FOUND';
  err.status = 404;
  return err;
}

function systemCategoryError() {
  const err = new Error('System categories cannot be modified');

  err.code = 'SYSTEM_CATEGORY_READ_ONLY';
  err.status = 403;
  return err;
}

function duplicateCategoryError() {
  const err = new Error('Category already exists');

  err.code = 'CATEGORY_ALREADY_EXISTS';
  err.status = 409;
  return err;
}

function invalidParentError(message) {
  const err = new Error(message);

  err.code = 'INVALID_CATEGORY_PARENT';
  err.status = 400;
  return err;
}

async function listCategories(userId, filters = {}) {
  const result = await db.query(
    `
      with user_category_count as (
        select count(*)::int as count
        from categories
        where user_id = $1
          and deleted_at is null
      )
      select ${CATEGORY_FIELDS}
      from categories c
      where c.deleted_at is null
        and (
          c.user_id = $1
          or (
            c.user_id is null
            and (select count from user_category_count) = 0
          )
        )
        and ($2::text is null or c.type = $2)
        and (
          $3::boolean = false
          or c.parent_id is not distinct from $4::uuid
        )
      order by c.type asc, c.parent_id nulls first, c.sort_order asc, c.name asc
    `,
    [
      userId,
      filters.type || null,
      Boolean(filters.hasParentFilter),
      filters.parentId || null,
    ]
  );

  return result.rows;
}

async function findCategoryForUser(userId, categoryId) {
  const result = await db.query(
    `
      select ${CATEGORY_FIELDS}
      from categories
      where id = $2
        and deleted_at is null
        and (user_id = $1 or user_id is null)
      limit 1
    `,
    [userId, categoryId]
  );

  return result.rows[0] || null;
}

async function assertParent(userId, parentId, type) {
  if (!parentId) return null;

  const parent = await findCategoryForUser(userId, parentId);

  if (!parent) {
    throw invalidParentError('Parent category not found');
  }

  if (parent.type !== type) {
    throw invalidParentError('Parent category type does not match');
  }

  if (parent.parentId) {
    throw invalidParentError('Nested category depth is limited to two levels');
  }

  return parent;
}

async function assertUniqueCategoryName(userId, payload, excludeCategoryId) {
  const result = await db.query(
    `
      select id
      from categories
      where user_id = $1
        and type = $2
        and lower(name) = lower($3)
        and parent_id is not distinct from $4::uuid
        and deleted_at is null
        and ($5::uuid is null or id <> $5)
      limit 1
    `,
    [
      userId,
      payload.type,
      payload.name,
      payload.parentId || null,
      excludeCategoryId || null,
    ]
  );

  if (result.rowCount > 0) {
    throw duplicateCategoryError();
  }
}

async function createCategory(userId, payload) {
  const parentId = payload.parentId || null;

  await assertParent(userId, parentId, payload.type);
  await assertUniqueCategoryName(userId, {
    type: payload.type,
    name: payload.name,
    parentId,
  });

  const result = await db.query(
    `
      insert into categories (
        user_id,
        type,
        name,
        parent_id,
        icon,
        color,
        is_system
      )
      values ($1, $2, $3, $4, $5, $6, false)
      returning ${CATEGORY_FIELDS}
    `,
    [
      userId,
      payload.type,
      payload.name,
      parentId,
      payload.icon || null,
      payload.color || null,
    ]
  );

  return result.rows[0];
}

async function updateCategory(userId, categoryId, payload) {
  const category = await findCategoryForUser(userId, categoryId);

  if (!category || category.userId !== userId) {
    throw notFoundError();
  }

  if (category.isSystem) {
    throw systemCategoryError();
  }

  if (payload.name) {
    await assertUniqueCategoryName(
      userId,
      {
        type: category.type,
        name: payload.name,
        parentId: category.parentId,
      },
      categoryId
    );
  }

  const result = await db.query(
    `
      update categories
      set name = coalesce($3, name),
          icon = case when $4 then $5 else icon end,
          color = case when $6 then $7 else color end
      where user_id = $1
        and id = $2
        and deleted_at is null
      returning ${CATEGORY_FIELDS}
    `,
    [
      userId,
      categoryId,
      payload.name || null,
      Object.prototype.hasOwnProperty.call(payload, 'icon'),
      payload.icon || null,
      Object.prototype.hasOwnProperty.call(payload, 'color'),
      payload.color || null,
    ]
  );

  return result.rows[0];
}

async function deleteCategory(userId, categoryId) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const categoryResult = await client.query(
      `
        select ${CATEGORY_FIELDS}
        from categories
        where user_id = $1
          and id = $2
          and deleted_at is null
        for update
      `,
      [userId, categoryId]
    );

    if (categoryResult.rowCount === 0) {
      throw notFoundError();
    }

    const category = categoryResult.rows[0];

    if (category.isSystem) {
      throw systemCategoryError();
    }

    const deleted = await client.query(
      `
        update categories
        set deleted_at = now()
        where user_id = $1
          and deleted_at is null
          and is_system = false
          and (id = $2 or parent_id = $2)
        returning ${CATEGORY_FIELDS}
      `,
      [userId, categoryId]
    );

    await client.query('commit');
    return deleted.rows;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
};
