const nodemailer = require('nodemailer');
const env = require('../../config/env');

function hasSmtpConfig() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}

function assertSmtpConfig() {
  if (hasSmtpConfig()) return;

  if (env.NODE_ENV !== 'production') {
    return;
  }

  const err = new Error('SMTP email delivery is not configured');

  err.code = 'SMTP_NOT_CONFIGURED';
  err.status = 500;
  throw err;
}

function createTransporter() {
  assertSmtpConfig();

  if (!hasSmtpConfig()) {
    return null;
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
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

async function sendSignupOtp(email, code) {
  const transporter = createTransporter();

  if (!transporter) {
    console.info({
      email,
      code,
      message: 'SMTP is not configured; OTP logged for local development only.',
    });

    return { delivered: false };
  }

  const content = buildOtpEmail(code);

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: email,
    ...content,
  });

  return { delivered: true };
}

module.exports = {
  assertSmtpConfig,
  sendSignupOtp,
};
