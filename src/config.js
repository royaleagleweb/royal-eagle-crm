const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'crm.sqlite'),
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'Royal Eagle Web and Marketing <noreply@royaleagleweb.com>',
  },
};
