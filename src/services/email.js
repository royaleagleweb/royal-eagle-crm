const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;
if (config.smtp.host) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

/**
 * Sends an email via SMTP when configured. Without SMTP_HOST it logs the
 * message and resolves, so document "send" flows work in development.
 */
async function sendEmail({ to, subject, html, text }) {
  if (!transporter) {
    console.log(`[email:dev] to=${to} subject="${subject}" (SMTP not configured, email not actually sent)`);
    return { delivered: false, dev: true };
  }
  const info = await transporter.sendMail({ from: config.smtp.from, to, subject, html, text });
  return { delivered: true, messageId: info.messageId };
}

module.exports = { sendEmail, isConfigured: () => Boolean(transporter) };
