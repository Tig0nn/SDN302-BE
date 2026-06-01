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

function getGeminiApiKey(req) {
  return req.get('x-gemini-api-key') || '';
}

function requireGeminiApiKey(req) {
  const apiKey = getGeminiApiKey(req);

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
  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw geminiRequestError();
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
  getGeminiApiKey,
  requireGeminiApiKey,
};
