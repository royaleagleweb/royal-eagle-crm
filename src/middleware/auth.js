const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Account is inactive or does not exist' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { authenticate, requireAdmin };
