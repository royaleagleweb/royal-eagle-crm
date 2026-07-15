// Port of src/routes/invoices.js, including refreshOverdue on list/detail.

import {
  json, noContent, htmlResponse, badRequest, notFound, all, round2,
  nextDocumentNumber, computeTotals, logActivity, addDays, getSetting, getAllSettings,
} from '../helpers.js';
import { renderDocument } from '../documents.js';
import { sendEmail } from '../email.js';

async function loadInvoice(db, id) {
  const invoice = await db.prepare(`
    SELECT i.*, c.name AS company_name FROM invoices i
    LEFT JOIN companies c ON c.id = i.company_id WHERE i.id = ?
  `).bind(id).first();
  if (!invoice) throw notFound('Invoice not found');
  invoice.items = await all(db, 'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position', [id]);
  invoice.payments = await all(db, 'SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date', [id]);
  invoice.balance = round2(invoice.total - invoice.amount_paid);
  return invoice;
}

async function replaceItems(db, invoiceId, totals) {
  const insert = db.prepare('INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price, amount, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
  await db.batch([
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').bind(invoiceId),
    ...totals.items.map((item) => insert.bind(invoiceId, item.service_id, item.description, item.quantity, item.unit_price, item.amount, item.position)),
  ]);
}

// Flags sent/partial invoices whose due date has passed as overdue.
async function refreshOverdue(db) {
  await db.prepare(`
    UPDATE invoices SET status = 'overdue', updated_at = datetime('now')
    WHERE status IN ('sent', 'partial') AND due_date IS NOT NULL AND due_date < date('now')
  `).run();
}

export function registerInvoiceRoutes(add) {
  add('GET', '/api/invoices', async (c) => {
    await refreshOverdue(c.db);
    const { status, company_id } = c.query;
    const where = [];
    const params = [];
    if (status) { where.push('i.status = ?'); params.push(status); }
    if (company_id) { where.push('i.company_id = ?'); params.push(company_id); }
    const sql = `
      SELECT i.*, c.name AS company_name, (i.total - i.amount_paid) AS balance FROM invoices i
      LEFT JOIN companies c ON c.id = i.company_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY i.issue_date DESC, i.id DESC`;
    return json(await all(c.db, sql, params));
  });

  add('GET', '/api/invoices/:id', async (c) => {
    await refreshOverdue(c.db);
    return json(await loadInvoice(c.db, c.params.id));
  });

  // Print-ready HTML version of the invoice
  add('GET', '/api/invoices/:id/html', async (c) => {
    const invoice = await loadInvoice(c.db, c.params.id);
    const company = invoice.company_id ? await c.db.prepare('SELECT * FROM companies WHERE id = ?').bind(invoice.company_id).first() : null;
    const contact = invoice.contact_id ? await c.db.prepare('SELECT * FROM contacts WHERE id = ?').bind(invoice.contact_id).first() : null;
    const settings = await getAllSettings(c.db);
    return htmlResponse(renderDocument({ kind: 'invoice', doc: invoice, items: invoice.items, company, contact, settings }));
  });

  add('POST', '/api/invoices', async (c) => {
    const b = c.body || {};
    if (!Array.isArray(b.items) || b.items.length === 0) throw badRequest('At least one line item is required');

    const totals = computeTotals(b.items, {
      discount: b.discount,
      taxRate: b.tax_rate ?? Number(await getSetting(c.db, 'default_tax_rate')) ?? 0,
    });

    const number = await nextDocumentNumber(c.db, 'invoices', 'invoice_prefix');
    const dueDate = b.due_date ?? addDays(b.issue_date, (await getSetting(c.db, 'invoice_due_days')) || 14);
    const info = await c.db.prepare(`
      INSERT INTO invoices (number, company_id, contact_id, issue_date, due_date,
        subtotal, discount, tax_rate, tax_amount, total, notes, terms, created_by)
      VALUES (?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(number, b.company_id ?? null, b.contact_id ?? null, b.issue_date ?? null, dueDate,
            totals.subtotal, totals.discount, totals.taxRate, totals.taxAmount, totals.total,
            b.notes ?? null, b.terms ?? await getSetting(c.db, 'invoice_terms'), c.user.id).run();
    await replaceItems(c.db, info.meta.last_row_id, totals);
    return json(await loadInvoice(c.db, info.meta.last_row_id), 201);
  });

  add('PATCH', '/api/invoices/:id', async (c) => {
    const invoice = await loadInvoice(c.db, c.params.id);
    if (['paid', 'cancelled'].includes(invoice.status)) throw badRequest(`A ${invoice.status} invoice cannot be edited`);
    if (invoice.amount_paid > 0 && c.body.items) throw badRequest('Line items cannot change after payments were recorded');
    const b = { ...invoice, ...c.body };

    let totals = null;
    if (c.body.items || c.body.discount !== undefined || c.body.tax_rate !== undefined) {
      totals = computeTotals(c.body.items ?? invoice.items, { discount: b.discount, taxRate: b.tax_rate });
      await replaceItems(c.db, invoice.id, totals);
    }
    await c.db.prepare(`
      UPDATE invoices SET company_id = ?, contact_id = ?, issue_date = ?, due_date = ?,
        subtotal = ?, discount = ?, tax_rate = ?, tax_amount = ?, total = ?, notes = ?, terms = ?,
        updated_at = datetime('now') WHERE id = ?
    `).bind(b.company_id, b.contact_id, b.issue_date, b.due_date,
            totals ? totals.subtotal : invoice.subtotal, totals ? totals.discount : invoice.discount,
            totals ? totals.taxRate : invoice.tax_rate, totals ? totals.taxAmount : invoice.tax_amount,
            totals ? totals.total : invoice.total, b.notes, b.terms, invoice.id).run();
    return json(await loadInvoice(c.db, invoice.id));
  });

  // Emails the invoice to the client and marks it sent
  add('POST', '/api/invoices/:id/send', async (c) => {
    const invoice = await loadInvoice(c.db, c.params.id);
    if (invoice.status === 'cancelled') throw badRequest('A cancelled invoice cannot be sent');

    const company = invoice.company_id ? await c.db.prepare('SELECT * FROM companies WHERE id = ?').bind(invoice.company_id).first() : null;
    const contact = invoice.contact_id ? await c.db.prepare('SELECT * FROM contacts WHERE id = ?').bind(invoice.contact_id).first() : null;
    const to = c.body?.to || contact?.email || company?.email;
    if (!to) throw badRequest('No recipient email — pass "to" or set an email on the contact/company');

    const settings = await getAllSettings(c.db);
    const html = renderDocument({ kind: 'invoice', doc: invoice, items: invoice.items, company, contact, settings });
    const result = await sendEmail(c.env, {
      to,
      subject: `Invoice ${invoice.number} from ${settings.company_name}`,
      html,
    });

    if (invoice.status === 'draft') {
      await c.db.prepare("UPDATE invoices SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(invoice.id).run();
    }
    await logActivity(c.db, { type: 'email', content: `Invoice ${invoice.number} sent to ${to}`, relatedType: 'invoice', relatedId: invoice.id, userId: c.user.id });
    return json({ invoice: await loadInvoice(c.db, invoice.id), email: result });
  });

  // Records a payment against the invoice and updates its status
  add('POST', '/api/invoices/:id/payments', async (c) => {
    const invoice = await loadInvoice(c.db, c.params.id);
    if (invoice.status === 'cancelled') throw badRequest('Payments cannot be recorded on a cancelled invoice');

    const amount = round2(Number(c.body?.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('A positive payment amount is required');
    if (amount > invoice.balance) throw badRequest(`Payment exceeds the outstanding balance of ${invoice.balance}`);

    const newPaid = round2(invoice.amount_paid + amount);
    const newStatus = newPaid >= invoice.total ? 'paid' : 'partial';
    await c.db.batch([
      c.db.prepare("INSERT INTO payments (invoice_id, amount, payment_date, method, reference, notes, created_by) VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?, ?)")
        .bind(invoice.id, amount, c.body.payment_date ?? null, c.body.method ?? 'bank_transfer',
              c.body.reference ?? null, c.body.notes ?? null, c.user.id),
      c.db.prepare("UPDATE invoices SET amount_paid = ?, status = ?, paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END, updated_at = datetime('now') WHERE id = ?")
        .bind(newPaid, newStatus, newStatus, invoice.id),
    ]);
    await logActivity(c.db, { content: `Payment of ${amount} recorded on invoice ${invoice.number}`, relatedType: 'invoice', relatedId: invoice.id, userId: c.user.id });
    return json(await loadInvoice(c.db, invoice.id), 201);
  });

  add('POST', '/api/invoices/:id/cancel', async (c) => {
    const invoice = await loadInvoice(c.db, c.params.id);
    if (invoice.status === 'paid') throw badRequest('A paid invoice cannot be cancelled');
    if (invoice.amount_paid > 0) throw badRequest('An invoice with recorded payments cannot be cancelled');
    await c.db.prepare("UPDATE invoices SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").bind(invoice.id).run();
    return json(await loadInvoice(c.db, invoice.id));
  });

  add('DELETE', '/api/invoices/:id', async (c) => {
    const invoice = await c.db.prepare('SELECT * FROM invoices WHERE id = ?').bind(c.params.id).first();
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.amount_paid > 0) throw badRequest('An invoice with recorded payments cannot be deleted');
    await c.db.prepare('DELETE FROM invoices WHERE id = ?').bind(invoice.id).run();
    return noContent();
  });
}
