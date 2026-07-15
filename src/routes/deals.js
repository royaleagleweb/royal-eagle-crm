const express = require('express');
const { db } = require('../db');
const { handler, badRequest, notFound, logActivity } = require('../utils/helpers');

const router = express.Router();

router.get('/stages', (req, res) => {
  res.json(db.prepare('SELECT * FROM deal_stages ORDER BY position').all());
});

// Kanban-style board: stages with their open deals
router.get('/pipeline', (req, res) => {
  const stages = db.prepare('SELECT * FROM deal_stages ORDER BY position').all();
  const dealsByStage = db.prepare(`
    SELECT d.*, c.name AS company_name FROM deals d
    LEFT JOIN companies c ON c.id = d.company_id
    WHERE d.status = 'open' ORDER BY d.updated_at DESC
  `).all();
  res.json(stages.map((stage) => ({
    ...stage,
    deals: dealsByStage.filter((d) => d.stage_id === stage.id),
    total_value: dealsByStage.filter((d) => d.stage_id === stage.id).reduce((s, d) => s + d.value, 0),
  })));
});

router.get('/', (req, res) => {
  const { status, stage_id, company_id } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (stage_id) { where.push('d.stage_id = ?'); params.push(stage_id); }
  if (company_id) { where.push('d.company_id = ?'); params.push(company_id); }
  const sql = `
    SELECT d.*, s.name AS stage_name, c.name AS company_name,
           ct.first_name || COALESCE(' ' || ct.last_name, '') AS contact_name
    FROM deals d
    LEFT JOIN deal_stages s ON s.id = d.stage_id
    LEFT JOIN companies c ON c.id = d.company_id
    LEFT JOIN contacts ct ON ct.id = d.contact_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY d.created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', handler((req, res) => {
  const deal = db.prepare(`
    SELECT d.*, s.name AS stage_name, c.name AS company_name FROM deals d
    LEFT JOIN deal_stages s ON s.id = d.stage_id
    LEFT JOIN companies c ON c.id = d.company_id
    WHERE d.id = ?
  `).get(req.params.id);
  if (!deal) throw notFound('Deal not found');
  deal.proposals = db.prepare('SELECT id, number, title, status, total FROM proposals WHERE deal_id = ?').all(deal.id);
  deal.activities = db.prepare("SELECT * FROM activities WHERE related_type = 'deal' AND related_id = ? ORDER BY created_at DESC").all(deal.id);
  res.json(deal);
}));

router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!b.title) throw badRequest('title is required');
  const stageId = b.stage_id ?? db.prepare('SELECT id FROM deal_stages ORDER BY position LIMIT 1').get()?.id;
  const info = db.prepare(`
    INSERT INTO deals (title, company_id, contact_id, stage_id, value, expected_close_date, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(b.title, b.company_id ?? null, b.contact_id ?? null, stageId ?? null,
         b.value ?? 0, b.expected_close_date ?? null, b.owner_id ?? req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM deals WHERE id = ?').get(info.lastInsertRowid));
}));

router.patch('/:id', handler((req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) throw notFound('Deal not found');
  const b = { ...deal, ...req.body };
  db.prepare(`
    UPDATE deals SET title = ?, company_id = ?, contact_id = ?, stage_id = ?, value = ?,
      expected_close_date = ?, owner_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(b.title, b.company_id, b.contact_id, b.stage_id, b.value, b.expected_close_date, b.owner_id, deal.id);
  res.json(db.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id));
}));

// Move a deal to another pipeline stage
router.post('/:id/move', handler((req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) throw notFound('Deal not found');
  const stage = db.prepare('SELECT * FROM deal_stages WHERE id = ?').get(req.body?.stage_id);
  if (!stage) throw badRequest('A valid stage_id is required');
  db.prepare("UPDATE deals SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(stage.id, deal.id);
  logActivity({ content: `Deal moved to stage "${stage.name}"`, relatedType: 'deal', relatedId: deal.id, userId: req.user.id });
  res.json(db.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id));
}));

router.post('/:id/win', handler((req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) throw notFound('Deal not found');
  if (deal.status !== 'open') throw badRequest('Only open deals can be won');
  db.prepare("UPDATE deals SET status = 'won', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(deal.id);
  logActivity({ content: `Deal "${deal.title}" marked as won`, relatedType: 'deal', relatedId: deal.id, userId: req.user.id });
  res.json(db.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id));
}));

router.post('/:id/lose', handler((req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) throw notFound('Deal not found');
  if (deal.status !== 'open') throw badRequest('Only open deals can be lost');
  db.prepare("UPDATE deals SET status = 'lost', lost_reason = ?, closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(req.body?.reason ?? null, deal.id);
  logActivity({ content: `Deal "${deal.title}" marked as lost${req.body?.reason ? `: ${req.body.reason}` : ''}`, relatedType: 'deal', relatedId: deal.id, userId: req.user.id });
  res.json(db.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id));
}));

router.delete('/:id', handler((req, res) => {
  const info = db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('Deal not found');
  res.status(204).end();
}));

module.exports = router;
