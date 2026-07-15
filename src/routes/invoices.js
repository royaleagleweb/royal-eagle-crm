const express = require('express');
const { db, transaction, getSetting } = require('../db');
const { handler, badRequest, notFound, nextDocumentNumber, computeTotals, logActivity, addDays, round2 } = require('../utils/helpers');
const { renderDocument } = require('../services/documents');
const { sendEmail } = require('../services/email');
const { notifyUser } = require('../services/notifier');

const router = express.Router();

function loadInvoice(id) {
  const invoice = db.prepare(`
    SELECT i.*, c.name AS company_name FROM invoices i
    LEFT JOIN companies c ON c.id = i.company_id WHERE i.id = ?
  `).get(id);
  if (!invoice) throw notFound('Invoice not found');
  invoice.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position').all(id);
  invoice.payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date').all(id);
  invoice.balance = round2(invoice.total - invoice.amount_paid);
  return invoice;
}

function replaceItems(invoiceId, totals) {
  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
  const insert = db.prepare('INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price, amount, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const item of totals.items) insert.run(invoiceId, item.service_id, item.description, item.quantity, item.unit_price, item.amount, item.position);
}

// Flags sent/partial invoices whose due date has passed as overdue, and push-notifies
// whoever created each invoice that just flipped (simpler than resolving "all admins" —
// the creator is already on the row and is the person who'd chase payment).
function refreshOverdue() {
  const flipping = db.prepare(`
    SELECT id, number, created_by FROM invoices
    WHERE status IN ('sent', 'partial') AND due_date IS NOT NULL AND due_date < date('now')
  `).all();
  if (!flipping.length) return;

  db.prepare(`
    UPDATE invoices SET status = 'overdue', updated_at = datetime('now')
    WHERE status IN ('sent', 'partial') AND due_date IS NOT NULL AND due_date < date('now')
  `).run();

  for (const invoice of flipping) {
    notifyUser(invoice.created_by, {
      title: 'Invoice overdue',
      body: `Invoice ${invoice.number} is now overdue`,
      url: '#/invoices',
    }).catch((err) => console.error('[push] invoice overdue notify failed:', err.message));
  }
}

router.get('/', (req, res) => {
  refreshOverdue();
  const { status, company_id } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('i.status = ?'); params.push(status); }
  if (company_id) { where.push('i.company_id = ?'); params.push(company_id); }
  const sql = `
    SELECT i.*, c.name AS company_name, (i.total - i.amount_paid) AS balance FROM invoices i
    LEFT JOIN companies c ON c.id = i.company_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY i.issue_date DESC, i.id DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', handler((req, res) => {
  refreshOverdue();
  res.json(loadInvoice(req.params.id));
}));

// Print-ready HTML version of the invoice
router.get('/:id/html', handler((req, res) => {
  const invoice = loadInvoice(req.params.id);
  const company = invoice.company_id ? db.prepare('SELECT * FROM companies WHERE id = ?').get(invoice.company_id) : null;
  const contact = invoice.contact_id ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(invoice.contact_id) : null;
  res.type('html').send(renderDocument({ kind: 'invoice', doc: invoice, items: invoice.items, company, contact }));
}));

router.post('/', handler((req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.items) || b.items.length === 0) throw badRequest('At least one line item is required');

  const totals = computeTotals(b.items, {
    discount: b.discount,
    taxRate: b.tax_rate ?? Number(getSetting('default_tax_rate')) ?? 0,
  });

  const id = transaction(() => {
    const number = nextDocumentNumber('invoices', 'invoice_prefix');
    const dueDate = b.due_date ?? addDays(b.issue_date, getSetting('invoice_due_days') || 14);
    const info = db.prepare(`
      INSERT INTO invoices (number, company_id, contact_id, issue_date, due_date,
        subtotal, discount, tax_rate, tax_amount, total, notes, terms, created_by)
      VALUES (?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(number, b.company_id ?? null, b.contact_id ?? null, b.issue_date ?? null, dueDate,
           totals.subtotal, totals.discount, totals.taxRate, totals.taxAmount, totals.total,
           b.notes ?? null, b.terms ?? getSetting('invoice_terms'), req.user.id);
    replaceItems(info.lastInsertRowid, totals);
    return info.lastInsertRowid;
  });
  res.status(201).json(loadInvoice(id));
}));

