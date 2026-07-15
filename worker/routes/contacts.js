// Port of src/routes/contacts.js.

import { json, noContent, badRequest, notFound, all } from '../helpers.js';

export function registerContactRoutes(add) {
  add('GET', '/api/contacts', async (c) => {
    const { search, company_id } = c.query;
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
    return json(await all(c.db, sql, params));
  });

  add('GET', '/api/contacts/:id', async (c) => {
    const contact = await c.db.prepare(`
      SELECT c.*, co.name AS company_name FROM contacts c
      LEFT JOIN companies co ON co.id = c.company_id WHERE c.id = ?
    `).bind(c.params.id).first();
    if (!contact) throw notFound('Contact not found');
    contact.deals = await all(c.db, 'SELECT * FROM deals WHERE contact_id = ? ORDER BY created_at DESC', [contact.id]);
    contact.activities = await all(c.db, "SELECT * FROM activities WHERE related_type = 'contact' AND related_id = ? ORDER BY created_at DESC", [contact.id]);
    return json(contact);
  });

  add('POST', '/api/contacts', async (c) => {
    const b = c.body || {};
    if (!b.first_name) throw badRequest('first_name is required');
    const info = await c.db.prepare(`
      INSERT INTO contacts (company_id, first_name, last_name, email, phone, job_title, source, notes, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(b.company_id ?? null, b.first_name, b.last_name ?? null, b.email ?? null, b.phone ?? null,
            b.job_title ?? null, b.source ?? null, b.notes ?? null, b.owner_id ?? c.user.id).run();
    return json(await c.db.prepare('SELECT * FROM contacts WHERE id = ?').bind(info.meta.last_row_id).first(), 201);
  });

  add('PATCH', '/api/contacts/:id', async (c) => {
    const contact = await c.db.prepare('SELECT * FROM contacts WHERE id = ?').bind(c.params.id).first();
    if (!contact) throw notFound('Contact not found');
    const b = { ...contact, ...c.body };
    await c.db.prepare(`
      UPDATE contacts SET company_id = ?, first_name = ?, last_name = ?, email = ?, phone = ?,
        job_title = ?, source = ?, notes = ?, owner_id = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(b.company_id, b.first_name, b.last_name, b.email, b.phone, b.job_title, b.source, b.notes, b.owner_id, contact.id).run();
    return json(await c.db.prepare('SELECT * FROM contacts WHERE id = ?').bind(contact.id).first());
  });

  add('DELETE', '/api/contacts/:id', async (c) => {
    const info = await c.db.prepare('DELETE FROM contacts WHERE id = ?').bind(c.params.id).run();
    if (info.meta.changes === 0) throw notFound('Contact not found');
    return noContent();
  });
}
