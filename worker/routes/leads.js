// Port of src/routes/leads.js. The convert flow runs as sequential D1
// statements instead of a single BEGIN/COMMIT transaction (D1 has no
// interactive transactions) — see the note at the top of worker/index.js.

import { json, noContent, badRequest, notFound, all, logActivity } from '../helpers.js';

export function registerLeadRoutes(add) {
  add('GET', '/api/leads', async (c) => {
    const { status, search } = c.query;
    const where = [];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (search) {
      where.push('(name LIKE ? OR email LIKE ? OR company_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const sql = `SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
    return json(await all(c.db, sql, params));
  });

  add('GET', '/api/leads/:id', async (c) => {
    const lead = await c.db.prepare('SELECT * FROM leads WHERE id = ?').bind(c.params.id).first();
    if (!lead) throw notFound('Lead not found');
    lead.activities = await all(c.db, "SELECT * FROM activities WHERE related_type = 'lead' AND related_id = ? ORDER BY created_at DESC", [lead.id]);
    return json(lead);
  });

  add('POST', '/api/leads', async (c) => {
    const b = c.body || {};
    if (!b.name) throw badRequest('name is required');
    const info = await c.db.prepare(`
      INSERT INTO leads (name, email, phone, company_name, source, status, estimated_value, notes, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(b.name, b.email ?? null, b.phone ?? null, b.company_name ?? null, b.source ?? null,
            b.status ?? 'new', b.estimated_value ?? 0, b.notes ?? null, b.owner_id ?? c.user.id).run();
    return json(await c.db.prepare('SELECT * FROM leads WHERE id = ?').bind(info.meta.last_row_id).first(), 201);
  });

  add('PATCH', '/api/leads/:id', async (c) => {
    const lead = await c.db.prepare('SELECT * FROM leads WHERE id = ?').bind(c.params.id).first();
    if (!lead) throw notFound('Lead not found');
    if (lead.status === 'converted') throw badRequest('Converted leads cannot be edited');
    const b = { ...lead, ...c.body };
    if (b.status === 'converted') throw badRequest('Use POST /api/leads/:id/convert to convert a lead');
    await c.db.prepare(`
      UPDATE leads SET name = ?, email = ?, phone = ?, company_name = ?, source = ?, status = ?,
        estimated_value = ?, notes = ?, owner_id = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(b.name, b.email, b.phone, b.company_name, b.source, b.status, b.estimated_value, b.notes, b.owner_id, lead.id).run();
    return json(await c.db.prepare('SELECT * FROM leads WHERE id = ?').bind(lead.id).first());
  });

  // Converts a lead into a contact (+ optional company) and an open deal.
  add('POST', '/api/leads/:id/convert', async (c) => {
    const lead = await c.db.prepare('SELECT * FROM leads WHERE id = ?').bind(c.params.id).first();
    if (!lead) throw notFound('Lead not found');
    if (lead.status === 'converted') throw badRequest('Lead is already converted');

    const { create_deal = true, deal_title, deal_value } = c.body || {};

    let companyId = null;
    if (lead.company_name) {
      const existing = await c.db.prepare('SELECT id FROM companies WHERE name = ? COLLATE NOCASE').bind(lead.company_name).first();
      companyId = existing
        ? existing.id
        : (await c.db.prepare('INSERT INTO companies (name, owner_id) VALUES (?, ?)').bind(lead.company_name, lead.owner_id).run()).meta.last_row_id;
    }

    const [firstName, ...rest] = lead.name.trim().split(/\s+/);
    const contactId = (await c.db.prepare(`
      INSERT INTO contacts (company_id, first_name, last_name, email, phone, source, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(companyId, firstName, rest.join(' ') || null, lead.email, lead.phone, lead.source, lead.owner_id).run()).meta.last_row_id;

    let dealId = null;
    if (create_deal) {
      const firstStage = await c.db.prepare('SELECT id FROM deal_stages ORDER BY position LIMIT 1').first();
      dealId = (await c.db.prepare(`
        INSERT INTO deals (title, company_id, contact_id, stage_id, value, owner_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(deal_title || `Deal – ${lead.name}`, companyId, contactId,
              firstStage ? firstStage.id : null, deal_value ?? lead.estimated_value ?? 0, lead.owner_id).run()).meta.last_row_id;
    }

    await c.db.prepare(`
      UPDATE leads SET status = 'converted', converted_contact_id = ?, converted_deal_id = ?,
        updated_at = datetime('now') WHERE id = ?
    `).bind(contactId, dealId, lead.id).run();

    await logActivity(c.db, { content: `Lead "${lead.name}" converted`, relatedType: 'lead', relatedId: lead.id, userId: c.user.id });

    return json({
      lead: await c.db.prepare('SELECT * FROM leads WHERE id = ?').bind(lead.id).first(),
      contact: await c.db.prepare('SELECT * FROM contacts WHERE id = ?').bind(contactId).first(),
      company: companyId ? await c.db.prepare('SELECT * FROM companies WHERE id = ?').bind(companyId).first() : null,
      deal: dealId ? await c.db.prepare('SELECT * FROM deals WHERE id = ?').bind(dealId).first() : null,
    });
  });

  add('DELETE', '/api/leads/:id', async (c) => {
    const info = await c.db.prepare('DELETE FROM leads WHERE id = ?').bind(c.params.id).run();
    if (info.meta.changes === 0) throw notFound('Lead not found');
    return noContent();
  });
}
