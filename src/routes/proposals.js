const express = require('express');
const { db, transaction, getSetting } = require('../db');
const { handler, badRequest, notFound, nextDocumentNumber, computeTotals, logActivity, addDays } = require('../utils/helpers');
const { renderDocument } = require('../services/documents');
const { sendEmail } = require('../services/email');

const router = express.Router();

function loadProposal(id) {
  const proposal = db.prepare(`
    SELECT p.*, c.name AS company_name FROM proposals p
    LEFT JOIN companies c ON c.id = p.company_id WHERE p.id = ?
  `).get(id);
  if (!proposal) throw notFound('Proposal not found');
  proposal.items = db.prepare('SELECT * FROM proposal_items WHERE proposal_id = ? ORDER BY position').all(id);
  return proposal;
}

function replaceItems(proposalId, totals) {
  db.prepare('DELETE FROM proposal_items WHERE proposal_id = ?').run(proposalId);
  const insert = db.prepare('INSERT INTO proposal_items (proposal_id, service_id, description, quantity, unit_price, amount, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const item of totals.items) insert.run(proposalId, item.service_id, item.description, item.quantity, item.unit_price, item.amount, item.position);
}

router.get('/', (req, res) => {
  const { status, company_id } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (company_id) { where.push('p.company_id = ?'); params.push(company_id); }
  const sql = `
    SELECT p.*, c.name AS company_name FROM proposals p
    LEFT JOIN companies c ON c.id = p.company_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', handler((req, res) => res.json(loadProposal(req.params.id))));

// Print-ready HTML version of the proposal
router.get('/:id/html', handler((req, res) => {
  const proposal = loadProposal(req.params.id);
  const company = proposal.company_id ? db.prepare('SELECT * FROM companies WHERE id = ?').get(proposal.company_id) : null;
  const contact = proposal.contact_id ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(proposal.contact_id) : null;
  res.type('html').send(renderDocument({ kind: 'proposal', doc: proposal, items: proposal.items, company, contact }));
}));

router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!b.title) throw badRequest('title is required');
  if (!Array.isArray(b.items) || b.items.length === 0) throw badRequest('At least one line item is required');

  const totals = computeTotals(b.items, {
    discount: b.discount,
    taxRate: b.tax_rate ?? Number(getSetting('default_tax_rate')) ?? 0,
  });

  const id = transaction(() => {
    const number = nextDocumentNumber('proposals', 'proposal_prefix');
    const validUntil = b.valid_until ?? addDays(b.issue_date, getSetting('proposal_valid_days') || 30);
    const info = db.prepare(`
      INSERT INTO proposals (number, title, deal_id, company_id, contact_id, issue_date, valid_until,
        subtotal, discount, tax_rate, tax_amount, total, notes, terms, created_by)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(number, b.title, b.deal_id ?? null, b.company_id ?? null, b.contact_id ?? null,
           b.issue_date ?? null, validUntil, totals.subtotal, totals.discount, totals.taxRate,
           totals.taxAmount, totals.total, b.notes ?? null, b.terms ?? getSetting('proposal_terms'), req.user.id);
    replaceItems(info.lastInsertRowid, totals);
    return info.lastInsertRowid;
  });
  res.status(201).json(loadProposal(id));
}));

router.patch('/:id', handler((req, res) => {
  const proposal = loadProposal(req.params.id);
  if (['accepted', 'declined'].includes(proposal.status)) throw badRequest(`A ${proposal.status} proposal cannot be edited`);
  const b = { ...proposal, ...req.body };

  transaction(() => {
    let totals = null;
    if (req.body.items || req.body.discount !== undefined || req.body.tax_rate !== undefined) {
      totals = computeTotals(req.body.items ?? proposal.items, {
        discount: b.discount,
        taxRate: b.tax_rate,
      });
      replaceItems(proposal.id, totals);
    }
    db.prepare(`
      UPDATE proposals SET title = ?, deal_id = ?, company_id = ?, contact_id = ?, issue_date = ?, valid_until = ?,
        subtotal = ?, discount = ?, tax_rate = ?, tax_amount = ?, total = ?, notes = ?, terms = ?,
        updated_at = datetime('now') WHERE id = ?
    `).run(b.title, b.deal_id, b.company_id, b.contact_id, b.issue_date, b.valid_until,
           totals ? totals.subtotal : proposal.subtotal, totals ? totals.discount : proposal.discount,
           totals ? totals.taxRate : proposal.tax_rate, totals ? totals.taxAmount : proposal.tax_amount,
           totals ? totals.total : proposal.total, b.notes, b.terms, proposal.id);
  });
  res.json(loadProposal(proposal.id));
}));

