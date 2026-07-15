const express = require('express');
const { db } = require('../db');
const { handler, badRequest, notFound, dailyStreak, weeklyStreak } = require('../utils/helpers');

const router = express.Router();

const AREAS = ['business', 'health', 'finance', 'relationships', 'growth', 'other'];
const FREQUENCIES = ['daily', 'weekly'];

// Attaches today's/this-week's checkin status and the current streak to a habit row.
function withStatus(habit) {
  const dates = db.prepare('SELECT checkin_date FROM habit_checkins WHERE habit_id = ?').all(habit.id).map((r) => r.checkin_date);
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...habit,
    checked_today: dates.includes(today),
    streak: habit.frequency === 'weekly' ? weeklyStreak(dates) : dailyStreak(dates),
  };
}

router.get('/', (req, res) => {
  const where = req.query.active === 'true' ? 'WHERE is_active = 1' : '';
  const rows = db.prepare(`SELECT * FROM habits ${where} ORDER BY is_active DESC, id`).all();
  res.json(rows.map(withStatus));
});

router.get('/:id', handler((req, res) => {
  const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(req.params.id);
  if (!habit) throw notFound('Habit not found');
  res.json(withStatus(habit));
}));

router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!b.title) throw badRequest('title is required');
  if (b.area && !AREAS.includes(b.area)) throw badRequest(`area must be one of: ${AREAS.join(', ')}`);
  if (b.frequency && !FREQUENCIES.includes(b.frequency)) throw badRequest(`frequency must be one of: ${FREQUENCIES.join(', ')}`);
  const info = db.prepare('INSERT INTO habits (title, area, frequency, owner_id) VALUES (?, ?, ?, ?)')
    .run(b.title, b.area ?? 'other', b.frequency ?? 'daily', b.owner_id ?? req.user.id);
  res.status(201).json(withStatus(db.prepare('SELECT * FROM habits WHERE id = ?').get(info.lastInsertRowid)));
}));

router.patch('/:id', handler((req, res) => {
  const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(req.params.id);
  if (!habit) throw notFound('Habit not found');
  const b = { ...habit, ...req.body };
  if (b.area && !AREAS.includes(b.area)) throw badRequest(`area must be one of: ${AREAS.join(', ')}`);
  if (b.frequency && !FREQUENCIES.includes(b.frequency)) throw badRequest(`frequency must be one of: ${FREQUENCIES.join(', ')}`);
  db.prepare(`UPDATE habits SET title = ?, area = ?, frequency = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(b.title, b.area, b.frequency, b.is_active ? 1 : 0, habit.id);
  res.json(withStatus(db.prepare('SELECT * FROM habits WHERE id = ?').get(habit.id)));
}));

router.delete('/:id', handler((req, res) => {
  const info = db.prepare('DELETE FROM habits WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('Habit not found');
  res.status(204).end();
}));

// Idempotent: checking in twice the same day is a no-op (UNIQUE(habit_id, checkin_date)).
router.post('/:id/checkin', handler((req, res) => {
  const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(req.params.id);
  if (!habit) throw notFound('Habit not found');
  const date = (req.body && req.body.date) || req.query.date || new Date().toISOString().slice(0, 10);
  db.prepare('INSERT OR IGNORE INTO habit_checkins (habit_id, checkin_date) VALUES (?, ?)').run(habit.id, date);
  res.status(201).json(withStatus(habit));
}));

// Undo a mis-click: removes the checkin for the given (or today's) date.
router.delete('/:id/checkin', handler((req, res) => {
  const habit = db.prepare('SELECT * FROM habits WHERE id = ?').get(req.params.id);
  if (!habit) throw notFound('Habit not found');
  const date = (req.body && req.body.date) || req.query.date || new Date().toISOString().slice(0, 10);
  db.prepare('DELETE FROM habit_checkins WHERE habit_id = ? AND checkin_date = ?').run(habit.id, date);
  res.json(withStatus(habit));
}));

module.exports = router;
