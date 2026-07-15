const express = require('express');
const { db } = require('../db');
const { handler, badRequest, notFound } = require('../utils/helpers');

const router = express.Router();

const RELATED_TYPES = ['contact', 'company', 'lead', 'deal', 'proposal', 'invoice', 'expense'];
const TYPES = ['note', 'call', 'email', 'meeting'];

router.get('/', (req, res) => {
  const { related_type, related_id, type, limit } = req.query;
  const where = [];
  const params = [];
  if (related_type) { where.push('a.related_type = ?'); params.push(related_type); }
  if (related_id) { where.push('a.related_id = ?'); params.push(related_id); }
  if (type) { where.push('a.type = ?'); params.push(type); }
  const sql = `
    SELECT a.*, u.name AS user_name FROM activities a
    LEFT JOIN users u ON u.id = a.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.created_at DESC LIMIT ?`;
  res.json(db.prepare(sql).all(...params, Math.min(parseInt(limit || '100', 10), 500)));
});

router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!b.content) throw badRequest('content is required');
  if (!RELATED_TYPES.includes(b.related_type)) throw badRequest(`related_type must be one of: ${RELATED_TYPES.join(', ')}`);
  if (!b.related_id) throw badRequest('related_id is required');
  const type = b.type ?? 'note';
  if (!TYPES.includes(type)) throw badRequest(`type must be one of: ${TYPES.join(', ')}`);
  const info = db.prepare('INSERT INTO activities (type, content, related_type, related_id, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(type, b.content, b.related_type, b.related_id, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM activities WHERE id = ?').get(info.lastInsertRowid));
}));

router.delete('/:id', handler((req, res) => {
  const info = db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('Activity not found');
  res.status(204).end();
}));

module.exports = router;
