const express = require('express');
const { db } = require('../db');
const { handler, badRequest, notFound } = require('../utils/helpers');

const router = express.Router();

const MOODS = ['great', 'good', 'okay', 'rough', 'bad'];

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json(db.prepare('SELECT * FROM journal_entries ORDER BY entry_date DESC, id DESC LIMIT ?').all(limit));
});

// Today's entry, or null if nothing's been written yet — the portal uses this
// to decide whether "Save" should POST a new entry or PATCH the existing one.
router.get('/today', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const entry = db.prepare('SELECT * FROM journal_entries WHERE entry_date = ? ORDER BY id DESC LIMIT 1').get(today);
  res.json(entry || null);
});

router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!b.content || !String(b.content).trim()) throw badRequest('content is required');
  if (b.mood && !MOODS.includes(b.mood)) throw badRequest(`mood must be one of: ${MOODS.join(', ')}`);
  const info = db.prepare('INSERT INTO journal_entries (entry_date, content, mood, owner_id) VALUES (?, ?, ?, ?)')
    .run(b.entry_date ?? new Date().toISOString().slice(0, 10), b.content, b.mood ?? null, b.owner_id ?? req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(info.lastInsertRowid));
}));

router.patch('/:id', handler((req, res) => {
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id);
  if (!entry) throw notFound('Journal entry not found');
  const b = { ...entry, ...req.body };
  if (b.mood && !MOODS.includes(b.mood)) throw badRequest(`mood must be one of: ${MOODS.join(', ')}`);
  if (!b.content || !String(b.content).trim()) throw badRequest('content is required');
  db.prepare('UPDATE journal_entries SET entry_date = ?, content = ?, mood = ? WHERE id = ?')
    .run(b.entry_date, b.content, b.mood, entry.id);
  res.json(db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entry.id));
}));

router.delete('/:id', handler((req, res) => {
  const info = db.prepare('DELETE FROM journal_entries WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('Journal entry not found');
  res.status(204).end();
}));

module.exports = router;
