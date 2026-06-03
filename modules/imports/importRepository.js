const db = require('../../config/db');
const categoryRepository = require('../categories/categoryRepository');
const paymentAccountRepository = require('../paymentAccounts/paymentAccountRepository');
const transactionRepository = require('../transactions/transactionRepository');
const { parseImportRows } = require('./importParser');

const IMPORT_JOB_FIELDS = `
  id,
  user_id as "userId",
  ledger_id as "ledgerId",
  source_type as "sourceType",
  status,
  summary,
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function appError(code, message, status) {
  const err = new Error(message);

  err.code = code;
  err.status = status;
  return err;
}

function notFoundError() {
  return appError('IMPORT_JOB_NOT_FOUND', 'Import job not found', 404);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseJson(value) {
  if (!value || typeof value !== 'string') {
    return value || null;
  }

  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function mapJob(row) {
  if (!row) return null;

  return {
    ...row,
    summary: parseJson(row.summary),
  };
}

async function assertLedger(userId, ledgerId) {
  const result = await db.query(
    `
      select id
      from ledgers
      where user_id = $1
        and id = $2
        and deleted_at is null
      limit 1
    `,
    [userId, ledgerId]
  );

  if (result.rowCount === 0) {
    throw appError('INVALID_LEDGER', 'Ledger not found', 400);
  }
}

function rowError(field, code, message) {
  return { field, code, message };
}

function parseType(value) {
  const normalized = normalizeText(value);

  if (['income', 'thu', 'in', 'revenue'].includes(normalized)) {
    return 'income';
  }

  if (['expense', 'chi', 'out', 'spend', 'spending'].includes(normalized)) {
    return 'expense';
  }

  return null;
}

function parseAmount(value) {
  const amountText = String(value || '').trim();

  if (!amountText) return null;

  const normalized = amountText.replace(/[^\d.,-]/g, '').replace(/[.,]/g, '');

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);

  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function isValidDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function toIsoDate(year, month, day) {
  if (!isValidDateParts(year, month, day)) return null;

  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function parseDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match) {
    return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (match) {
    return toIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  }

  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);

  if (match) {
    const year = Number(match[3]);
    const fullYear = year >= 70 ? 1900 + year : 2000 + year;

    return toIsoDate(fullYear, Number(match[2]), Number(match[1]));
  }

  return null;
}

function parsePaymentMethod(value) {
  const normalized = normalizeText(value);

  if (!normalized) return 'cash';

  if (['cash', 'tien mat', 'tienmat'].includes(normalized)) {
    return 'cash';
  }

  if (
    ['transfer', 'bank', 'card', 'wallet', 'chuyen khoan', 'chuyenkhoan'].includes(
      normalized
    )
  ) {
    return 'transfer';
  }

  return null;
}

function findById(items, id) {
  if (!id) return null;

  return items.find((item) => item.id === id) || null;
}

function findCategoryByName(categories, name, type, parentId) {
  const normalizedName = normalizeText(name);

  if (!normalizedName) return null;

  return (
    categories.find(
      (category) =>
        category.type === type &&
        normalizeText(category.name) === normalizedName &&
        (category.parentId || null) === (parentId || null)
    ) || null
  );
}

function resolveCategory(values, categories, type, errors) {
  const categoryId = values.categoryId || '';
  const categoryName = values.categoryName || '';
  let category = null;

  if (categoryId) {
    category = findById(categories, categoryId);

    if (!category) {
      errors.push(rowError('categoryId', 'CATEGORY_NOT_FOUND', 'Category not found'));
      return null;
    }

    if (category.parentId) {
      errors.push(
        rowError('categoryId', 'CATEGORY_MUST_BE_PARENT', 'Category must be a parent')
      );
      return null;
    }

    if (category.type !== type) {
      errors.push(
        rowError('categoryId', 'CATEGORY_TYPE_MISMATCH', 'Category type mismatch')
      );
      return null;
    }

    return category;
  }

  category = findCategoryByName(categories, categoryName, type, null);

  if (!category) {
    errors.push(
      rowError('categoryName', 'CATEGORY_NOT_FOUND', 'Category name not found')
    );
  }

  return category;
}

function resolveSubcategory(values, categories, type, category, errors) {
  if (!category) return null;

  const subcategoryId = values.subcategoryId || '';
  const subcategoryName = values.subcategoryName || '';

  if (!subcategoryId && !subcategoryName) {
    return null;
  }

  if (subcategoryId) {
    const subcategory = findById(categories, subcategoryId);

    if (!subcategory) {
      errors.push(
        rowError('subcategoryId', 'SUBCATEGORY_NOT_FOUND', 'Subcategory not found')
      );
      return null;
    }

    if (subcategory.type !== type || subcategory.parentId !== category.id) {
      errors.push(
        rowError(
          'subcategoryId',
          'SUBCATEGORY_PARENT_MISMATCH',
          'Subcategory does not belong to category'
        )
      );
      return null;
    }

    return subcategory;
  }

  const subcategory = findCategoryByName(
    categories,
    subcategoryName,
    type,
    category.id
  );

  if (!subcategory) {
    errors.push(
      rowError(
        'subcategoryName',
        'SUBCATEGORY_NOT_FOUND',
        'Subcategory name not found'
      )
    );
  }

  return subcategory;
}

function resolvePaymentAccount(values, accounts, errors) {
  if (values.paymentAccountId) {
    const account = findById(accounts, values.paymentAccountId);

    if (!account) {
      errors.push(
        rowError(
          'paymentAccountId',
          'PAYMENT_ACCOUNT_NOT_FOUND',
          'Payment account not found'
        )
      );
    }

    return account;
  }

  if (!values.paymentAccountName) {
    return null;
  }

  const normalizedName = normalizeText(values.paymentAccountName);
  const account =
    accounts.find(
      (item) =>
        normalizeText(item.name) === normalizedName ||
        normalizeText(item.shortName) === normalizedName
    ) || null;

  if (!account) {
    errors.push(
      rowError(
        'paymentAccountName',
        'PAYMENT_ACCOUNT_NOT_FOUND',
        'Payment account name not found'
      )
    );
  }

  return account;
}

function validateImportRow(row, categories, accounts) {
  const errors = [];
  const values = row.values;
  const type = parseType(values.type);
  const amountVnd = parseAmount(values.amountVnd);
  const transactionDate = parseDate(values.transactionDate);
  const paymentMethod = parsePaymentMethod(values.paymentMethod);

  if (!type) {
    errors.push(
      rowError('type', 'INVALID_TYPE', 'Type must be income/expense or thu/chi')
    );
  }

  if (!amountVnd) {
    errors.push(
      rowError('amountVnd', 'INVALID_AMOUNT', 'Amount must be a positive VND integer')
    );
  }

  if (!transactionDate) {
    errors.push(
      rowError(
        'transactionDate',
        'INVALID_DATE',
        'Date must be dd/MM/yyyy, dd-MM-yyyy, yyyy-MM-dd, dd/MM/yy, or dd-MM-yy'
      )
    );
  }

  if (!paymentMethod) {
    errors.push(
      rowError('paymentMethod', 'INVALID_PAYMENT_METHOD', 'Use cash or transfer')
    );
  }

  const category = type ? resolveCategory(values, categories, type, errors) : null;
  const subcategory = resolveSubcategory(values, categories, type, category, errors);
  const paymentAccount = resolvePaymentAccount(values, accounts, errors);

  if (errors.length > 0) {
    return {
      rowNumber: row.rowNumber,
      raw: row.raw,
      isValid: false,
      errors,
    };
  }

  return {
    rowNumber: row.rowNumber,
    raw: row.raw,
    isValid: true,
    errors: [],
    normalized: {
      type,
      amountVnd,
      categoryId: category.id,
      subcategoryId: subcategory?.id || null,
      transactionDate,
      note: values.note || '',
      paymentMethod,
      paymentAccountId: paymentAccount?.id || null,
      receiptImageUrl: null,
      source: 'import',
    },
  };
}

async function previewImport(userId, payload) {
  await assertLedger(userId, payload.ledgerId);

  let parsedRows;

  try {
    parsedRows = await parseImportRows(payload.sourceType, payload);
  } catch (err) {
    throw appError('INVALID_IMPORT_FILE', 'Import file could not be parsed', 400);
  }

  const [categories, accounts] = await Promise.all([
    categoryRepository.listCategories(userId),
    paymentAccountRepository.listPaymentAccounts(userId),
  ]);
  const rows = parsedRows.map((row) => validateImportRow(row, categories, accounts));
  const validCount = rows.filter((row) => row.isValid).length;
  const invalidCount = rows.length - validCount;
  const summary = {
    sourceType: payload.sourceType,
    totalRows: rows.length,
    validCount,
    invalidCount,
    rows,
  };
  const result = await db.query(
    `
      insert into import_jobs (
        user_id,
        ledger_id,
        source_type,
        status,
        summary
      )
      values ($1, $2, $3, 'preview', $4::jsonb)
      returning ${IMPORT_JOB_FIELDS}
    `,
    [userId, payload.ledgerId, payload.sourceType, JSON.stringify(summary)]
  );

  return mapJob(result.rows[0]);
}

async function commitImport(userId, jobId) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('begin');

    const jobResult = await client.query(
      `
        select ${IMPORT_JOB_FIELDS}
        from import_jobs
        where user_id = $1
          and id = $2
        for update
      `,
      [userId, jobId]
    );

    if (jobResult.rowCount === 0) {
      throw notFoundError();
    }

    const job = mapJob(jobResult.rows[0]);

    if (job.status !== 'preview') {
      throw appError(
        'IMPORT_JOB_NOT_COMMITTABLE',
        'Only preview import jobs can be committed',
        409
      );
    }

    const rows = Array.isArray(job.summary?.rows) ? job.summary.rows : [];
    const validRows = rows.filter((row) => row.isValid && row.normalized);
    const transactions = [];

    for (const row of validRows) {
      const transaction = await transactionRepository.createTransactionWithClient(
        userId,
        {
          ...row.normalized,
          ledgerId: job.ledgerId,
          source: 'import',
          clientMutationId: `import:${job.id}:${row.rowNumber}`,
        },
        client
      );

      transactions.push(transaction);
    }

    const completedSummary = {
      ...job.summary,
      committedCount: transactions.length,
      transactionIds: transactions.map((transaction) => transaction.id),
    };
    const updated = await client.query(
      `
        update import_jobs
        set status = 'completed',
            summary = $3::jsonb
        where user_id = $1
          and id = $2
        returning ${IMPORT_JOB_FIELDS}
      `,
      [userId, jobId, JSON.stringify(completedSummary)]
    );

    await client.query('commit');

    return {
      job: mapJob(updated.rows[0]),
      transactions,
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  commitImport,
  previewImport,
};
