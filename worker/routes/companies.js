// Port of src/routes/companies.js.

import { json, noContent, badRequest, notFound, all } from '../helpers.js';

export function registerCompanyRoutes(add) {
  add('GET', '/api/companies', async (c) => {
    const { search } = c.query;
    let sql = 'SELECT * FROM companies';
    const params = [];
    if (search) {
      sql += ' WHERE name LIKE ? OR email LIKE ? OR industry LIKE ?';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY name';
    return json(await all(c.db, sql, params));
  });

  add('GET', '/api/companies/:id', async (c) => {
    const company = await c.db.prepare('SELECT * FROM companies WHERE id = ?').bind(c.params.id).first();
    if (!company) throw notFound('Company not found');
    company.contacts = await all(c.db, 'SELECT * FROM contacts WHERE company_id = ? ORDER BY first_name', [company.id]);
    company.deals = await all(c.db, 'SELECT * FROM deals WHERE company_id = ? ORDER BY created_at DESC', [company.id]);
    company.invoices = await all(c.db, 'SELECT id, number, status, issue_date, total, amount_paid FROM invoices WHERE company_id = ? ORDER BY issue_date DESC', [company.id]);
    return json(company);
  });

  add('POST', '/api/companies', async (c) => {
    const b = c.body || {};
    if (!b.name) throw badRequest('name is required');
    const info = await c.db.prepare(`
      INSERT INTO companies (name, industry, website, email, phone, address, city, country, notes, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(b.name, b.industry ?? null, b.website ?? null, b.email ?? null, b.phone ?? null,
            b.address ?? null, b.city ?? null, b.country ?? null, b.notes ?? null, b.owner_id ?? c.user.id).run();
    return json(await c.db.prepare('SELECT * FROM companies WHERE id = ?').bind(info.meta.last_row_id).first(), 201);
  });

  add('PATCH', '/api/companies/:id', async (c) => {
    const company = await c.db.prepare('SELECT * FROM companies WHERE id = ?').bind(c.params.id).first();
    if (!company) throw notFound('Company not found');
    const b = { ...company, ...c.body };
    await c.db.prepare(`
      UPDATE companies SET name = ?, industry = ?, website = ?, email = ?, phone = ?, address = ?,
        city = ?, country = ?, notes = ?, owner_id = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(b.name, b.industry, b.website, b.email, b.phone, b.address, b.city, b.country, b.notes, b.owner_id, company.id).run();
    return json(await c.db.prepare('SELECT * FROM companies WHERE id = ?').bind(company.id).first());
  });

  add('DELETE', '/api/companies/:id', async (c) => {
    const info = await c.db.prepare('DELETE FROM companies WHERE id = ?').bind(c.params.id).run();
    if (info.meta.changes === 0) throw notFound('Company not found');
    return noContent();
  });
}
