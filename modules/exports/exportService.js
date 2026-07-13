const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const env = require('../../config/env');

const CSV_HEADERS = [
  'Date',
  'Type',
  'Amount VND',
  'Category',
  'Subcategory',
  'Payment Method',
  'Note',
  'Source',
  'ID',
];

function transactionToRow(transaction) {
  return {
    transactionDate: transaction.transactionDate,
    type: transaction.type,
    amountVnd: transaction.amountVnd,
    category: transaction.categoryNameSnapshot || '',
    subcategory: transaction.subcategoryNameSnapshot || '',
    paymentMethod: transaction.paymentMethod,
    note: transaction.note || '',
    source: transaction.source,
    id: transaction.id,
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  const formulaSafe = /^[=+\-@]/.test(text) ? `'${text}` : text;

  if (/[",\r\n]/.test(formulaSafe)) {
    return `"${formulaSafe.replace(/"/g, '""')}"`;
  }

  return formulaSafe;
}

function createCsv(transactions) {
  const rows = transactions.map(transactionToRow);
  const lines = [
    CSV_HEADERS.join(','),
    ...rows.map((row) =>
      [
        row.transactionDate,
        row.type,
        row.amountVnd,
        row.category,
        row.subcategory,
        row.paymentMethod,
        row.note,
        row.source,
        row.id,
      ]
        .map(csvEscape)
        .join(',')
    ),
  ];

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

async function createXlsx(transactions) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Transactions');

  workbook.creator = 'Vi Vi Vu API';
  workbook.created = new Date();
  worksheet.columns = [
    { header: 'Date', key: 'transactionDate', width: 14 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Amount VND', key: 'amountVnd', width: 16 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Subcategory', key: 'subcategory', width: 22 },
    { header: 'Payment Method', key: 'paymentMethod', width: 18 },
    { header: 'Note', key: 'note', width: 36 },
    { header: 'Source', key: 'source', width: 14 },
    { header: 'ID', key: 'id', width: 40 },
  ];

  for (const transaction of transactions) {
    worksheet.addRow(transactionToRow(transaction));
  }

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: 'middle' };
  worksheet.getColumn('amountVnd').numFmt = '#,##0';
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: 'A1',
    to: 'I1',
  };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function existingFile(candidate) {
  if (!candidate) return null;

  try {
    return fs.existsSync(candidate) ? candidate : null;
  } catch (err) {
    return null;
  }
}

function resolvePdfFontPath() {
  const candidates = [
    env.PDF_FONT_PATH,
    path.join(process.cwd(), 'assets', 'fonts', 'NotoSans-Regular.ttf'),
    '/usr/share/fonts/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
  ];

  for (const candidate of candidates) {
    const found = existingFile(candidate);

    if (found) return found;
  }

  return null;
}

function resolvePdfBoldFontPath() {
  const candidates = [
    env.PDF_BOLD_FONT_PATH,
    path.join(process.cwd(), 'assets', 'fonts', 'NotoSans-Bold.ttf'),
    '/usr/share/fonts/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    'C:\\Windows\\Fonts\\arialbd.ttf',
  ];

  for (const candidate of candidates) {
    const found = existingFile(candidate);

    if (found) return found;
  }

  return null;
}

function formatVnd(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

function truncate(value, maxLength) {
  const text = String(value || '');

  if (text.length <= maxLength) return text;

  return `${text.slice(0, maxLength - 1)}...`;
}

function drawPdfTable(doc, rows, fonts) {
  const columns = [
    { label: 'Ngay', key: 'transactionDate', x: 36, width: 62 },
    { label: 'Loai', key: 'type', x: 102, width: 48 },
    { label: 'So tien', key: 'amountVnd', x: 154, width: 72 },
    { label: 'Danh muc', key: 'category', x: 230, width: 86 },
    { label: 'Ghi chu', key: 'note', x: 320, width: 220 },
  ];
  let y = doc.y + 12;

  doc.fontSize(9);
  doc.font(fonts.bold);

  for (const column of columns) {
    doc.text(column.label, column.x, y, { width: column.width });
  }

  y += 18;
  doc.moveTo(36, y - 4).lineTo(540, y - 4).strokeColor('#888888').stroke();
  doc.font(fonts.regular);

  for (const row of rows) {
    if (y > 760) {
      doc.addPage();
      y = 48;
      doc.font(fonts.bold);

      for (const column of columns) {
        doc.text(column.label, column.x, y, { width: column.width });
      }

      y += 18;
      doc.moveTo(36, y - 4).lineTo(540, y - 4).strokeColor('#888888').stroke();
      doc.font(fonts.regular);
    }

    doc.text(row.transactionDate, columns[0].x, y, { width: columns[0].width });
    doc.text(row.type, columns[1].x, y, { width: columns[1].width });
    doc.text(formatVnd(row.amountVnd), columns[2].x, y, {
      width: columns[2].width,
      align: 'right',
    });
    doc.text(truncate(row.category, 24), columns[3].x, y, {
      width: columns[3].width,
    });
    doc.text(truncate(row.note, 70), columns[4].x, y, {
      width: columns[4].width,
    });

    y += 16;
  }
}

async function createPdf(transactions) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks = [];
    const fontPath = resolvePdfFontPath();
    const boldFontPath = resolvePdfBoldFontPath();
    const fonts = fontPath
      ? { regular: 'ViViVu', bold: boldFontPath ? 'ViViVu-Bold' : 'ViViVu' }
      : { regular: 'Helvetica', bold: 'Helvetica-Bold' };

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (fontPath) {
      doc.registerFont('ViViVu', fontPath);
      doc.registerFont('ViViVu-Bold', boldFontPath || fontPath);
    }

    doc.font(fonts.bold).fontSize(16).text('Vi Vi Vu - Bao cao giao dich');
    doc
      .font(fonts.regular)
      .fontSize(9)
      .text(`Ngay xuat: ${new Date().toISOString().slice(0, 10)}`)
      .text(`Tong so giao dich: ${transactions.length}`);

    drawPdfTable(doc, transactions.map(transactionToRow), fonts);

    doc.end();
  });
}

module.exports = {
  createCsv,
  createPdf,
  createXlsx,
};
