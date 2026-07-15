const express = require('express');
const { db, transaction } = require('../db');
const { handler, badRequest, notFound, logActivity } = require('../utils/helpers');
const { notifyAllUsers } = require('../services/notifier');

const router = express.Router();

router.get('/', (req, res) => {
  const { status, search } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (search) {
    where.push('(name LIKE ? OR email LIKE ? OR company_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const sql = `SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', handler((req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) throw notFound('Lead not found');
  lead.activities = db.prepare("SELECT * FROM activities WHERE related_type = 'lead' AND related_id = ? ORDER BY created_at DESC").all(lead.id);
  res.json(lead);
}));

router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!b.name) throw badRequest('name is required');
  const info = db.prepare(`
    INSERT INTO leads (name, email, phone, company_name, source, status, estimated_value, notes, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.name, b.email ?? null, b.phone ?? null, b.company_name ?? null, b.source ?? null,
         b.status ?? 'new', b.estimated_value ?? 0, b.notes ?? null, b.owner_id ?? req.user.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);
  // Small team tool: push everyone who has notifications on, rather than resolving owners/admins.
  notifyAllUsers({ title: 'New lead', body: `New lead: ${lead.name}`, url: '#/leads' })
    .catch((err) => console.error('[push] new lead notify failed:', err.message));
  res.status(201).json(lead);
}));

router.patch('/:id', handler((req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) throw notFound('Lead not found');
  if (lead.status === 'converted') throw badRequest('Converted leads cannot be edited');
  const b = { ...lead, ...req.body };
  if (b.status === 'converted') throw badRequest('Use POST /api/leads/:id/convert to convert a lead');
  db.prepare(`
    UPDATE leads SET name = ?, email = ?, phone = ?, company_name = ?, source = ?, status = ?,
      estimated_value = ?, notes = ?, owner_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(b.name, b.email, b.phone, b.company_name, b.source, b.status, b.estimated_value, b.notes, b.owner_id, lead.id);
  res.json(db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id));
}));

// Converts a lead into a contact (+ optional company) and an open deal.
router.post('/:id/convert', handler((req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) throw notFound('Lead not found');
  if (lead.status === 'converted') throw badRequest('Lead is already converted');

  const { create_deal = true, deal_title, deal_value } = req.body || {};

  const result = transaction(() => {
    let companyId = null;
    if (lead.company_name) {
      const existing = db.prepare('SELECT id FROM companies WHERE name = ? COLLATE NOCASE').get(lead.company_name);
      companyId = existing
        ? existing.id
        : db.prepare('INSERT INTO companies (name, owner_id) VALUES (?, ?)').run(lead.company_name, lead.owner_id).lastInsertRowid;
    }

    const [firstName, ...rest] = lead.name.trim().split(/\s+/);
    const contactId = db.prepare(`
      INSERT INTO contacts (company_id, first_name, last_name, email, phone, source, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(companyId, firstName, rest.join(' ') || null, lead.email, lead.phone, lead.source, lead.owner_id).lastInsertRowid;

    let dealId = null;
    if (create_deal) {
      const firstStage = db.prepare('SELECT id FROM deal_stages ORDER BY position LIMIT 1').get();
      dealId = db.prepare(`
        INSERT INTO deals (title, company_id, contact_id, stage_id, value, owner_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(deal_title || `Deal – ${lead.name}`, companyId, contactId,
             firstStage ? firstStage.id : null, deal_value ?? lead.estimated_value ?? 0, lead.owner_id).lastInsertRowid;
    }

    db.prepare(`
      UPDATE leads SET status = 'converted', converted_contact_id = ?, converted_deal_id = ?,
        updated_at = datetime('now') WHERE id = ?
    `).run(contactId, dealId, lead.id);

    logActivity({ content: `Lead "${lead.name}" converted`, relatedType: 'lead', relatedId: lead.id, userId: req.user.id });
    return { companyId, contactId, dealId };
  });

  res.json({
    lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id),
    contact: db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.contactId),
    company: result.companyId ? db.prepare('SELECT * FROM companies WHERE id = ?').get(result.companyId) : null,
    deal: result.dealId ? db.prepare('SELECT * FROM deals WHERE id = ?').get(result.dealId) : null,
  });
}));

router.delete('/:id', handler((req, res) => {
  const info = db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('Lead not found');
  res.status(204).end();
}));

module.exports = router;
