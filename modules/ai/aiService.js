const { z } = require('zod');
const env = require('../../config/env');
const analyticsRepository = require('../analytics/analyticsRepository');
const budgetRepository = require('../budgets/budgetRepository');
const categoryRepository = require('../categories/categoryRepository');
const paymentAccountRepository = require('../paymentAccounts/paymentAccountRepository');
const transactionRepository = require('../transactions/transactionRepository');
const aiRepository = require('./aiRepository');
const geminiService = require('./geminiService');
const parser = require('./parser');

const SYSTEM_PROMPT = [
  'Ban la tro ly tai chinh ca nhan cho ung dung Vi Vi Vu.',
  'Tra loi bang tieng Viet ngan gon, khong tu luu giao dich neu nguoi dung chua xac nhan.',
  'Khi can du lieu so du, tong thu, tong chi, giao dich, ngan sach, hay dua vao toolResult do backend cung cap.',
  'Tat ca so tien la VND integer. Khong bao gio hoi hoac ghi log Gemini API key.',
].join(' ');

const receiptItemSchema = z.object({
  name: z.string().trim().min(1).max(160).nullable().optional(),
  quantity: z.coerce.number().positive().nullable().optional(),
  amountVnd: z.coerce.number().int().nonnegative().nullable().optional(),
});
const receiptSchema = z.object({
  merchantName: z.string().trim().min(1).max(160).nullable().optional(),
  description: z.string().trim().min(1).max(300).nullable().optional(),
  transactionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  totalAmountVnd: z.coerce.number().int().positive().nullable().optional(),
  amount: z.coerce.number().int().positive().nullable().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  categoryName: z.string().trim().min(1).max(120).nullable().optional(),
  category: z.string().trim().min(1).max(120).nullable().optional(),
  paymentMethod: z.string().trim().min(1).max(40).nullable().optional(),
  paymentAccountName: z.string().trim().min(1).max(120).nullable().optional(),
  items: z.array(receiptItemSchema).max(100).default([]),
  suggestedNote: z.string().trim().max(500).nullable().optional(),
  confidence: z.coerce.number().min(0).max(1).nullable().optional(),
  rawText: z.string().trim().max(2000).nullable().optional(),
});

function appError(code, message, status) {
  const err = new Error(message);

  err.code = code;
  err.status = status;
  return err;
}

function missingFieldError(field) {
  return appError('AI_ACTION_MISSING_FIELD', `${field} is required`, 400);
}

function unsupportedActionError(action) {
  return appError('AI_ACTION_NOT_SUPPORTED', `Unsupported AI action: ${action}`, 400);
}

function bulkDeleteConfirmationError() {
  return appError(
    'AI_BULK_DELETE_CONFIRMATION_REQUIRED',
    'Bulk delete actions require payload.confirmed=true',
    409
  );
}

function conversationLedgerMismatchError() {
  return appError(
    'AI_CONVERSATION_LEDGER_MISMATCH',
    'Conversation does not belong to the requested ledger',
    409
  );
}

function receiptParseError() {
  return appError(
    'AI_RECEIPT_PARSE_FAILED',
    'Gemini did not return a valid receipt payload',
    502
  );
}

function getClarification(missingFields) {
  if (missingFields.includes('amountVnd')) {
    return 'Ban muon ghi giao dich voi so tien bao nhieu?';
  }

  if (missingFields.includes('categoryId')) {
    return 'Ban muon dung danh muc nao cho giao dich nay?';
  }

  return null;
}

function extractTransactionSegments(text) {
  const value = String(text || '').trim();
  const moneyMatches = Array.from(
    value.matchAll(
      /(?<![\d/-])\d+(?:[.,]\d+)?\s*(?:triệu|trieu|tr|m|nghìn|nghin|ngàn|ngan|k)?(?![\d/-])/giu
    )
  ).filter((match) => parser.parseMoney(match[0]));

  if (moneyMatches.length <= 1) return [value];

  return moneyMatches
    .map((match, index) => {
      const previous = moneyMatches[index - 1];
      const start = previous ? previous.index + previous[0].length : 0;
      const end = match.index + match[0].length;

      return value
        .slice(start, end)
        .replace(/^\s*(,|;|\.|và|va|rồi|roi|xong|còn|con)\s+/iu, '')
        .trim();
    })
    .filter(Boolean);
}

