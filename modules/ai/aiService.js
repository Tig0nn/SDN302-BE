const analyticsRepository = require('../analytics/analyticsRepository');
const budgetRepository = require('../budgets/budgetRepository');
const categoryRepository = require('../categories/categoryRepository');
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

function getClarification(missingFields) {
  if (missingFields.includes('amountVnd')) {
    return 'Ban muon ghi giao dich voi so tien bao nhieu?';
  }

  if (missingFields.includes('categoryId')) {
    return 'Ban muon dung danh muc nao cho giao dich nay?';
  }

  return null;
}

async function inferTransactionPreview(userId, payload) {
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

    const transactions = [];

    for (const transactionId of transactionIds) {
      transactions.push(await transactionRepository.deleteTransaction(userId, transactionId));
    }

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

  return {
    ledgerId: payload.ledgerId,
    ...range,
  };
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
  const toolName = detectToolIntent(payload.message);
  const toolResult = toolName
    ? await executeAction(userId, toolName, buildToolPayload(toolName, payload.message, payload))
    : null;
  const currentDate = parser.todayInTimeZone(payload.timeZone, payload.currentDate);
  const prompt = [
    SYSTEM_PROMPT,
    `Ngay hien tai theo Asia/Ho_Chi_Minh: ${currentDate}.`,
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

async function scanReceipt(payload, apiKey) {
  const prompt = [
    SYSTEM_PROMPT,
    'Trich xuat hoa don thanh JSON voi cac truong: merchantName, transactionDate, totalAmountVnd, items, suggestedNote.',
    'Chi tra ve JSON hop le, khong them markdown.',
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
  let receipt;

  try {
    receipt = JSON.parse(result.text);
  } catch (err) {
    receipt = {
      rawText: result.text,
    };
  }

  return { receipt };
}

module.exports = {
  chat,
  executeAction,
  inferTransactionPreview,
  listConversations: aiRepository.listConversations,
  listMessages: aiRepository.listMessages,
  scanReceipt,
};
