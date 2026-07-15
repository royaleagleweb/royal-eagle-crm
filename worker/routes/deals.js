// Port of src/routes/deals.js.

import { json, noContent, badRequest, notFound, all, logActivity } from '../helpers.js';

export function registerDealRoutes(add) {
  add('GET', '/api/deals/stages', async (c) => {
    return json(await all(c.db, 'SELECT * FROM deal_stages ORDER BY position'));
  });

  // Kanban-style board: stages with their open deals
  add('GET', '/api/deals/pipeline', async (c) => {
    const stages = await all(c.db, 'SELECT * FROM deal_stages ORDER BY position');
    const dealsByStage = await all(c.db, `
      SELECT d.*, c.name AS company_name FROM deals d
      LEFT JOIN companies c ON c.id = d.company_id
      WHERE d.status = 'open' ORDER BY d.updated_at DESC
    `);
    return json(stages.map((stage) => ({
      ...stage,
      deals: dealsByStage.filter((d) => d.stage_id === stage.id),
      total_value: dealsByStage.filter((d) => d.stage_id === stage.id).reduce((s, d) => s + d.value, 0),
    })));
  });

  add('GET', '/api/deals', async (c) => {
    const { status, stage_id, company_id } = c.query;
    const where = [];
    const params = [];
    if (status) { where.push('d.status = ?'); params.push(status); }
    if (stage_id) { where.push('d.stage_id = ?'); params.push(stage_id); }
    if (company_id) { where.push('d.company_id = ?'); params.push(company_id); }
    const sql = `
      SELECT d.*, s.name AS stage_name, c.name AS company_name,
             ct.first_name || COALESCE(' ' || ct.last_name, '') AS contact_name
      FROM deals d
      LEFT JOIN deal_stages s ON s.id = d.stage_id
      LEFT JOIN companies c ON c.id = d.company_id
      LEFT JOIN contacts ct ON ct.id = d.contact_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY d.created_at DESC`;
    return json(await all(c.db, sql, params));
  });

  add('GET', '/api/deals/:id', async (c) => {
    const deal = await c.db.prepare(`
      SELECT d.*, s.name AS stage_name, c.name AS company_name FROM deals d
      LEFT JOIN deal_stages s ON s.id = d.stage_id
      LEFT JOIN companies c ON c.id = d.company_id
      WHERE d.id = ?
    `).bind(c.params.id).first();
    if (!deal) throw notFound('Deal not found');
    deal.proposals = await all(c.db, 'SELECT id, number, title, status, total FROM proposals WHERE deal_id = ?', [deal.id]);
    deal.activities = await all(c.db, "SELECT * FROM activities WHERE related_type = 'deal' AND related_id = ? ORDER BY created_at DESC", [deal.id]);
    return json(deal);
  });

  add('POST', '/api/deals', async (c) => {
    const b = c.body || {};
    if (!b.title) throw badRequest('title is required');
    const stageId = b.stage_id ?? (await c.db.prepare('SELECT id FROM deal_stages ORDER BY position LIMIT 1').first())?.id;
    const info = await c.db.prepare(`
      INSERT INTO deals (title, company_id, contact_id, stage_id, value, expected_close_date, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(b.title, b.company_id ?? null, b.contact_id ?? null, stageId ?? null,
            b.value ?? 0, b.expected_close_date ?? null, b.owner_id ?? c.user.id).run();
    return json(await c.db.prepare('SELECT * FROM deals WHERE id = ?').bind(info.meta.last_row_id).first(), 201);
  });

  add('PATCH', '/api/deals/:id', async (c) => {
    const deal = await c.db.prepare('SELECT * FROM deals WHERE id = ?').bind(c.params.id).first();
    if (!deal) throw notFound('Deal not found');
    const b = { ...deal, ...c.body };
    await c.db.prepare(`
      UPDATE deals SET title = ?, company_id = ?, contact_id = ?, stage_id = ?, value = ?,
        expected_close_date = ?, owner_id = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(b.title, b.company_id, b.contact_id, b.stage_id, b.value, b.expected_close_date, b.owner_id, deal.id).run();
    return json(await c.db.prepare('SELECT * FROM deals WHERE id = ?').bind(deal.id).first());
  });

  // Move a deal to another pipeline stage
  add('POST', '/api/deals/:id/move', async (c) => {
    const deal = await c.db.prepare('SELECT * FROM deals WHERE id = ?').bind(c.params.id).first();
    if (!deal) throw notFound('Deal not found');
    const stage = await c.db.prepare('SELECT * FROM deal_stages WHERE id = ?').bind(c.body?.stage_id ?? null).first();
    if (!stage) throw badRequest('A valid stage_id is required');
    await c.db.prepare("UPDATE deals SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").bind(stage.id, deal.id).run();
    await logActivity(c.db, { content: `Deal moved to stage "${stage.name}"`, relatedType: 'deal', relatedId: deal.id, userId: c.user.id });
    return json(await c.db.prepare('SELECT * FROM deals WHERE id = ?').bind(deal.id).first());
  });

  add('POST', '/api/deals/:id/win', async (c) => {
    const deal = await c.db.prepare('SELECT * FROM deals WHERE id = ?').bind(c.params.id).first();
    if (!deal) throw notFound('Deal not found');
    if (deal.status !== 'open') throw badRequest('Only open deals can be won');
    await c.db.prepare("UPDATE deals SET status = 'won', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(deal.id).run();
    await logActivity(c.db, { content: `Deal "${deal.title}" marked as won`, relatedType: 'deal', relatedId: deal.id, userId: c.user.id });
    return json(await c.db.prepare('SELECT * FROM deals WHERE id = ?').bind(deal.id).first());
  });

  add('POST', '/api/deals/:id/lose', async (c) => {
    const deal = await c.db.prepare('SELECT * FROM deals WHERE id = ?').bind(c.params.id).first();
    if (!deal) throw notFound('Deal not found');
    if (deal.status !== 'open') throw badRequest('Only open deals can be lost');
    await c.db.prepare("UPDATE deals SET status = 'lost', lost_reason = ?, closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .bind(c.body?.reason ?? null, deal.id).run();
    await logActivity(c.db, { content: `Deal "${deal.title}" marked as lost${c.body?.reason ? `: ${c.body.reason}` : ''}`, relatedType: 'deal', relatedId: deal.id, userId: c.user.id });
    return json(await c.db.prepare('SELECT * FROM deals WHERE id = ?').bind(deal.id).first());
  });

  add('DELETE', '/api/deals/:id', async (c) => {
    const info = await c.db.prepare('DELETE FROM deals WHERE id = ?').bind(c.params.id).run();
    if (info.meta.changes === 0) throw notFound('Deal not found');
    return noContent();
  });
}
