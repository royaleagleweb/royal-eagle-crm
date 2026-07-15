const express = require('express');
const { db } = require('../db');
const { handler, badRequest, notFound, round2 } = require('../utils/helpers');

const router = express.Router();

// Billed revenue per service across non-cancelled invoices
router.get('/revenue', (req, res) => {
  const rows = db.prepare(`
    SELECT COALESCE(s.name, 'Custom / other') AS service, COUNT(ii.id) AS times_billed,
           ROUND(SUM(ii.amount), 2) AS billed
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id AND i.status != 'cancelled'
    LEFT JOIN services s ON s.id = ii.service_id
    GROUP BY s.id ORDER BY billed DESC
  `).all();
  res.json(rows);
});

router.get('/', (req, res) => {
  const { active } = req.query;
  const sql = active === 'true'
    ? 'SELECT * FROM services WHERE is_active = 1 ORDER BY name'
    : 'SELECT * FROM services ORDER BY name';
  res.json(db.prepare(sql).all());
});

router.get('/:id', handler((req, res) => {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!service) throw notFound('Service not found');
  res.json(service);
}));

router.post('/', handler((req, res) => {
  const b = req.body || {};
  const price = round2(Number(b.unit_price));
  if (!b.name || !String(b.name).trim()) throw badRequest('name is required');
  if (!Number.isFinite(price) || price < 0) throw badRequest('unit_price must be zero or a positive number');
  if (db.prepare('SELECT id FROM services WHERE name = ? COLLATE NOCASE').get(b.name.trim())) {
    throw badRequest('A service with that name already exists');
  }
  const info = db.prepare('INSERT INTO services (name, description, unit_price, unit) VALUES (?, ?, ?, ?)')
    .run(b.name.trim(), b.description ?? null, price, b.unit || 'project');
  res.status(201).json(db.prepare('SELECT * FROM services WHERE id = ?').get(info.lastInsertRowid));
}));

router.patch('/:id', handler((req, res) => {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!service) throw notFound('Service not found');
  const b = { ...service, ...req.body };
  const price = round2(Number(b.unit_price));
  if (!Number.isFinite(price) || price < 0) throw badRequest('unit_price must be zero or a positive number');
  db.prepare(`
    UPDATE services SET name = ?, description = ?, unit_price = ?, unit = ?, is_active = ?,
      updated_at = datetime('now') WHERE id = ?
  `).run(b.name, b.description, price, b.unit, b.is_active ? 1 : 0, service.id);
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(service.id));
}));

router.delete('/:id', handler((req, res) => {
  const used = db.prepare('SELECT COUNT(*) AS n FROM invoice_items WHERE service_id = ?').get(req.params.id).n
    + db.prepare('SELECT COUNT(*) AS n FROM proposal_items WHERE service_id = ?').get(req.params.id).n;
  if (used > 0) throw badRequest('This service appears on invoices or proposals — deactivate it instead of deleting');
  const info = db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('Service not found');
  res.status(204).end();
}));

module.exports = router;
