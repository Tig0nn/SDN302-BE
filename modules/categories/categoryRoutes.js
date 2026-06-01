const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const categoryRepository = require('./categoryRepository');

const router = express.Router();

const categoryParamsSchema = z.object({
  id: z.string().uuid(),
});

const categoryQuerySchema = z.object({
  type: z.enum(['income', 'expense']).optional(),
  parentId: z.union([z.string().uuid(), z.literal('root')]).optional(),
});

const categoryCreateSchema = z.object({
  type: z.enum(['income', 'expense']),
  name: z.string().trim().min(1).max(120),
  parentId: z.string().uuid().nullable().optional(),
  icon: z.string().trim().min(1).max(80).nullable().optional(),
  color: z.string().trim().min(1).max(40).nullable().optional(),
});

const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    icon: z.string().trim().min(1).max(80).nullable().optional(),
    color: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

function sendOk(req, res, data, statusCode = 200) {
  res.status(statusCode).json({
    data,
    meta: {
      requestId: req.requestId,
    },
    error: null,
  });
}

function buildCategoryTree(categories) {
  const byParent = new Map();

  for (const category of categories) {
    const parentKey = category.parentId || 'root';
    const siblings = byParent.get(parentKey) || [];

    siblings.push(category);
    byParent.set(parentKey, siblings);
  }

  return (byParent.get('root') || []).map((category) => ({
    ...category,
    subcategories: byParent.get(category.id) || [],
  }));
}

function normalizeCategoryFilters(query) {
  return {
    type: query.type,
    hasParentFilter: Object.prototype.hasOwnProperty.call(query, 'parentId'),
    parentId: query.parentId === 'root' ? null : query.parentId,
  };
}

router.get(
  '/',
  requireAuth,
  validate({ query: categoryQuerySchema }),
  async function getCategories(req, res, next) {
    try {
      const categories = await categoryRepository.listCategories(
        req.user.id,
        normalizeCategoryFilters(req.query)
      );

      sendOk(req, res, {
        categories,
        tree: buildCategoryTree(categories),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireAuth,
  validate({ body: categoryCreateSchema }),
  async function createCategory(req, res, next) {
    try {
      const category = await categoryRepository.createCategory(req.user.id, req.body);

      sendOk(req, res, { category }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireAuth,
  validate({ params: categoryParamsSchema, body: categoryUpdateSchema }),
  async function updateCategory(req, res, next) {
    try {
      const category = await categoryRepository.updateCategory(
        req.user.id,
        req.params.id,
        req.body
      );

      sendOk(req, res, { category });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  validate({ params: categoryParamsSchema }),
  async function deleteCategory(req, res, next) {
    try {
      const deletedCategories = await categoryRepository.deleteCategory(
        req.user.id,
        req.params.id
      );

      sendOk(req, res, { deletedCategories });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