async function inferSingleTransactionPreview(userId, payload) {
  const type = parser.inferType(payload.text);
  const amountVnd = parser.parseMoney(payload.text);
  const transactionDate =
    payload.transactionDate ||
    parser.parseDate(payload.text, {
      timeZone: payload.timeZone,
      currentDate: payload.currentDate,
    });
  const categories = await categoryRepository.listCategories(userId, { type });
  const category = parser.findCategory(
    categories,
    type,
    parser.inferCategoryKey(payload.text, type)
  );
  const missingFields = [];

  if (!amountVnd) missingFields.push('amountVnd');
  if (!category) missingFields.push('categoryId');

  return {
    preview: {
      type,
      amountVnd: amountVnd || null,
      categoryId: category?.id || null,
      categoryName: category?.name || null,
      subcategoryId: null,
      transactionDate,
      note: payload.text,
      paymentMethod: payload.paymentMethod || 'cash',
      source: 'ai',
      confidence: amountVnd && category ? 0.86 : 0.45,
      rawText: payload.text,
    },
    missingFields,
    clarification: getClarification(missingFields),
  };
}

async function inferTransactionPreview(userId, payload) {
  const segments = extractTransactionSegments(payload.text);
  const previews = [];
  const missingFieldSet = new Set();

  for (const segment of segments) {
    const result = await inferSingleTransactionPreview(userId, {
      ...payload,
      text: segment,
    });

    previews.push(result.preview);
    result.missingFields.forEach((field) => missingFieldSet.add(field));
  }

  const missingFields = Array.from(missingFieldSet);

  return {
    preview: previews[0],
    previews,
    missingFields,
    clarification: getClarification(missingFields),
  };
}

function parseActionPayload(action, payload) {
  if (action === 'createTransaction') {
    return {
      ...payload,
      source: 'ai',
    };
  }

  return payload;
}

async function executeAction(userId, action, payload) {
  const normalizedPayload = parseActionPayload(action, payload || {});

  if (action === 'createTransaction') {
    const transaction = await transactionRepository.createTransaction(
      userId,
      normalizedPayload
    );

    return { action, transaction };
  }

  if (action === 'deleteTransaction') {
    if (!normalizedPayload.transactionId) {
      throw missingFieldError('transactionId');
    }

    const transaction = await transactionRepository.deleteTransaction(
      userId,
      normalizedPayload.transactionId
    );

    return { action, transaction };
  }

  if (action === 'deleteMultipleTransactions') {
    const transactionIds = normalizedPayload.transactionIds || [];

    if (transactionIds.length === 0) {
      throw missingFieldError('transactionIds');
    }

    if (normalizedPayload.confirmed !== true) {
      throw bulkDeleteConfirmationError();
    }

    const transactions = [];

    transactions.push(
      ...(await transactionRepository.bulkDeleteTransactions(userId, transactionIds))
    );

    return { action, transactions };
  }

  if (action === 'getTransactionsByDateRange') {
    const result = await transactionRepository.listTransactions(userId, {
      ledgerId: normalizedPayload.ledgerId,
      dateFrom: normalizedPayload.dateFrom,
      dateTo: normalizedPayload.dateTo,
      type: normalizedPayload.type,
      categoryId: normalizedPayload.categoryId,
      search: normalizedPayload.search,
      page: normalizedPayload.page || 1,
      pageSize: normalizedPayload.pageSize || 20,
    });

    return { action, ...result };
  }

  if (['getBalance', 'getTotalIncome', 'getTotalExpense'].includes(action)) {
    const summary = await transactionRepository.getSummary(userId, {
      ledgerId: normalizedPayload.ledgerId,
      dateFrom: normalizedPayload.dateFrom,
      dateTo: normalizedPayload.dateTo,
    });

    return { action, summary };
  }

  if (action === 'getBudgetStatus') {
    const budgets = await budgetRepository.listBudgets(userId, {
      ledgerId: normalizedPayload.ledgerId,
      month: `${normalizedPayload.month}-01`,
    });

    return { action, budgets };
  }

  if (action === 'getTopCategories') {
    const categories = await analyticsRepository.getCategoryBreakdown(userId, {
      ledgerId: normalizedPayload.ledgerId,
      type: normalizedPayload.type || 'expense',
      dateFrom: normalizedPayload.dateFrom,
      dateTo: normalizedPayload.dateTo,
      limit: normalizedPayload.limit || 5,
    });

    return { action, categories };
  }

  throw unsupportedActionError(action);
}