// Emails the proposal to the client and marks it sent
router.post('/:id/send', handler(async (req, res) => {
  const proposal = loadProposal(req.params.id);
  if (['accepted', 'declined'].includes(proposal.status)) throw badRequest(`A ${proposal.status} proposal cannot be re-sent`);

  const company = proposal.company_id ? db.prepare('SELECT * FROM companies WHERE id = ?').get(proposal.company_id) : null;
  const contact = proposal.contact_id ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(proposal.contact_id) : null;
  const to = req.body?.to || contact?.email || company?.email;
  if (!to) throw badRequest('No recipient email — pass "to" or set an email on the contact/company');

  const html = renderDocument({ kind: 'proposal', doc: proposal, items: proposal.items, company, contact });
  const result = await sendEmail({
    to,
    subject: `Proposal ${proposal.number} from ${getSetting('company_name')} — ${proposal.title}`,
    html,
  });

  db.prepare("UPDATE proposals SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(proposal.id);
  logActivity({ type: 'email', content: `Proposal ${proposal.number} sent to ${to}`, relatedType: 'proposal', relatedId: proposal.id, userId: req.user.id });
  res.json({ proposal: loadProposal(proposal.id), email: result });
}));

router.post('/:id/accept', handler((req, res) => {
  const proposal = loadProposal(req.params.id);
  if (proposal.status === 'accepted') throw badRequest('Proposal is already accepted');
  db.prepare("UPDATE proposals SET status = 'accepted', accepted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(proposal.id);
  logActivity({ content: `Proposal ${proposal.number} accepted`, relatedType: 'proposal', relatedId: proposal.id, userId: req.user.id });
  res.json(loadProposal(proposal.id));
}));

router.post('/:id/decline', handler((req, res) => {
  const proposal = loadProposal(req.params.id);
  if (['accepted', 'declined'].includes(proposal.status)) throw badRequest(`Proposal is already ${proposal.status}`);
  db.prepare("UPDATE proposals SET status = 'declined', declined_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(proposal.id);
  logActivity({ content: `Proposal ${proposal.number} declined`, relatedType: 'proposal', relatedId: proposal.id, userId: req.user.id });
  res.json(loadProposal(proposal.id));
}));

// Turns an accepted proposal into a draft invoice with the same line items
router.post('/:id/convert-to-invoice', handler((req, res) => {
  const proposal = loadProposal(req.params.id);
  if (proposal.status !== 'accepted') throw badRequest('Only accepted proposals can be converted to invoices');
  if (proposal.invoice_id) throw badRequest('Proposal was already converted to an invoice');

  const invoiceId = transaction(() => {
    const number = nextDocumentNumber('invoices', 'invoice_prefix');
    const dueDate = addDays(null, getSetting('invoice_due_days') || 14);
    const info = db.prepare(`
      INSERT INTO invoices (number, company_id, contact_id, proposal_id, issue_date, due_date,
        subtotal, discount, tax_rate, tax_amount, total, notes, terms, created_by)
      VALUES (?, ?, ?, ?, date('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(number, proposal.company_id, proposal.contact_id, proposal.id, dueDate,
           proposal.subtotal, proposal.discount, proposal.tax_rate, proposal.tax_amount, proposal.total,
           proposal.notes, getSetting('invoice_terms'), req.user.id);

    const insertItem = db.prepare('INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price, amount, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const item of proposal.items) insertItem.run(info.lastInsertRowid, item.service_id ?? null, item.description, item.quantity, item.unit_price, item.amount, item.position);

    db.prepare("UPDATE proposals SET invoice_id = ?, updated_at = datetime('now') WHERE id = ?").run(info.lastInsertRowid, proposal.id);
    logActivity({ content: `Proposal ${proposal.number} converted to invoice ${number}`, relatedType: 'proposal', relatedId: proposal.id, userId: req.user.id });
    return info.lastInsertRowid;
  });

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  invoice.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position').all(invoiceId);
  res.status(201).json(invoice);
}));

router.delete('/:id', handler((req, res) => {
  const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!proposal) throw notFound('Proposal not found');
  if (proposal.status === 'accepted') throw badRequest('Accepted proposals cannot be deleted');
  db.prepare('DELETE FROM proposals WHERE id = ?').run(proposal.id);
  res.status(204).end();
}));

module.exports = router;
