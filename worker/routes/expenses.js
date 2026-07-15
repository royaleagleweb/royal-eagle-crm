// Port of src/routes/expenses.js.

import { json, noContent, badRequest, notFound, round2, all } from '../helpers.js';

export function registerExpenseRoutes(add) {
  add('GET', '/api/expenses/categories', async (c) => {
    return json(await all(c.db, 'SELECT * FROM expense_categories ORDER BY name'));
  });

  add('POST', '/api/expenses/categories', async (c) => {
    const name = (c.body?.name || '').trim();
    if (!name) throw badRequest('name is required');
    if (await c.db.prepare('SELECT id FROM expense_categories WHERE name = ? COLLATE NOCASE').bind(name).first()) {
      throw badRequest('Category already exists');
    }
    const info = await c.db.prepare('INSERT INTO expense_categories (name) VALUES (?)').bind(name).run();
    return json(await c.db.prepare('SELECT * FROM expense_categories WHERE id = ?').bind(info.meta.last_row_id).first(), 201);
  });

  // Totals by category for a date range — the expense report
  add('GET', '/api/expenses/summary', async (c) => {
    const { from, to } = c.query;
    const where = [];
    const params = [];
    if (from) { where.push('e.expense_date >= ?'); params.push(from); }
    if (to) { where.push('e.expense_date <= ?'); params.push(to); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const byCategory = await all(c.db, `
      SELECT COALESCE(c.name, 'Uncategorized') AS category, COUNT(*) AS count, ROUND(SUM(e.amount), 2) AS total
      FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
      ${whereSql} GROUP BY c.name ORDER BY total DESC
    `, params);

    const byMonth = await all(c.db, `
      SELECT strftime('%Y-%m', e.expense_date) AS month, ROUND(SUM(e.amount), 2) AS total
      FROM expenses e ${whereSql} GROUP BY month ORDER BY month
    `, params);

    const overall = await c.db.prepare(`SELECT COUNT(*) AS count, ROUND(COALESCE(SUM(e.amount), 0), 2) AS total FROM expenses e ${whereSql}`).bind(...params).first();

    return json({ total: overall.total, count: overall.count, by_category: byCategory, by_month: byMonth });
  });

  add('GET', '/api/expenses', async (c) => {
    const { category_id, company_id, from, to, billable } = c.query;
    const where = [];
    const params = [];
    if (category_id) { where.push('e.category_id = ?'); params.push(category_id); }
    if (company_id) { where.push('e.company_id = ?'); params.push(company_id); }
    if (from) { where.push('e.expense_date >= ?'); params.push(from); }
    if (to) { where.push('e.expense_date <= ?'); params.push(to); }
    if (billable !== undefined) { where.push('e.billable = ?'); params.push(billable === 'true' ? 1 : 0); }
    const sql = `
      SELECT e.*, c.name AS category_name, co.name AS company_name FROM expenses e
      LEFT JOIN expense_categories c ON c.id = e.category_id
      LEFT JOIN companies co ON co.id = e.company_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY e.expense_date DESC, e.id DESC`;
    return json(await all(c.db, sql, params));
  });

  add('GET', '/api/expenses/:id', async (c) => {
    const expense = await c.db.prepare(`
      SELECT e.*, c.name AS category_name, co.name AS company_name FROM expenses e
      LEFT JOIN expense_categories c ON c.id = e.category_id
      LEFT JOIN companies co ON co.id = e.company_id WHERE e.id = ?
    `).bind(c.params.id).first();
    if (!expense) throw notFound('Expense not found');
    return json(expense);
  });

  add('POST', '/api/expenses', async (c) => {
    const b = c.body || {};
    const amount = round2(Number(b.amount));
    if (!b.description) throw badRequest('description is required');
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('A positive amount is required');
    if (b.recurring_interval && !['weekly', 'monthly', 'quarterly', 'yearly'].includes(b.recurring_interval)) {
      throw badRequest('recurring_interval must be weekly, monthly, quarterly or yearly');
    }
    const info = await c.db.prepare(`
      INSERT INTO expenses (category_id, company_id, vendor, description, amount, expense_date,
        payment_method, reference, billable, receipt_url, is_recurring, recurring_interval, created_by)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?)
    `).bind(b.category_id ?? null, b.company_id ?? null, b.vendor ?? null, b.description, amount,
            b.expense_date ?? null, b.payment_method ?? null, b.reference ?? null, b.billable ? 1 : 0,
            b.receipt_url ?? null, b.recurring_interval ? 1 : 0, b.recurring_interval ?? null, c.user.id).run();
    return json(await c.db.prepare('SELECT * FROM expenses WHERE id = ?').bind(info.meta.last_row_id).first(), 201);
  });

  add('PATCH', '/api/expenses/:id', async (c) => {
    const expense = await c.db.prepare('SELECT * FROM expenses WHERE id = ?').bind(c.params.id).first();
    if (!expense) throw notFound('Expense not found');
    const b = { ...expense, ...c.body };
    const amount = round2(Number(b.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('A positive amount is required');
    await c.db.prepare(`
      UPDATE expenses SET category_id = ?, company_id = ?, vendor = ?, description = ?, amount = ?,
        expense_date = ?, payment_method = ?, reference = ?, billable = ?, receipt_url = ?,
        is_recurring = ?, recurring_interval = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(b.category_id, b.company_id, b.vendor, b.description, amount, b.expense_date,
            b.payment_method, b.reference, b.billable ? 1 : 0, b.receipt_url,
            b.recurring_interval ? 1 : 0, b.recurring_interval, expense.id).run();
    return json(await c.db.prepare('SELECT * FROM expenses WHERE id = ?').bind(expense.id).first());
  });

  add('DELETE', '/api/expenses/:id', async (c) => {
    const info = await c.db.prepare('DELETE FROM expenses WHERE id = ?').bind(c.params.id).run();
    if (info.meta.changes === 0) throw notFound('Expense not found');
    return noContent();
  });
}
