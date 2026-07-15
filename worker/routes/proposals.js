// Port of src/routes/proposals.js. Multi-statement writes use D1 batch (item
// replacement) or sequential statements instead of BEGIN/COMMIT — see the
// note at the top of worker/index.js.

import {
  json, noContent, htmlResponse, badRequest, notFound, all,
  nextDocumentNumber, computeTotals, logActivity, addDays, getSetting, getAllSettings,
} from '../helpers.js';
import { renderDocument } from '../documents.js';
import { sendEmail } from '../email.js';

async function loadProposal(db, id) {
  const proposal = await db.prepare(`
    SELECT p.*, c.name AS company_name FROM proposals p
    LEFT JOIN companies c ON c.id = p.company_id WHERE p.id = ?
  `).bind(id).first();
  if (!proposal) throw notFound('Proposal not found');
  proposal.items = await all(db, 'SELECT * FROM proposal_items WHERE proposal_id = ? ORDER BY position', [id]);
  return proposal;
}

async function replaceItems(db, proposalId, totals) {
  const insert = db.prepare('INSERT INTO proposal_items (proposal_id, service_id, description, quantity, unit_price, amount, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
  await db.batch([
    db.prepare('DELETE FROM proposal_items WHERE proposal_id = ?').bind(proposalId),
    ...totals.items.map((item) => insert.bind(proposalId, item.service_id, item.description, item.quantity, item.unit_price, item.amount, item.position)),
  ]);
}

export function registerProposalRoutes(add) {
  add('GET', '/api/proposals', async (c) => {
    const { status, company_id } = c.query;
    const where = [];
    const params = [];
    if (status) { where.push('p.status = ?'); params.push(status); }
    if (company_id) { where.push('p.company_id = ?'); params.push(company_id); }
    const sql = `
      SELECT p.*, c.name AS company_name FROM proposals p
      LEFT JOIN companies c ON c.id = p.company_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.created_at DESC`;
    return json(await all(c.db, sql, params));
  });

  add('GET', '/api/proposals/:id', async (c) => json(await loadProposal(c.db, c.params.id)));

  // Print-ready HTML version of the proposal
  add('GET', '/api/proposals/:id/html', async (c) => {
    const proposal = await loadProposal(c.db, c.params.id);
    const company = proposal.company_id ? await c.db.prepare('SELECT * FROM companies WHERE id = ?').bind(proposal.company_id).first() : null;
    const contact = proposal.contact_id ? await c.db.prepare('SELECT * FROM contacts WHERE id = ?').bind(proposal.contact_id).first() : null;
    const settings = await getAllSettings(c.db);
    return htmlResponse(renderDocument({ kind: 'proposal', doc: proposal, items: proposal.items, company, contact, settings }));
  });

  add('POST', '/api/proposals', async (c) => {
    const b = c.body || {};
    if (!b.title) throw badRequest('title is required');
    if (!Array.isArray(b.items) || b.items.length === 0) throw badRequest('At least one line item is required');

    const totals = computeTotals(b.items, {
      discount: b.discount,
      taxRate: b.tax_rate ?? Number(await getSetting(c.db, 'default_tax_rate')) ?? 0,
    });

    const number = await nextDocumentNumber(c.db, 'proposals', 'proposal_prefix');
    const validUntil = b.valid_until ?? addDays(b.issue_date, (await getSetting(c.db, 'proposal_valid_days')) || 30);
    const info = await c.db.prepare(`
      INSERT INTO proposals (number, title, deal_id, company_id, contact_id, issue_date, valid_until,
        subtotal, discount, tax_rate, tax_amount, total, notes, terms, created_by)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(number, b.title, b.deal_id ?? null, b.company_id ?? null, b.contact_id ?? null,
            b.issue_date ?? null, validUntil, totals.subtotal, totals.discount, totals.taxRate,
            totals.taxAmount, totals.total, b.notes ?? null, b.terms ?? await getSetting(c.db, 'proposal_terms'), c.user.id).run();
    await replaceItems(c.db, info.meta.last_row_id, totals);
    return json(await loadProposal(c.db, info.meta.last_row_id), 201);
  });

  add('PATCH', '/api/proposals/:id', async (c) => {
    const proposal = await loadProposal(c.db, c.params.id);
    if (['accepted', 'declined'].includes(proposal.status)) throw badRequest(`A ${proposal.status} proposal cannot be edited`);
    const b = { ...proposal, ...c.body };

    let totals = null;
    if (c.body.items || c.body.discount !== undefined || c.body.tax_rate !== undefined) {
      totals = computeTotals(c.body.items ?? proposal.items, {
        discount: b.discount,
        taxRate: b.tax_rate,
      });
      await replaceItems(c.db, proposal.id, totals);
    }
    await c.db.prepare(`
      UPDATE proposals SET title = ?, deal_id = ?, company_id = ?, contact_id = ?, issue_date = ?, valid_until = ?,
        subtotal = ?, discount = ?, tax_rate = ?, tax_amount = ?, total = ?, notes = ?, terms = ?,
        updated_at = datetime('now') WHERE id = ?
    `).bind(b.title, b.deal_id, b.company_id, b.contact_id, b.issue_date, b.valid_until,
            totals ? totals.subtotal : proposal.subtotal, totals ? totals.discount : proposal.discount,
            totals ? totals.taxRate : proposal.tax_rate, totals ? totals.taxAmount : proposal.tax_amount,
            totals ? totals.total : proposal.total, b.notes, b.terms, proposal.id).run();
    return json(await loadProposal(c.db, proposal.id));
  });

  // Emails the proposal to the client and marks it sent
  add('POST', '/api/proposals/:id/send', async (c) => {
    const proposal = await loadProposal(c.db, c.params.id);
    if (['accepted', 'declined'].includes(proposal.status)) throw badRequest(`A ${proposal.status} proposal cannot be re-sent`);

    const company = proposal.company_id ? await c.db.prepare('SELECT * FROM companies WHERE id = ?').bind(proposal.company_id).first() : null;
    const contact = proposal.contact_id ? await c.db.prepare('SELECT * FROM contacts WHERE id = ?').bind(proposal.contact_id).first() : null;
    const to = c.body?.to || contact?.email || company?.email;
    if (!to) throw badRequest('No recipient email — pass "to" or set an email on the contact/company');

    const settings = await getAllSettings(c.db);
    const html = renderDocument({ kind: 'proposal', doc: proposal, items: proposal.items, company, contact, settings });
    const result = await sendEmail(c.env, {
      to,
      subject: `Proposal ${proposal.number} from ${settings.company_name} — ${proposal.title}`,
      html,
    });

    await c.db.prepare("UPDATE proposals SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(proposal.id).run();
    await logActivity(c.db, { type: 'email', content: `Proposal ${proposal.number} sent to ${to}`, relatedType: 'proposal', relatedId: proposal.id, userId: c.user.id });
    return json({ proposal: await loadProposal(c.db, proposal.id), email: result });
  });

  add('POST', '/api/proposals/:id/accept', async (c) => {
    const proposal = await loadProposal(c.db, c.params.id);
    if (proposal.status === 'accepted') throw badRequest('Proposal is already accepted');
    await c.db.prepare("UPDATE proposals SET status = 'accepted', accepted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(proposal.id).run();
    await logActivity(c.db, { content: `Proposal ${proposal.number} accepted`, relatedType: 'proposal', relatedId: proposal.id, userId: c.user.id });
    return json(await loadProposal(c.db, proposal.id));
  });

  add('POST', '/api/proposals/:id/decline', async (c) => {
    const proposal = await loadProposal(c.db, c.params.id);
    if (['accepted', 'declined'].includes(proposal.status)) throw badRequest(`Proposal is already ${proposal.status}`);
    await c.db.prepare("UPDATE proposals SET status = 'declined', declined_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(proposal.id).run();
    await logActivity(c.db, { content: `Proposal ${proposal.number} declined`, relatedType: 'proposal', relatedId: proposal.id, userId: c.user.id });
    return json(await loadProposal(c.db, proposal.id));
  });

  // Turns an accepted proposal into a draft invoice with the same line items
  add('POST', '/api/proposals/:id/convert-to-invoice', async (c) => {
    const proposal = await loadProposal(c.db, c.params.id);
    if (proposal.status !== 'accepted') throw badRequest('Only accepted proposals can be converted to invoices');
    if (proposal.invoice_id) throw badRequest('Proposal was already converted to an invoice');

    const number = await nextDocumentNumber(c.db, 'invoices', 'invoice_prefix');
    const dueDate = addDays(null, (await getSetting(c.db, 'invoice_due_days')) || 14);
    const info = await c.db.prepare(`
      INSERT INTO invoices (number, company_id, contact_id, proposal_id, issue_date, due_date,
        subtotal, discount, tax_rate, tax_amount, total, notes, terms, created_by)
      VALUES (?, ?, ?, ?, date('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(number, proposal.company_id, proposal.contact_id, proposal.id, dueDate,
            proposal.subtotal, proposal.discount, proposal.tax_rate, proposal.tax_amount, proposal.total,
            proposal.notes, await getSetting(c.db, 'invoice_terms'), c.user.id).run();
    const invoiceId = info.meta.last_row_id;

    const insertItem = c.db.prepare('INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price, amount, position) VALUES (?, ?, ?, ?, ?, ?, ?)');
    await c.db.batch([
      ...proposal.items.map((item) => insertItem.bind(invoiceId, item.service_id ?? null, item.description, item.quantity, item.unit_price, item.amount, item.position)),
      c.db.prepare("UPDATE proposals SET invoice_id = ?, updated_at = datetime('now') WHERE id = ?").bind(invoiceId, proposal.id),
    ]);
    await logActivity(c.db, { content: `Proposal ${proposal.number} converted to invoice ${number}`, relatedType: 'proposal', relatedId: proposal.id, userId: c.user.id });

    const invoice = await c.db.prepare('SELECT * FROM invoices WHERE id = ?').bind(invoiceId).first();
    invoice.items = await all(c.db, 'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position', [invoiceId]);
    return json(invoice, 201);
  });

  add('DELETE', '/api/proposals/:id', async (c) => {
    const proposal = await c.db.prepare('SELECT * FROM proposals WHERE id = ?').bind(c.params.id).first();
    if (!proposal) throw notFound('Proposal not found');
    if (proposal.status === 'accepted') throw badRequest('Accepted proposals cannot be deleted');
    await c.db.prepare('DELETE FROM proposals WHERE id = ?').bind(proposal.id).run();
    return noContent();
  });
}
