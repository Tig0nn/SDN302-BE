const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const db = require('../config/db');
const categoryRepository = require('../modules/categories/categoryRepository');
const paymentAccountRepository = require('../modules/paymentAccounts/paymentAccountRepository');
const { parseImportRows } = require('../modules/imports/importParser');
const importRepository = require('../modules/imports/importRepository');

const originalQuery = db.query;
const originalGetPool = db.getPool;
const originalListCategories = categoryRepository.listCategories;
const originalListPaymentAccounts = paymentAccountRepository.listPaymentAccounts;

const userId = '11111111-1111-4111-8111-111111111111';
const ledgerId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const categoryId = '44444444-4444-4444-8444-444444444444';
const subcategoryId = '55555555-5555-4555-8555-555555555555';
const incomeCategoryId = '66666666-6666-4666-8666-666666666666';
const paymentAccountId = '77777777-7777-4777-8777-777777777777';

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function installQueryHandler(handler) {
  db.query = async function fakeQuery(sql, params = []) {
    return handler(normalizeSql(sql), params);
  };
}

function installClientHandler(handler) {
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
        return { rowCount: 0, rows: [] };
      }

      return handler(normalized, params);
    },
    release() {},
  };

  db.getPool = function getFakePool() {
    return {
      connect: async function connect() {
        return client;
      },
    };
  };
}

function categories() {
  return [
    {
      id: categoryId,
      userId,
      type: 'expense',
      name: 'Food',
      parentId: null,
    },
    {
      id: subcategoryId,
      userId,
      type: 'expense',
      name: 'Cafe',
      parentId: categoryId,
    },
    {
      id: incomeCategoryId,
      userId,
      type: 'income',
      name: 'Salary',
      parentId: null,
    },
  ];
}

function accounts() {
  return [
    {
      id: paymentAccountId,
      userId,
      name: 'Cash',
      shortName: 'Cash',
      type: 'cash',
    },
  ];
}

test.afterEach(function cleanup() {
  db.query = originalQuery;
  db.getPool = originalGetPool;
  categoryRepository.listCategories = originalListCategories;
  paymentAccountRepository.listPaymentAccounts = originalListPaymentAccounts;
});

test('parseImportRows reads delimited text with aliases, quotes, BOM, and semicolon delimiter', async function () {
  const rows = await parseImportRows('csv', {
    content:
      '\uFEFFLoai;So tien;Ngay giao dich;Danh muc;Danh muc con;Ghi chu\n' +
      'chi;"12;500";01/06/26;Food;Cafe;"milk; bread"',
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[0].values.type, 'chi');
  assert.equal(rows[0].values.amountVnd, '12;500');
  assert.equal(rows[0].values.note, 'milk; bread');
});

test('parseImportRows reads XLSX rows with dates, formulas, and rich text cells', async function () {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Transactions');

  worksheet.addRow(['type', 'amount_vnd', 'transaction_date', 'category', 'note']);
  worksheet.addRow(['expense', { formula: '10000+5000', result: 15000 }, new Date('2026-06-01T00:00:00.000Z'), 'Food', {
    richText: [
      { text: 'hello ' },
      { text: 'xlsx' },
    ],
  }]);

  const buffer = await workbook.xlsx.writeBuffer();
  const rows = await parseImportRows('xlsx', {
    contentBase64: Buffer.from(buffer).toString('base64'),
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.amountVnd, '15000');
  assert.equal(rows[0].values.transactionDate, '2026-06-01');
  assert.equal(rows[0].values.note, 'hello xlsx');
});

test('previewImport normalizes valid rows and records row-level validation errors', async function () {
  categoryRepository.listCategories = async function listCategories(user) {
    assert.equal(user, userId);
    return categories();
  };
  paymentAccountRepository.listPaymentAccounts = async function listPaymentAccounts(user) {
    assert.equal(user, userId);
    return accounts();
  };
  installQueryHandler(async function handleQuery(sql, params) {
    if (sql.includes('from ledgers')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], ledgerId);

      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    if (sql.includes('insert into import_jobs')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], ledgerId);
      assert.equal(params[2], 'paste_text');

      const summary = JSON.parse(params[3]);

      return {
        rowCount: 1,
        rows: [
          {
            id: jobId,
            userId,
            ledgerId,
            sourceType: 'paste_text',
            status: 'preview',
            summary: JSON.stringify(summary),
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const content = [
    [
      'type',
      'amount_vnd',
      'transaction_date',
      'category_id',
      'category',
      'subcategory',
      'payment_method',
      'payment_account',
      'note',
    ].join(','),
    ['chi', '120000', '01/06/26', '', 'Food', 'Cafe', 'chuyen khoan', 'Cash', 'Valid row'].join(','),
    ['income', 'abc', '32/13/2026', '', 'Missing', '', 'card', 'Missing account', 'Bad row'].join(','),
    ['expense', '1000', '2026-06-01', incomeCategoryId, '', '', 'cash', '', 'Wrong type'].join(','),
  ].join('\n');

  const job = await importRepository.previewImport(userId, {
    ledgerId,
    sourceType: 'paste_text',
    content,
  });

  assert.equal(job.summary.totalRows, 3);
  assert.equal(job.summary.validCount, 1);
  assert.equal(job.summary.invalidCount, 2);
  assert.deepEqual(job.summary.rows[0].normalized, {
    type: 'expense',
    amountVnd: 120000,
    categoryId,
    subcategoryId,
    transactionDate: '2026-06-01',
    note: 'Valid row',
    paymentMethod: 'transfer',
    paymentAccountId,
    receiptImageUrl: null,
    source: 'import',
  });
  assert.ok(
    job.summary.rows[1].errors.some((error) => error.code === 'INVALID_AMOUNT')
  );
  assert.ok(
    job.summary.rows[2].errors.some((error) => error.code === 'CATEGORY_TYPE_MISMATCH')
  );
});

test('previewImport reports invalid import files as typed validation errors', async function () {
  installQueryHandler(async function handleQuery(sql) {
    if (sql.includes('from ledgers')) {
      return { rowCount: 1, rows: [{ id: ledgerId }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  await assert.rejects(
    () =>
      importRepository.previewImport(userId, {
        ledgerId,
        sourceType: 'xlsx',
        contentBase64: 'not-valid-xlsx',
      }),
    {
      code: 'INVALID_IMPORT_FILE',
      status: 400,
    }
  );
});

test('commitImport rejects missing and already-completed jobs', async function () {
  let found = false;

  installClientHandler(async function handleClientQuery(sql, params) {
    if (sql.includes('from import_jobs') && sql.includes('for update')) {
      assert.equal(params[0], userId);
      assert.equal(params[1], jobId);

      if (!found) {
        found = true;
        return { rowCount: 0, rows: [] };
      }

      return {
        rowCount: 1,
        rows: [
          {
            id: jobId,
            userId,
            ledgerId,
            sourceType: 'csv',
            status: 'completed',
            summary: JSON.stringify({ rows: [] }),
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  await assert.rejects(() => importRepository.commitImport(userId, jobId), {
    code: 'IMPORT_JOB_NOT_FOUND',
    status: 404,
  });
  await assert.rejects(() => importRepository.commitImport(userId, jobId), {
    code: 'IMPORT_JOB_NOT_COMMITTABLE',
    status: 409,
  });
});
