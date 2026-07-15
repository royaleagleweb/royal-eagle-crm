const express = require('express');
const { db } = require('../db');
const { handler, badRequest, notFound } = require('../utils/helpers');

const router = express.Router();

router.get('/', (req, res) => {
  const { search, company_id } = req.query;
  const where = [];
  const params = [];
  if (search) {
    where.push('(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (company_id) {
    where.push('c.company_id = ?');
    params.push(company_id);
  }
  const sql = `
    SELECT c.*, co.name AS company_name FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.first_name, c.last_name`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', handler((req, res) => {
  const contact = db.prepare(`
    SELECT c.*, co.name AS company_name FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id WHERE c.id = ?
  `).get(req.params.id);
  if (!contact) throw notFound('Contact not found');
  contact.deals = db.prepare('SELECT * FROM deals WHERE contact_id = ? ORDER BY created_at DESC').all(contact.id);
  contact.activities = db.prepare("SELECT * FROM activities WHERE related_type = 'contact' AND related_id = ? ORDER BY created_at DESC").all(contact.id);
  res.json(contact);
}));

router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!b.first_name) throw badRequest('first_name is required');
  const info = db.prepare(`
    INSERT INTO contacts (company_id, first_name, last_name, email, phone, job_title, source, notes, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.company_id ?? null, b.first_name, b.last_name ?? null, b.email ?? null, b.phone ?? null,
         b.job_title ?? null, b.source ?? null, b.notes ?? null, b.owner_id ?? req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid));
}));

router.patch('/:id', handler((req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) throw notFound('Contact not found');
  const b = { ...contact, ...req.body };
  db.prepare(`
    UPDATE contacts SET company_id = ?, first_name = ?, last_name = ?, email = ?, phone = ?,
      job_title = ?, source = ?, notes = ?, owner_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(b.company_id, b.first_name, b.last_name, b.email, b.phone, b.job_title, b.source, b.notes, b.owner_id, contact.id);
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id));
}));

router.delete('/:id', handler((req, res) => {
  const info = db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('Contact not found');
  res.status(204).end();
}));

module.exports = router;
