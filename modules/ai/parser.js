function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function parseNumericToken(raw) {
  const compact = raw.replace(/\s+/g, '');
  const hasComma = compact.includes(',');
  const hasDot = compact.includes('.');
  let normalized = compact;

  if (hasComma && hasDot) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = compact.replace(',', '.');
  } else if (hasDot) {
    const parts = compact.split('.');
    normalized =
      parts.length === 2 && parts[1].length <= 2 ? compact : compact.replace(/\./g, '');
  }

  return Number(normalized);
}

function parseMoney(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(
    /(\d+(?:[.,]\d+)?)(?:\s*)?(trieu|tr|m|nghin|ngan|k)?\b/
  );

  if (!match) return null;

  const value = parseNumericToken(match[1]);

  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2] || '';
  let amount = value;

  if (['trieu', 'tr', 'm'].includes(unit)) {
    amount *= 1000000;
  } else if (['nghin', 'ngan', 'k'].includes(unit)) {
    amount *= 1000;
  } else if (value < 1000) {
    amount *= 1000;
  }

  return Math.round(amount);
}

function addDays(date, days) {
  const copy = new Date(date.getTime());

  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function todayInTimeZone(timeZone, currentDate) {
  if (currentDate) return currentDate;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(new Date());
}

function dateFromParts(day, month, year) {
  let fullYear = Number(year);

  if (fullYear < 100) {
    fullYear += fullYear >= 70 ? 1900 : 2000;
  }

  const date = new Date(
    Date.UTC(fullYear, Number(month) - 1, Number(day), 0, 0, 0, 0)
  );

  if (
    date.getUTCFullYear() !== fullYear ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return formatDate(date);
}

function parseDate(text, options = {}) {
  const normalized = normalizeText(text);
  const today = todayInTimeZone(options.timeZone, options.currentDate);
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const explicitDate = normalized.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);

  if (explicitDate) {
    return dateFromParts(explicitDate[1], explicitDate[2], explicitDate[3]);
  }

  if (/\bhom kia\b/.test(normalized)) {
    return formatDate(addDays(todayDate, -2));
  }

  if (/\bhom qua\b/.test(normalized)) {
    return formatDate(addDays(todayDate, -1));
  }

  if (/\bngay mai\b/.test(normalized)) {
    return formatDate(addDays(todayDate, 1));
  }

  return today;
}

function monthRange(date) {
  const [year, month] = date.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  return {
    dateFrom: formatDate(start),
    dateTo: formatDate(end),
  };
}

function parseDateRange(text, options = {}) {
  const normalized = normalizeText(text);
  const today = todayInTimeZone(options.timeZone, options.currentDate);
  const todayDate = new Date(`${today}T00:00:00.000Z`);

  if (normalized.includes('thang truoc')) {
    const previous = new Date(
      Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() - 1, 1)
    );

    return monthRange(formatDate(previous));
  }

  if (normalized.includes('thang nay')) {
    return monthRange(today);
  }

  const date = parseDate(text, options);

  return {
    dateFrom: date,
    dateTo: date,
  };
}

function inferType(text) {
  const normalized = normalizeText(text);
  const incomeKeywords = [
    'luong',
    'thu nhap',
    'thuong',
    'freelance',
    'tro cap',
    'duoc tra',
    'duoc cho',
    'me cho',
    'bo cho',
    'cho tien',
    'tang',
    'bieu',
    'li xi',
    'nhan tien',
  ];

  return incomeKeywords.some((keyword) => normalized.includes(keyword))
    ? 'income'
    : 'expense';
}

function inferCategoryKey(text, type) {
  const normalized = normalizeText(text);
  const mappings =
    type === 'income'
      ? [
          { key: 'salary', words: ['luong', 'thuong', 'thu nhap'] },
          {
            key: 'other_income',
            words: ['freelance', 'tro cap', 'cho tien', 'me cho', 'bo cho', 'tang', 'bieu', 'li xi'],
          },
        ]
      : [
          {
            key: 'food',
            words: ['an ', 'an sang', 'an trua', 'an toi', 'cafe', 'ca phe', 'com', 'pho', 'nha hang'],
          },
          { key: 'transport', words: ['xang', 'taxi', 'grab', 'xe', 'gui xe'] },
          { key: 'shopping', words: ['mua', 'shopping', 'quan ao', 'dien tu'] },
          { key: 'bill', words: ['hoa don', 'dien ', 'nuoc', 'internet'] },
          { key: 'entertainment', words: ['phim', 'game', 'giai tri'] },
          { key: 'health', words: ['thuoc', 'kham', 'benh', 'y te'] },
          { key: 'education', words: ['hoc', 'sach', 'giao duc'] },
        ];

  const match = mappings.find((entry) =>
    entry.words.some((word) => normalized.includes(word))
  );

  if (match) return match.key;

  return type === 'income' ? 'salary' : 'other_expense';
}

const categoryAliases = {
  food: ['an uong', 'food'],
  transport: ['di chuyen', 'transport'],
  shopping: ['mua sam', 'shopping'],
  bill: ['hoa don', 'bill'],
  entertainment: ['giai tri', 'entertainment'],
  health: ['y te', 'health'],
  education: ['giao duc', 'education'],
  other_expense: ['khac', 'other'],
  salary: ['thu nhap', 'luong', 'income', 'salary'],
  other_income: ['khac', 'other'],
};

function findCategory(categories, type, key) {
  const parents = categories.filter(
    (category) => category.type === type && !category.parentId
  );
  const aliases = categoryAliases[key] || [];
  const exact = parents.find((category) => {
    const name = normalizeText(category.name);

    return aliases.some((alias) => name.includes(alias));
  });

  return exact || parents[0] || null;
}

module.exports = {
  findCategory,
  inferCategoryKey,
  inferType,
  normalizeText,
  parseDate,
  parseDateRange,
  parseMoney,
  todayInTimeZone,
};
