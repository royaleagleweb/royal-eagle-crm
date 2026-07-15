const express = require('express');
const { db } = require('../db');
const { handler, badRequest, notFound } = require('../utils/helpers');

const router = express.Router();

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file

router.get('/', (req, res) => {
  const { company_id } = req.query;
  const where = company_id ? 'WHERE f.company_id = ?' : '';
  const params = company_id ? [company_id] : [];
  res.json(db.prepare(`
    SELECT f.id, f.name, f.mime, f.size, f.company_id, f.related_type, f.related_id, f.created_at,
           c.name AS company_name, u.name AS uploaded_by_name
    FROM files f
    LEFT JOIN companies c ON c.id = f.company_id
    LEFT JOIN users u ON u.id = f.uploaded_by
    ${where} ORDER BY f.created_at DESC
  `).all(...params));
});

// Upload as JSON: { name, mime, data (base64), company_id?, related_type?, related_id? }
router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) throw badRequest('name is required');
  if (!b.data) throw badRequest('data (base64) is required');
  let buffer;
  try { buffer = Buffer.from(String(b.data), 'base64'); } catch { throw badRequest('data is not valid base64'); }
  if (buffer.length === 0) throw badRequest('File is empty');
  if (buffer.length > MAX_FILE_BYTES) throw badRequest('File is larger than the 10 MB limit');

  const info = db.prepare(`
    INSERT INTO files (name, mime, size, data, company_id, related_type, related_id, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(String(b.name).trim(), b.mime || 'application/octet-stream', buffer.length, buffer,
         b.company_id ?? null, b.related_type ?? null, b.related_id ?? null, req.user.id);
  const file = db.prepare('SELECT id, name, mime, size, company_id, related_type, related_id, created_at FROM files WHERE id = ?')
    .get(info.lastInsertRowid);
  res.status(201).json(file);
}));

router.get('/:id/download', handler((req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) throw notFound('File not found');
  res.set('Content-Type', file.mime);
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
  res.send(Buffer.from(file.data));
}));

router.delete('/:id', handler((req, res) => {
  const info = db.prepare('DELETE FROM files WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('File not found');
  res.status(204).end();
}));

module.exports = router;
