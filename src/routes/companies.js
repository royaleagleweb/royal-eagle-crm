const express = require('express');
const { db } = require('../db');
const { handler, badRequest, notFound } = require('../utils/helpers');

const router = express.Router();

router.get('/', (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM companies';
  const params = [];
  if (search) {
    sql += ' WHERE name LIKE ? OR email LIKE ? OR industry LIKE ?';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', handler((req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) throw notFound('Company not found');
  company.contacts = db.prepare('SELECT * FROM contacts WHERE company_id = ? ORDER BY first_name').all(company.id);
  company.deals = db.prepare('SELECT * FROM deals WHERE company_id = ? ORDER BY created_at DESC').all(company.id);
  company.invoices = db.prepare('SELECT id, number, status, issue_date, total, amount_paid FROM invoices WHERE company_id = ? ORDER BY issue_date DESC').all(company.id);
  res.json(company);
}));

router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!b.name) throw badRequest('name is required');
  const info = db.prepare(`
    INSERT INTO companies (name, industry, website, email, phone, address, city, country, notes, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.name, b.industry ?? null, b.website ?? null, b.email ?? null, b.phone ?? null,
         b.address ?? null, b.city ?? null, b.country ?? null, b.notes ?? null, b.owner_id ?? req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM companies WHERE id = ?').get(info.lastInsertRowid));
}));

router.patch('/:id', handler((req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) throw notFound('Company not found');
  const b = { ...company, ...req.body };
  db.prepare(`
    UPDATE companies SET name = ?, industry = ?, website = ?, email = ?, phone = ?, address = ?,
      city = ?, country = ?, notes = ?, owner_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(b.name, b.industry, b.website, b.email, b.phone, b.address, b.city, b.country, b.notes, b.owner_id, company.id);
  res.json(db.prepare('SELECT * FROM companies WHERE id = ?').get(company.id));
}));

router.delete('/:id', handler((req, res) => {
  const info = db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('Company not found');
  res.status(204).end();
}));

module.exports = router;
