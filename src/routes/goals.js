const express = require('express');
const { db } = require('../db');
const { handler, badRequest, notFound } = require('../utils/helpers');

const router = express.Router();

const AREAS = ['business', 'health', 'finance', 'relationships', 'growth', 'other'];
const STATUSES = ['active', 'done', 'abandoned'];

router.get('/', (req, res) => {
  const { status, area } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (area) { where.push('area = ?'); params.push(area); }
  const sql = `SELECT * FROM goals ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY status = 'active' DESC, target_date IS NULL, target_date, id DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', handler((req, res) => {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
  if (!goal) throw notFound('Goal not found');
  res.json(goal);
}));

router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!b.title) throw badRequest('title is required');
  if (b.area && !AREAS.includes(b.area)) throw badRequest(`area must be one of: ${AREAS.join(', ')}`);
  const info = db.prepare(`
    INSERT INTO goals (title, area, description, target_date, target_value, current_value, unit, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.title, b.area ?? 'other', b.description ?? null, b.target_date ?? null,
         b.target_value ?? null, b.current_value ?? 0, b.unit ?? null, b.owner_id ?? req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid));
}));

router.patch('/:id', handler((req, res) => {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
  if (!goal) throw notFound('Goal not found');
  const b = { ...goal, ...req.body };
  if (b.area && !AREAS.includes(b.area)) throw badRequest(`area must be one of: ${AREAS.join(', ')}`);
  if (b.status && !STATUSES.includes(b.status)) throw badRequest(`status must be one of: ${STATUSES.join(', ')}`);
  const completedAt = b.status === 'done' && goal.status !== 'done' ? new Date().toISOString() : (b.status !== 'done' ? null : goal.completed_at);
  db.prepare(`
    UPDATE goals SET title = ?, area = ?, description = ?, target_date = ?, status = ?,
      target_value = ?, current_value = ?, unit = ?, completed_at = ?, updated_at = datetime('now') WHERE id = ?
  `).run(b.title, b.area, b.description, b.target_date, b.status, b.target_value, b.current_value, b.unit, completedAt, goal.id);
  res.json(db.prepare('SELECT * FROM goals WHERE id = ?').get(goal.id));
}));

router.delete('/:id', handler((req, res) => {
  const info = db.prepare('DELETE FROM goals WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('Goal not found');
  res.status(204).end();
}));

module.exports = router;
