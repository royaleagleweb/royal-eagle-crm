const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { handler, badRequest } = require('../utils/helpers');

const router = express.Router();

const signToken = (user) => jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });

// The first registered user becomes the admin; afterwards only admins can add users.
router.post('/register', handler(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) throw badRequest('name, email and password are required');
  if (password.length < 8) throw badRequest('Password must be at least 8 characters');

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount > 0) {
    // Registration is closed once the workspace has an owner — go through POST /users.
    return res.status(403).json({ error: 'Registration is closed. Ask an admin to create your account.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const info = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run(name, email, passwordHash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/login', handler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw badRequest('email and password are required');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

// Admin user management
router.get('/users', authenticate, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, is_active, created_at FROM users ORDER BY id').all());
});

router.post('/users', authenticate, requireAdmin, handler(async (req, res) => {
  const { name, email, password, role = 'staff' } = req.body || {};
  if (!name || !email || !password) throw badRequest('name, email and password are required');
  if (password.length < 8) throw badRequest('Password must be at least 8 characters');
  if (!['admin', 'staff'].includes(role)) throw badRequest('role must be admin or staff');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw badRequest('Email is already in use');

  const passwordHash = await bcrypt.hash(password, 10);
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, passwordHash, role);
  const user = db.prepare('SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(user);
}));

router.patch('/users/:id', authenticate, requireAdmin, handler(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { name, role, is_active, password } = req.body || {};
  if (role && !['admin', 'staff'].includes(role)) throw badRequest('role must be admin or staff');
  const passwordHash = password ? await bcrypt.hash(password, 10) : user.password_hash;
  if (password && password.length < 8) throw badRequest('Password must be at least 8 characters');

  db.prepare("UPDATE users SET name = ?, role = ?, is_active = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(name ?? user.name, role ?? user.role, is_active === undefined ? user.is_active : (is_active ? 1 : 0), passwordHash, user.id);
  res.json(db.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').get(user.id));
}));

module.exports = router;
