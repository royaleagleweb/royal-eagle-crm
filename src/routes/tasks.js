const express = require('express');
const { db } = require('../db');
const { handler, badRequest, notFound } = require('../utils/helpers');

const router = express.Router();

const RELATED_TYPES = ['contact', 'company', 'lead', 'deal', 'proposal', 'invoice'];

router.get('/', (req, res) => {
  const { status, assignee_id, related_type, related_id, overdue } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('t.status = ?'); params.push(status); }
  if (assignee_id) { where.push('t.assignee_id = ?'); params.push(assignee_id); }
  if (related_type) { where.push('t.related_type = ?'); params.push(related_type); }
  if (related_id) { where.push('t.related_id = ?'); params.push(related_id); }
  if (overdue === 'true') where.push("t.due_date < date('now') AND t.status NOT IN ('done', 'cancelled')");
  const sql = `
    SELECT t.*, u.name AS assignee_name FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             t.due_date IS NULL, t.due_date`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', handler((req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) throw notFound('Task not found');
  res.json(task);
}));

router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!b.title) throw badRequest('title is required');
  if (b.related_type && !RELATED_TYPES.includes(b.related_type)) throw badRequest(`related_type must be one of: ${RELATED_TYPES.join(', ')}`);
  const info = db.prepare(`
    INSERT INTO tasks (title, description, due_date, priority, status, related_type, related_id, assignee_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.title, b.description ?? null, b.due_date ?? null, b.priority ?? 'medium', b.status ?? 'todo',
         b.related_type ?? null, b.related_id ?? null, b.assignee_id ?? req.user.id, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
}));

router.patch('/:id', handler((req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) throw notFound('Task not found');
  const b = { ...task, ...req.body };
  const completedAt = b.status === 'done' && task.status !== 'done' ? new Date().toISOString() : task.completed_at;
  db.prepare(`
    UPDATE tasks SET title = ?, description = ?, due_date = ?, priority = ?, status = ?,
      related_type = ?, related_id = ?, assignee_id = ?, completed_at = ?, updated_at = datetime('now') WHERE id = ?
  `).run(b.title, b.description, b.due_date, b.priority, b.status, b.related_type, b.related_id,
         b.assignee_id, completedAt, task.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
}));

router.delete('/:id', handler((req, res) => {
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('Task not found');
  res.status(204).end();
}));

module.exports = router;
