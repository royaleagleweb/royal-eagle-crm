// Port of src/routes/activities.js.

import { json, noContent, badRequest, notFound, all } from '../helpers.js';

const RELATED_TYPES = ['contact', 'company', 'lead', 'deal', 'proposal', 'invoice', 'expense'];
const TYPES = ['note', 'call', 'email', 'meeting'];

export function registerActivityRoutes(add) {
  add('GET', '/api/activities', async (c) => {
    const { related_type, related_id, type, limit } = c.query;
    const where = [];
    const params = [];
    if (related_type) { where.push('a.related_type = ?'); params.push(related_type); }
    if (related_id) { where.push('a.related_id = ?'); params.push(related_id); }
    if (type) { where.push('a.type = ?'); params.push(type); }
    const sql = `
      SELECT a.*, u.name AS user_name FROM activities a
      LEFT JOIN users u ON u.id = a.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.created_at DESC LIMIT ?`;
    return json(await all(c.db, sql, [...params, Math.min(parseInt(limit || '100', 10), 500)]));
  });

  add('POST', '/api/activities', async (c) => {
    const b = c.body || {};
    if (!b.content) throw badRequest('content is required');
    if (!RELATED_TYPES.includes(b.related_type)) throw badRequest(`related_type must be one of: ${RELATED_TYPES.join(', ')}`);
    if (!b.related_id) throw badRequest('related_id is required');
    const type = b.type ?? 'note';
    if (!TYPES.includes(type)) throw badRequest(`type must be one of: ${TYPES.join(', ')}`);
    const info = await c.db.prepare('INSERT INTO activities (type, content, related_type, related_id, user_id) VALUES (?, ?, ?, ?, ?)')
      .bind(type, b.content, b.related_type, b.related_id, c.user.id).run();
    return json(await c.db.prepare('SELECT * FROM activities WHERE id = ?').bind(info.meta.last_row_id).first(), 201);
  });

  add('DELETE', '/api/activities/:id', async (c) => {
    const info = await c.db.prepare('DELETE FROM activities WHERE id = ?').bind(c.params.id).run();
    if (info.meta.changes === 0) throw notFound('Activity not found');
    return noContent();
  });
}