router.patch('/:id', handler((req, res) => {
  const invoice = loadInvoice(req.params.id);
  if (['paid', 'cancelled'].includes(invoice.status)) throw badRequest(`A ${invoice.status} invoice cannot be edited`);
  if (invoice.amount_paid > 0 && req.body.items) throw badRequest('Line items cannot change after payments were recorded');
  const b = { ...invoice, ...req.body };

  transaction(() => {
    let totals = null;
    if (req.body.items || req.body.discount !== undefined || req.body.tax_rate !== undefined) {
      totals = computeTotals(req.body.items ?? invoice.items, { discount: b.discount, taxRate: b.tax_rate });
      replaceItems(invoice.id, totals);
    }
    db.prepare(`
      UPDATE invoices SET company_id = ?, contact_id = ?, issue_date = ?, due_date = ?,
        subtotal = ?, discount = ?, tax_rate = ?, tax_amount = ?, total = ?, notes = ?, terms = ?,
        updated_at = datetime('now') WHERE id = ?
    `).run(b.company_id, b.contact_id, b.issue_date, b.due_date,
           totals ? totals.subtotal : invoice.subtotal, totals ? totals.discount : invoice.discount,
           totals ? totals.taxRate : invoice.tax_rate, totals ? totals.taxAmount : invoice.tax_amount,
           totals ? totals.total : invoice.total, b.notes, b.terms, invoice.id);
  });
  res.json(loadInvoice(invoice.id));
}));

// Emails the invoice to the client and marks it sent
router.post('/:id/send', handler(async (req, res) => {
  const invoice = loadInvoice(req.params.id);
  if (invoice.status === 'cancelled') throw badRequest('A cancelled invoice cannot be sent');

  const company = invoice.company_id ? db.prepare('SELECT * FROM companies WHERE id = ?').get(invoice.company_id) : null;
  const contact = invoice.contact_id ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(invoice.contact_id) : null;
  const to = req.body?.to || contact?.email || company?.email;
  if (!to) throw badRequest('No recipient email — pass "to" or set an email on the contact/company');

  const html = renderDocument({ kind: 'invoice', doc: invoice, items: invoice.items, company, contact });
  const result = await sendEmail({
    to,
    subject: `Invoice ${invoice.number} from ${getSetting('company_name')}`,
    html,
  });

  if (invoice.status === 'draft') {
    db.prepare("UPDATE invoices SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(invoice.id);
  }
  logActivity({ type: 'email', content: `Invoice ${invoice.number} sent to ${to}`, relatedType: 'invoice', relatedId: invoice.id, userId: req.user.id });
  res.json({ invoice: loadInvoice(invoice.id), email: result });
}));

// Records a payment against the invoice and updates its status
router.post('/:id/payments', handler((req, res) => {
  const invoice = loadInvoice(req.params.id);
  if (invoice.status === 'cancelled') throw badRequest('Payments cannot be recorded on a cancelled invoice');

  const amount = round2(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('A positive payment amount is required');
  if (amount > invoice.balance) throw badRequest(`Payment exceeds the outstanding balance of ${invoice.balance}`);

  transaction(() => {
    db.prepare('INSERT INTO payments (invoice_id, amount, payment_date, method, reference, notes, created_by) VALUES (?, ?, COALESCE(?, date(\'now\')), ?, ?, ?, ?)')
      .run(invoice.id, amount, req.body.payment_date ?? null, req.body.method ?? 'bank_transfer',
           req.body.reference ?? null, req.body.notes ?? null, req.user.id);
    const newPaid = round2(invoice.amount_paid + amount);
    const newStatus = newPaid >= invoice.total ? 'paid' : 'partial';
    db.prepare(`UPDATE invoices SET amount_paid = ?, status = ?, paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END, updated_at = datetime('now') WHERE id = ?`)
      .run(newPaid, newStatus, newStatus, invoice.id);
    logActivity({ content: `Payment of ${amount} recorded on invoice ${invoice.number}`, relatedType: 'invoice', relatedId: invoice.id, userId: req.user.id });
  });
  res.status(201).json(loadInvoice(invoice.id));
}));

router.post('/:id/cancel', handler((req, res) => {
  const invoice = loadInvoice(req.params.id);
  if (invoice.status === 'paid') throw badRequest('A paid invoice cannot be cancelled');
  if (invoice.amount_paid > 0) throw badRequest('An invoice with recorded payments cannot be cancelled');
  db.prepare("UPDATE invoices SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(invoice.id);
  res.json(loadInvoice(invoice.id));
}));

router.delete('/:id', handler((req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.amount_paid > 0) throw badRequest('An invoice with recorded payments cannot be deleted');
  db.prepare('DELETE FROM invoices WHERE id = ?').run(invoice.id);
  res.status(204).end();
}));

module.exports = router;
