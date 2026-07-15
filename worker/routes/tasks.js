// Port of src/routes/tasks.js.

import { json, noContent, badRequest, notFound, all } from '../helpers.js';

const RELATED_TYPES = ['contact', 'company', 'lead', 'deal', 'proposal', 'invoice'];

export function registerTaskRoutes(add) {
  add('GET', '/api/tasks', async (c) => {
    const { status, assignee_id, related_type, related_id, overdue } = c.query;
    const where = [];
    const params = [];
    if (status) { where.push('t.status = ?'); params.push(status); }
    if (assignee_id) { where.push('t.assignee_id = ?'); params.push(assignee_id); }
    if (related_type) { where.push('t.related_type = ?'); params.push(related_type); }
    if (related_id) { where.push('t.related_id = ?'); params.push(related_id); }
    if (overdue === 'true') where.push("t.due_date < date('now') AND t.status NOT IN ('done', 'cancelled')");
    const sql = `
      SELECT t.*, u.name AS assignee_name FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
               t.due_date IS NULL, t.due_date`;
    return json(await all(c.db, sql, params));
  });

  add('GET', '/api/tasks/:id', async (c) => {
    const task = await c.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(c.params.id).first();
    if (!task) throw notFound('Task not found');
    return json(task);
  });

  add('POST', '/api/tasks', async (c) => {
    const b = c.body || {};
    if (!b.title) throw badRequest('title is required');
    if (b.related_type && !RELATED_TYPES.includes(b.related_type)) throw badRequest(`related_type must be one of: ${RELATED_TYPES.join(', ')}`);
    const info = await c.db.prepare(`
      INSERT INTO tasks (title, description, due_date, priority, status, related_type, related_id, assignee_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(b.title, b.description ?? null, b.due_date ?? null, b.priority ?? 'medium', b.status ?? 'todo',
            b.related_type ?? null, b.related_id ?? null, b.assignee_id ?? c.user.id, c.user.id).run();
    return json(await c.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(info.meta.last_row_id).first(), 201);
  });

  add('PATCH', '/api/tasks/:id', async (c) => {
    const task = await c.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(c.params.id).first();
    if (!task) throw notFound('Task not found');
    const b = { ...task, ...c.body };
    const completedAt = b.status === 'done' && task.status !== 'done' ? new Date().toISOString() : task.completed_at;
    await c.db.prepare(`
      UPDATE tasks SET title = ?, description = ?, due_date = ?, priority = ?, status = ?,
        related_type = ?, related_id = ?, assignee_id = ?, completed_at = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(b.title, b.description, b.due_date, b.priority, b.status, b.related_type, b.related_id,
            b.assignee_id, completedAt, task.id).run();
    return json(await c.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(task.id).first());
  });

  add('DELETE', '/api/tasks/:id', async (c) => {
    const info = await c.db.prepare('DELETE FROM tasks WHERE id = ?').bind(c.params.id).run();
    if (info.meta.changes === 0) throw notFound('Task not found');
    return noContent();
  });
}
