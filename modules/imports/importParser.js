const ExcelJS = require('exceljs');

const MAX_IMPORT_ROWS = 1000;

const HEADER_ALIASES = {
  type: ['type', 'loai', 'loaigiaodich', 'transactiontype'],
  amountVnd: [
    'amount',
    'amountvnd',
    'amount_vnd',
    'sotien',
    'sotienvnd',
    'value',
  ],
  transactionDate: [
    'date',
    'transactiondate',
    'transaction_date',
    'ngay',
    'ngaygiaodich',
  ],
  categoryId: ['categoryid', 'category_id', 'danhmucid'],
  categoryName: ['category', 'categoryname', 'category_name', 'danhmuc'],
  subcategoryId: ['subcategoryid', 'subcategory_id', 'danhmucconid'],
  subcategoryName: [
    'subcategory',
    'subcategoryname',
    'subcategory_name',
    'danhmuccon',
  ],
  note: ['note', 'memo', 'description', 'ghichu', 'mota'],
  paymentMethod: [
    'paymentmethod',
    'payment_method',
    'method',
    'phuongthucthanhtoan',
  ],
  paymentAccountId: ['paymentaccountid', 'payment_account_id', 'taikhoanid'],
  paymentAccountName: [
    'paymentaccount',
    'paymentaccountname',
    'payment_account',
    'taikhoan',
  ],
};

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function canonicalHeader(value) {
  const normalized = normalizeKey(value);

  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) {
      return key;
    }
  }

  return null;
}

function detectDelimiter(firstLine) {
  const candidates = [',', '\t', ';'];
  let selected = ',';
  let selectedCount = -1;

  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;

    if (count > selectedCount) {
      selected = candidate;
      selectedCount = count;
    }
  }

  return selected;
}

function parseDelimited(content, delimiter) {
  const rows = [[]];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      rows[rows.length - 1].push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      rows[rows.length - 1].push(field);
      field = '';

      if (char === '\r' && next === '\n') {
        index += 1;
      }

      rows.push([]);
      continue;
    }

    field += char;
  }

  rows[rows.length - 1].push(field);

  return rows.filter((row) => row.some((cell) => String(cell).trim() !== ''));
}

function mapRows(rawRows) {
  if (rawRows.length === 0) {
    return [];
  }

  const headerRow = rawRows[0];
  const headerMap = new Map();

  headerRow.forEach((header, index) => {
    const canonical = canonicalHeader(header);

    if (canonical && !headerMap.has(canonical)) {
      headerMap.set(canonical, index);
    }
  });

  return rawRows.slice(1, MAX_IMPORT_ROWS + 1).map((row, index) => {
    const values = {};
    const raw = {};

    headerMap.forEach((columnIndex, key) => {
      values[key] = String(row[columnIndex] || '').trim();
      raw[key] = row[columnIndex] || '';
    });

    return {
      rowNumber: index + 2,
      raw,
      values,
    };
  });
}

function parseTextRows(content) {
  const normalizedContent = String(content || '').replace(/^\uFEFF/, '');
  const firstLine =
    normalizedContent.split(/\r?\n/).find((line) => line.trim() !== '') || '';
  const delimiter = detectDelimiter(firstLine);

  return mapRows(parseDelimited(normalizedContent, delimiter));
}

function formatDateValue(date) {
  return date.toISOString().slice(0, 10);
}

function cellToString(cell) {
  const value = cell.value;

  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDateValue(value);
  if (typeof value === 'object') {
    if (value.text) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || '').join('');
    }
  }

  return String(value);
}

async function parseXlsxRows(contentBase64) {
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(contentBase64 || '', 'base64');

  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    return [];
  }

  const rawRows = [];

  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const cells = [];

    for (let columnIndex = 1; columnIndex <= row.cellCount; columnIndex += 1) {
      cells.push(cellToString(row.getCell(columnIndex)).trim());
    }

    if (cells.some((cell) => cell !== '')) {
      rawRows.push(cells);
    }

    if (rawRows.length > MAX_IMPORT_ROWS + 1) {
      break;
    }
  }

  return mapRows(rawRows);
}

async function parseImportRows(sourceType, payload) {
  if (sourceType === 'xlsx') {
    return parseXlsxRows(payload.contentBase64);
  }

  return parseTextRows(payload.content);
}

module.exports = {
  MAX_IMPORT_ROWS,
  parseImportRows,
};
