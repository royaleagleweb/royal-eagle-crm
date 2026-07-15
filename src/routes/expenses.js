const express = require('express');
const { db } = require('../db');
const { handler, badRequest, notFound, round2 } = require('../utils/helpers');

const router = express.Router();

router.get('/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM expense_categories ORDER BY name').all());
});

router.post('/categories', handler((req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) throw badRequest('name is required');
  if (db.prepare('SELECT id FROM expense_categories WHERE name = ? COLLATE NOCASE').get(name)) {
    throw badRequest('Category already exists');
  }
  const info = db.prepare('INSERT INTO expense_categories (name) VALUES (?)').run(name);
  res.status(201).json(db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(info.lastInsertRowid));
}));

// Totals by category for a date range — the expense report
router.get('/summary', (req, res) => {
  const { from, to } = req.query;
  const where = [];
  const params = [];
  if (from) { where.push('e.expense_date >= ?'); params.push(from); }
  if (to) { where.push('e.expense_date <= ?'); params.push(to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const byCategory = db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorized') AS category, COUNT(*) AS count, ROUND(SUM(e.amount), 2) AS total
    FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
    ${whereSql} GROUP BY c.name ORDER BY total DESC
  `).all(...params);

  const byMonth = db.prepare(`
    SELECT strftime('%Y-%m', e.expense_date) AS month, ROUND(SUM(e.amount), 2) AS total
    FROM expenses e ${whereSql} GROUP BY month ORDER BY month
  `).all(...params);

  const overall = db.prepare(`SELECT COUNT(*) AS count, ROUND(COALESCE(SUM(e.amount), 0), 2) AS total FROM expenses e ${whereSql}`).get(...params);

  res.json({ total: overall.total, count: overall.count, by_category: byCategory, by_month: byMonth });
});

router.get('/', (req, res) => {
  const { category_id, company_id, from, to, billable } = req.query;
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
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', handler((req, res) => {
  const expense = db.prepare(`
    SELECT e.*, c.name AS category_name, co.name AS company_name FROM expenses e
    LEFT JOIN expense_categories c ON c.id = e.category_id
    LEFT JOIN companies co ON co.id = e.company_id WHERE e.id = ?
  `).get(req.params.id);
  if (!expense) throw notFound('Expense not found');
  res.json(expense);
}));

router.post('/', handler((req, res) => {
  const b = req.body || {};
  const amount = round2(Number(b.amount));
  if (!b.description) throw badRequest('description is required');
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('A positive amount is required');
  if (b.recurring_interval && !['weekly', 'monthly', 'quarterly', 'yearly'].includes(b.recurring_interval)) {
    throw badRequest('recurring_interval must be weekly, monthly, quarterly or yearly');
  }
  const info = db.prepare(`
    INSERT INTO expenses (category_id, company_id, vendor, description, amount, expense_date,
      payment_method, reference, billable, receipt_url, is_recurring, recurring_interval, created_by)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?)
  `).run(b.category_id ?? null, b.company_id ?? null, b.vendor ?? null, b.description, amount,
         b.expense_date ?? null, b.payment_method ?? null, b.reference ?? null, b.billable ? 1 : 0,
         b.receipt_url ?? null, b.recurring_interval ? 1 : 0, b.recurring_interval ?? null, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid));
}));

router.patch('/:id', handler((req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!expense) throw notFound('Expense not found');
  const b = { ...expense, ...req.body };
  const amount = round2(Number(b.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('A positive amount is required');
  db.prepare(`
    UPDATE expenses SET category_id = ?, company_id = ?, vendor = ?, description = ?, amount = ?,
      expense_date = ?, payment_method = ?, reference = ?, billable = ?, receipt_url = ?,
      is_recurring = ?, recurring_interval = ?, updated_at = datetime('now') WHERE id = ?
  `).run(b.category_id, b.company_id, b.vendor, b.description, amount, b.expense_date,
         b.payment_method, b.reference, b.billable ? 1 : 0, b.receipt_url,
         b.recurring_interval ? 1 : 0, b.recurring_interval, expense.id);
  res.json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(expense.id));
}));

router.delete('/:id', handler((req, res) => {
  const info = db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw notFound('Expense not found');
  res.status(204).end();
}));

module.exports = router;