function detectToolIntent(message) {
  const normalized = parser.normalizeText(message);

  if (normalized.includes('tieu gi nhieu') || normalized.includes('danh muc')) {
    return 'getTopCategories';
  }

  if (normalized.includes('so du') || normalized.includes('con bao nhieu')) {
    return 'getBalance';
  }

  if (normalized.includes('tong chi') || normalized.includes('da tieu')) {
    return 'getTotalExpense';
  }

  if (normalized.includes('tong thu') || normalized.includes('thu nhap')) {
    return 'getTotalIncome';
  }

  if (
    normalized.includes('ngan sach') ||
    normalized.includes('con lai bao nhieu de chi')
  ) {
    return 'getBudgetStatus';
  }

  if (
    normalized.includes('giao dich') ||
    normalized.includes('chi tieu gan day') ||
    normalized.includes('lich su')
  ) {
    return 'getTransactionsByDateRange';
  }

  return null;
}

function buildToolPayload(action, message, payload) {
  const range = parser.parseDateRange(message, {
    timeZone: payload.timeZone,
    currentDate: payload.currentDate,
  });

  if (action === 'getTopCategories') {
    return {
      ledgerId: payload.ledgerId,
      type: 'expense',
      limit: 5,
      ...range,
    };
  }

  if (action === 'getBudgetStatus') {
    const today = parser.todayInTimeZone(payload.timeZone, payload.currentDate);

    return {
      ledgerId: payload.ledgerId,
      month: today.slice(0, 7),
    };
  }

  if (action === 'getTransactionsByDateRange') {
    return {
      ledgerId: payload.ledgerId,
      page: 1,
      pageSize: 20,
      ...range,
    };
  }

  return {
    ledgerId: payload.ledgerId,
    ...range,
  };
}

function stringifyToolPayload(payload) {
  if (!payload) return '';

  return JSON.stringify(payload);
}

function formatHistoryMessage(message) {
  if (message.role === 'tool') {
    return `tool ${message.functionName || 'unknown'}: ${stringifyToolPayload(
      message.functionPayload
    )}`;
  }

  return `${message.role}: ${message.content || ''}`;
}

function formatHistory(messages) {
  if (!messages.length) return '';

  return ['Lich su hoi thoai gan day:', ...messages.map(formatHistoryMessage)].join('\n');
}

function assertConversationLedger(conversation, ledgerId) {
  if (conversation.ledgerId && conversation.ledgerId !== ledgerId) {
    throw conversationLedgerMismatchError();
  }
}

async function getChatHistory(userId, payload) {
  if (!payload.conversationId) return [];

  const conversation = await aiRepository.assertConversation(
    userId,
    payload.conversationId
  );

  assertConversationLedger(conversation, payload.ledgerId);

  return aiRepository.listRecentMessages(
    userId,
    payload.conversationId,
    envSafeHistoryLimit()
  );
}

function envSafeHistoryLimit() {
  const limit = Number(env.AI_CHAT_HISTORY_LIMIT || 12);

  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 12;
}

async function maybeSaveChat(userId, payload, assistantText, toolName, toolResult) {
  if (!payload.saveHistory) return null;

  const conversation = await aiRepository.getOrCreateConversation(userId, {
    conversationId: payload.conversationId,
    ledgerId: payload.ledgerId,
    title: payload.message.slice(0, 80),
  });

  await aiRepository.addMessage(userId, {
    conversationId: conversation.id,
    role: 'user',
    content: payload.message,
  });

  if (toolName) {
    await aiRepository.addMessage(userId, {
      conversationId: conversation.id,
      role: 'tool',
      functionName: toolName,
      functionPayload: toolResult,
    });
  }

  await aiRepository.addMessage(userId, {
    conversationId: conversation.id,
    role: 'assistant',
    content: assistantText,
  });

  return conversation;
}

