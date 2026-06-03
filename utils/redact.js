const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|authorization|api[_-]?key|apikey|gemini|otp|smtp_pass|jwt)/i;

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERN.test(String(key || ''));
}

function redactString(value) {
  let result = String(value || '');

  for (const [key, secret] of Object.entries(process.env)) {
    if (!secret || secret.length < 4 || !isSensitiveKey(key)) continue;

    result = result.split(secret).join('[REDACTED]');
  }

  return result
    .replace(
      /\b(authorization|x-gemini-api-key|x-goog-api-key)\b\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]'
    )
    .replace(
      /\b(accessToken|refreshToken|idToken|password|otpCode|apiKey)\b\s*[:=]\s*[^,\s}]+/gi,
      '$1=[REDACTED]'
    );
}

function redact(value, depth = 0) {
  if (depth > 6) return '[REDACTED_DEPTH]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redact(item, depth + 1),
    ])
  );
}

function maskEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  const [name, domain] = value.split('@');

  if (!name || !domain) return null;

  return `${name.slice(0, 2)}***@${domain}`;
}

module.exports = {
  isSensitiveKey,
  maskEmail,
  redact,
  redactString,
};
