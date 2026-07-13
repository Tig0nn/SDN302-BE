const express = require('express');
const { z } = require('zod');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const importRepository = require('./importRepository');
const auditRepository = require('../security/auditRepository');

const router = express.Router();

const uuidSchema = z.string().uuid();

const previewImportSchema = z
  .object({
    ledgerId: uuidSchema,
    sourceType: z.enum(['csv', 'xlsx', 'paste_text']),
    content: z.string().max(5_000_000).optional(),
    contentBase64: z.string().max(8_000_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sourceType === 'xlsx') {
      if (!value.contentBase64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contentBase64'],
          message: 'contentBase64 is required for xlsx imports',
        });
      }

      return;
    }

    if (!value.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content is required for csv and paste_text imports',
      });
    }
  });

const importJobParamsSchema = z.object({
  id: uuidSchema,
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

router.use(requireAuth);

router.post(
  '/preview',
  validate({ body: previewImportSchema }),
  async function previewImport(req, res, next) {
    try {
      const job = await importRepository.previewImport(req.user.id, req.body);

      await auditRepository.recordAuditEvent(req, 'import.preview_created', {
        jobId: job.id,
        ledgerId: job.ledgerId,
        sourceType: job.sourceType,
        totalRows: job.summary?.totalRows || 0,
        validCount: job.summary?.validCount || 0,
        invalidCount: job.summary?.invalidCount || 0,
      });
      sendOk(req, res, { job }, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/commit',
  validate({ params: importJobParamsSchema }),
  async function commitImport(req, res, next) {
    try {
      const result = await importRepository.commitImport(req.user.id, req.params.id);

      await auditRepository.recordAuditEvent(req, 'import.committed', {
        jobId: result.job.id,
        ledgerId: result.job.ledgerId,
        committedCount: result.transactions.length,
      });
      sendOk(req, res, result, 201);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
