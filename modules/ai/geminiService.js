const env = require('../../config/env');

function geminiKeyError() {
  const err = new Error('Gemini API key is required');

  err.code = 'GEMINI_KEY_REQUIRED';
  err.status = 400;
  return err;
}

function geminiRequestError(message) {
  const err = new Error(message || 'Gemini request failed');

  err.code = 'GEMINI_REQUEST_FAILED';
  err.status = 502;
  return err;
}

function geminiTimeoutError() {
  const err = new Error('Gemini request timed out');

  err.code = 'GEMINI_REQUEST_TIMEOUT';
  err.status = 504;
  return err;
}

function getChatGeminiApiKey() {
  return env.GEMINI_CHAT_API_KEY || '';
}

function requireChatGeminiApiKey() {
  const apiKey = getChatGeminiApiKey();

  if (!apiKey) {
    throw geminiKeyError();
  }

  return apiKey;
}

function getReceiptGeminiApiKey(req) {
  return env.GEMINI_RECEIPT_API_KEY || '';
}

function requireReceiptGeminiApiKey(req) {
  const apiKey = getReceiptGeminiApiKey(req);

  if (!apiKey) {
    throw geminiKeyError();
  }

  return apiKey;
}

function extractText(data) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim() || ''
  );
}

async function generateContent(apiKey, payload) {
  if (!apiKey) {
    throw geminiKeyError();
  }

  if (typeof fetch !== 'function') {
    throw geminiRequestError('Fetch API is not available in this runtime');
  }

  const baseUrl = env.GEMINI_API_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`;
  const controller =
    typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Number(env.GEMINI_TIMEOUT_MS || 0);
  const timeout =
    controller && timeoutMs > 0
      ? setTimeout(function abortGeminiRequest() {
          controller.abort();
        }, timeoutMs)
      : null;
  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw geminiTimeoutError();
    }

    throw geminiRequestError();
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  if (!response.ok) {
    throw geminiRequestError();
  }

  const data = await response.json();

  return {
    text: extractText(data),
    raw: data,
  };
}

module.exports = {
  generateContent,
  getChatGeminiApiKey,
  getReceiptGeminiApiKey,
  requireChatGeminiApiKey,
  requireReceiptGeminiApiKey,
};
