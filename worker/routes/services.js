// Port of src/routes/services.js.

import { json, noContent, badRequest, notFound, round2, all } from '../helpers.js';

export function registerServiceRoutes(add) {
  // Billed revenue per service across non-cancelled invoices
  add('GET', '/api/services/revenue', async (c) => {
    return json(await all(c.db, `
      SELECT COALESCE(s.name, 'Custom / other') AS service, COUNT(ii.id) AS times_billed,
             ROUND(SUM(ii.amount), 2) AS billed
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id AND i.status != 'cancelled'
      LEFT JOIN services s ON s.id = ii.service_id
      GROUP BY s.id ORDER BY billed DESC
    `));
  });

  add('GET', '/api/services', async (c) => {
    const { active } = c.query;
    const sql = active === 'true'
      ? 'SELECT * FROM services WHERE is_active = 1 ORDER BY name'
      : 'SELECT * FROM services ORDER BY name';
    return json(await all(c.db, sql));
  });

  add('GET', '/api/services/:id', async (c) => {
    const service = await c.db.prepare('SELECT * FROM services WHERE id = ?').bind(c.params.id).first();
    if (!service) throw notFound('Service not found');
    return json(service);
  });

  add('POST', '/api/services', async (c) => {
    const b = c.body || {};
    const price = round2(Number(b.unit_price));
    if (!b.name || !String(b.name).trim()) throw badRequest('name is required');
    if (!Number.isFinite(price) || price < 0) throw badRequest('unit_price must be zero or a positive number');
    if (await c.db.prepare('SELECT id FROM services WHERE name = ? COLLATE NOCASE').bind(b.name.trim()).first()) {
      throw badRequest('A service with that name already exists');
    }
    const info = await c.db.prepare('INSERT INTO services (name, description, unit_price, unit) VALUES (?, ?, ?, ?)')
      .bind(b.name.trim(), b.description ?? null, price, b.unit || 'project').run();
    return json(await c.db.prepare('SELECT * FROM services WHERE id = ?').bind(info.meta.last_row_id).first(), 201);
  });

  add('PATCH', '/api/services/:id', async (c) => {
    const service = await c.db.prepare('SELECT * FROM services WHERE id = ?').bind(c.params.id).first();
    if (!service) throw notFound('Service not found');
    const b = { ...service, ...c.body };
    const price = round2(Number(b.unit_price));
    if (!Number.isFinite(price) || price < 0) throw badRequest('unit_price must be zero or a positive number');
    await c.db.prepare(`
      UPDATE services SET name = ?, description = ?, unit_price = ?, unit = ?, is_active = ?,
        updated_at = datetime('now') WHERE id = ?
    `).bind(b.name, b.description, price, b.unit, b.is_active ? 1 : 0, service.id).run();
    return json(await c.db.prepare('SELECT * FROM services WHERE id = ?').bind(service.id).first());
  });

  add('DELETE', '/api/services/:id', async (c) => {
    const used = (await c.db.prepare('SELECT COUNT(*) AS n FROM invoice_items WHERE service_id = ?').bind(c.params.id).first()).n
      + (await c.db.prepare('SELECT COUNT(*) AS n FROM proposal_items WHERE service_id = ?').bind(c.params.id).first()).n;
    if (used > 0) throw badRequest('This service appears on invoices or proposals — deactivate it instead of deleting');
    const info = await c.db.prepare('DELETE FROM services WHERE id = ?').bind(c.params.id).run();
    if (info.meta.changes === 0) throw notFound('Service not found');
    return noContent();
  });
}