async function chat(userId, payload, apiKey) {
  await aiRepository.assertLedger(userId, payload.ledgerId);

  const history = await getChatHistory(userId, payload);
  const toolName = detectToolIntent(payload.message);
  const toolResult = toolName
    ? await executeAction(userId, toolName, buildToolPayload(toolName, payload.message, payload))
    : null;
  const currentDate = parser.todayInTimeZone(payload.timeZone, payload.currentDate);
  const prompt = [
    SYSTEM_PROMPT,
    `Ngay hien tai theo Asia/Ho_Chi_Minh: ${currentDate}.`,
    formatHistory(history),
    `Tin nhan nguoi dung: ${payload.message}`,
    toolResult ? `toolResult: ${JSON.stringify(toolResult)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const result = await geminiService.generateContent(apiKey, {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  });
  const conversation = await maybeSaveChat(
    userId,
    payload,
    result.text,
    toolName,
    toolResult
  );

  return {
    message: result.text,
    toolName,
    toolResult,
    conversation,
  };
}

function stripJsonMarkdown(text) {
  const value = String(text || '').trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  if (fenced) return fenced[1].trim();

  return value;
}

function parseReceiptJson(text) {
  const jsonText = stripJsonMarkdown(text);
  let receipt;

  try {
    receipt = JSON.parse(jsonText);
  } catch (err) {
    throw receiptParseError();
  }

  const parsed = receiptSchema.safeParse(receipt);

  if (!parsed.success) {
    throw receiptParseError();
  }

  return parsed.data;
}

function normalizeRawPaymentMethod(value) {
  if (!value) return null;

  const normalized = parser.normalizeText(value);

  if (/\bcash\b|tien mat/.test(normalized)) return 'cash';
  if (/chuyen khoan|transfer|bank|momo|zalopay|vnpay|shopeepay/.test(normalized)) {
    return 'transfer';
  }

  return null;
}

function normalizeReceipt(receipt) {
  const totalAmountVnd = receipt.totalAmountVnd || receipt.amount || null;
  const transactionDate = receipt.transactionDate || receipt.date || null;
  const categoryName = receipt.categoryName || receipt.category || null;
  const paymentMethod = normalizeRawPaymentMethod(receipt.paymentMethod);
  const description =
    receipt.description ||
    receipt.suggestedNote ||
    receipt.merchantName ||
    categoryName ||
    null;

  return {
    ...receipt,
    totalAmountVnd,
    transactionDate,
    categoryName,
    paymentMethod,
    description,
    confidence:
      typeof receipt.confidence === 'number' && Number.isFinite(receipt.confidence)
        ? receipt.confidence
        : totalAmountVnd
          ? 0.72
          : 0.45,
  };
}

function receiptLegacyPayload(receipt) {
  return {
    amount: receipt.totalAmountVnd || null,
    date: receipt.transactionDate || null,
    description: receipt.description || receipt.merchantName || '',
    category: receipt.categoryName || null,
  };
}

function findCategoryByName(categories, type, name) {
  if (!name) return null;

  const normalizedName = parser.normalizeText(name);

  return (
    categories.find((category) => {
      if (category.type !== type || category.parentId) return false;

      return parser.normalizeText(category.name) === normalizedName;
    }) || null
  );
}

function findReceiptCategory(categories, receipt) {
  const type = 'expense';
  const text = [
    receipt.categoryName,
    receipt.description,
    receipt.merchantName,
    receipt.suggestedNote,
    receipt.rawText,
  ]
    .filter(Boolean)
    .join(' ');
  const exact = findCategoryByName(categories, type, receipt.categoryName);

  if (exact) return exact;

  return parser.findCategory(
    categories,
    type,
    parser.inferCategoryKey(text || receipt.categoryName || '', type)
  );
}

function normalizePaymentMethod(receipt, preferredPaymentMethod) {
  if (preferredPaymentMethod) return preferredPaymentMethod;

  const normalized = parser.normalizeText(
    [
      receipt.paymentMethod,
      receipt.description,
      receipt.suggestedNote,
      receipt.paymentAccountName,
      receipt.rawText,
    ]
      .filter(Boolean)
      .join(' ')
  );

  if (/\bcash\b|tien mat/.test(normalized)) return 'cash';

  return /chuyen khoan|transfer|bank|momo|zalopay|vnpay|shopeepay/.test(normalized)
    ? 'transfer'
    : 'cash';
}

function findPaymentAccountByName(accounts, name) {
  if (!name) return null;

  const normalizedName = parser.normalizeText(name);

  return (
    accounts.find((account) => {
      const names = [account.name, account.shortName].filter(Boolean);

      return names.some((candidate) =>
        parser.normalizeText(candidate).includes(normalizedName)
      );
    }) || null
  );
}

async function findReceiptPaymentAccount(userId, receipt, paymentMethod) {
  if (paymentMethod !== 'transfer') return null;

  const accounts = await paymentAccountRepository.listPaymentAccounts(userId);
  const searchableText = [
    receipt.paymentAccountName,
    receipt.description,
    receipt.suggestedNote,
    receipt.rawText,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    findPaymentAccountByName(accounts, receipt.paymentAccountName) ||
    accounts.find((account) => {
      const normalized = parser.normalizeText(searchableText);
      const names = [account.name, account.shortName].filter(Boolean);

      return names.some((candidate) =>
        normalized.includes(parser.normalizeText(candidate))
      );
    }) ||
    null
  );
}

function buildReceiptClarification(missingFields) {
  if (missingFields.includes('amountVnd')) {
    return 'Mình chưa đọc được tổng tiền trên ảnh. Bạn nhập lại số tiền để mình điền giao dịch nhé.';
  }

  if (missingFields.includes('categoryId')) {
    return 'Mình chưa chắc danh mục của hóa đơn này. Bạn chọn danh mục trước khi lưu nhé.';
  }

  if (missingFields.includes('transactionDate')) {
    return 'Mình chưa đọc được ngày giao dịch nên tạm dùng ngày hiện tại. Bạn kiểm tra lại trước khi lưu nhé.';
  }

  return null;
}

async function buildReceiptTransactionPreview(userId, payload, receipt) {
  const type = 'expense';
  const categories = await categoryRepository.listCategories(userId, { type });
  const category = findReceiptCategory(categories, receipt);
  const paymentMethod = normalizePaymentMethod(receipt, payload.preferredPaymentMethod);
  const paymentAccount = await findReceiptPaymentAccount(
    userId,
    receipt,
    paymentMethod
  );
  const transactionDate =
    receipt.transactionDate ||
    parser.todayInTimeZone(payload.timeZone, payload.currentDate);
  const note = (
    receipt.suggestedNote ||
    receipt.description ||
    receipt.merchantName ||
    ''
  ).slice(0, 500);
  const missingFields = [];

  if (!receipt.totalAmountVnd) missingFields.push('amountVnd');
  if (!category) missingFields.push('categoryId');
  if (!receipt.transactionDate) missingFields.push('transactionDate');

  return {
    transactionPreview: {
      type,
      amountVnd: receipt.totalAmountVnd || null,
      categoryId: category?.id || null,
      categoryName: category?.name || receipt.categoryName || null,
      subcategoryId: null,
      transactionDate,
      note,
      paymentMethod,
      paymentAccountId: paymentAccount?.id || null,
      source: 'receipt_scan',
      confidence: receipt.confidence,
      rawText: receipt.rawText || receipt.description || '',
    },
    missingFields,
    clarification: buildReceiptClarification(missingFields),
  };
}

async function scanReceipt(userId, payload, apiKey) {
  await aiRepository.assertLedger(userId, payload.ledgerId);

  const prompt = [
    SYSTEM_PROMPT,
    'Phan tich anh hoa don cua hang hoac anh chup giao dich ngan hang/vi dien tu.',
    'Chi tra ve JSON hop le, khong them markdown.',
    'Schema: merchantName, description, transactionDate, totalAmountVnd, categoryName, paymentMethod, paymentAccountName, items, suggestedNote, confidence, rawText.',
    'paymentMethod chi duoc la cash hoac transfer. Neu khong thay ngay giao dich, de transactionDate null. Neu khong thay tong tien, de totalAmountVnd null.',
  ].join('\n');
  const result = await geminiService.generateContent(apiKey, {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: payload.mimeType,
              data: payload.imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  });
  const receipt = normalizeReceipt(parseReceiptJson(result.text));
  const { transactionPreview, missingFields, clarification } =
    await buildReceiptTransactionPreview(userId, payload, receipt);

  return {
    receipt,
    legacy: receiptLegacyPayload(receipt),
    transactionPreview,
    missingFields,
    clarification,
  };
}

module.exports = {
  chat,
  executeAction,
  inferTransactionPreview,
  listConversations: aiRepository.listConversations,
  listMessages: aiRepository.listMessages,
  scanReceipt,
};
