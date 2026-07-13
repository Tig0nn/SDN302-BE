const nodemailer = require('nodemailer');
const env = require('../../config/env');

function hasBrevoConfig() {
  return Boolean(env.BREVO_API_KEY && env.BREVO_FROM);
}

function hasSmtpConfig() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}

function getEmailProvider() {
  const configuredProvider = env.EMAIL_PROVIDER.trim().toLowerCase();

  if (configuredProvider) return configuredProvider;
  if (hasBrevoConfig()) return 'brevo';
  if (hasSmtpConfig()) return 'smtp';

  return '';
}

function assertEmailDeliveryConfig() {
  const provider = getEmailProvider();

  if (provider === 'brevo' && hasBrevoConfig()) return;
  if (provider === 'smtp' && hasSmtpConfig()) return;

  if (env.NODE_ENV !== 'production') {
    return;
  }

  const err = new Error('Email delivery is not configured');

  if (provider === 'brevo') {
    err.code = 'BREVO_NOT_CONFIGURED';
  } else if (provider === 'smtp') {
    err.code = 'SMTP_NOT_CONFIGURED';
  } else {
    err.code = 'EMAIL_DELIVERY_NOT_CONFIGURED';
  }
  err.status = 500;
  throw err;
}

function createTransporter() {
  assertEmailDeliveryConfig();

  if (!hasSmtpConfig()) {
    return null;
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    connectionTimeout: env.SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: env.SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: env.SMTP_SOCKET_TIMEOUT_MS,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
}

function buildOtpEmail(code) {
  return {
    subject: 'Ma xac thuc Vi Vi Vu',
    text: [
      'Xin chao,',
      '',
      `Ma xac thuc Vi Vi Vu cua ban la: ${code}`,
      `Ma nay se het han sau ${env.OTP_TTL_MINUTES} phut.`,
      '',
      'Neu ban khong yeu cau ma nay, hay bo qua email nay.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
        <h2>Ma xac thuc Vi Vi Vu</h2>
        <p>Ma xac thuc cua ban la:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
        <p>Ma nay se het han sau ${env.OTP_TTL_MINUTES} phut.</p>
        <p>Neu ban khong yeu cau ma nay, hay bo qua email nay.</p>
      </div>
    `,
  };
}

function buildPasswordResetOtpEmail(code) {
  return {
    subject: 'Dat lai mat khau Vi Vi Vu',
    text: [
      'Xin chao,',
      '',
      `Ma dat lai mat khau Vi Vi Vu cua ban la: ${code}`,
      `Ma nay se het han sau ${env.OTP_TTL_MINUTES} phut.`,
      '',
      'Neu ban khong yeu cau dat lai mat khau, hay bo qua email nay.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
        <h2>Dat lai mat khau Vi Vi Vu</h2>
        <p>Ma dat lai mat khau cua ban la:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
        <p>Ma nay se het han sau ${env.OTP_TTL_MINUTES} phut.</p>
        <p>Neu ban khong yeu cau dat lai mat khau, hay bo qua email nay.</p>
      </div>
    `,
  };
}

function parseBrevoSender(from) {
  const match = from.match(/^\s*(?:"?([^"<]+)"?\s*)?<([^<>@\s]+@[^<>\s]+)>\s*$/);

  if (!match) {
    return { email: from.trim() };
  }

  return {
    name: match[1]?.trim(),
    email: match[2].trim(),
  };
}

async function sendWithBrevo(email, content) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.BREVO_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${env.BREVO_API_BASE_URL.replace(/\/+$/, '')}/smtp/email`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'api-key': env.BREVO_API_KEY,
        },
        body: JSON.stringify({
          sender: parseBrevoSender(env.BREVO_FROM),
          to: [{ email }],
          subject: content.subject,
          textContent: content.text,
          htmlContent: content.html,
        }),
        signal: controller.signal,
      }
    );

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const err = new Error(
        payload?.message || payload?.error || 'Brevo email delivery failed'
      );

      err.code = 'BREVO_DELIVERY_FAILED';
      err.status = 502;
      throw err;
    }

    return {
      delivered: true,
      provider: 'brevo',
      messageId: payload?.messageId || null,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Brevo email delivery timed out');

      timeoutErr.code = 'BREVO_TIMEOUT';
      timeoutErr.status = 502;
      throw timeoutErr;
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendWithSmtp(email, content) {
  const transporter = createTransporter();

  if (!transporter) {
    return null;
  }

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: email,
    ...content,
  });

  return {
    delivered: true,
    provider: 'smtp',
  };
}

async function sendOtpEmail(email, code, content, logMessage) {
  assertEmailDeliveryConfig();
  const provider = getEmailProvider();

  if (provider === 'brevo' && hasBrevoConfig()) {
    return sendWithBrevo(email, content);
  }

  if (provider === 'smtp' && hasSmtpConfig()) {
    return sendWithSmtp(email, content);
  }

  if (env.NODE_ENV !== 'production') {
    console.info({
      email,
      code,
      message: logMessage,
    });

    return { delivered: false };
  }

  return { delivered: false };
}

async function sendSignupOtp(email, code) {
  return sendOtpEmail(
    email,
    code,
    buildOtpEmail(code),
    'Email delivery is not configured; OTP logged for local development only.'
  );
}

async function sendPasswordResetOtp(email, code) {
  return sendOtpEmail(
    email,
    code,
    buildPasswordResetOtpEmail(code),
    'Email delivery is not configured; password reset OTP logged for local development only.'
  );
}

module.exports = {
  assertEmailDeliveryConfig,
  sendSignupOtp,
  sendPasswordResetOtp,
};
