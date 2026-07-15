// Port of src/routes/reports.js.

import { json, round2, all } from '../helpers.js';

export function registerReportRoutes(add) {
  // Everything the home screen needs in one call
  add('GET', '/api/reports/dashboard', async (c) => {
    const monthStart = "date('now', 'start of month')";

    const revenue = await c.db.prepare(`
      SELECT
        ROUND(COALESCE(SUM(amount), 0), 2) AS all_time,
        ROUND(COALESCE(SUM(CASE WHEN payment_date >= ${monthStart} THEN amount END), 0), 2) AS this_month
      FROM payments
    `).first();

    const expenses = await c.db.prepare(`
      SELECT
        ROUND(COALESCE(SUM(amount), 0), 2) AS all_time,
        ROUND(COALESCE(SUM(CASE WHEN expense_date >= ${monthStart} THEN amount END), 0), 2) AS this_month
      FROM expenses
    `).first();

    const outstanding = await c.db.prepare(`
      SELECT ROUND(COALESCE(SUM(total - amount_paid), 0), 2) AS amount, COUNT(*) AS count
      FROM invoices WHERE status IN ('sent', 'partial', 'overdue')
    `).first();

    const overdue = await c.db.prepare(`
      SELECT ROUND(COALESCE(SUM(total - amount_paid), 0), 2) AS amount, COUNT(*) AS count
      FROM invoices WHERE status = 'overdue'
    `).first();

    const pipeline = await c.db.prepare(`
      SELECT COUNT(*) AS open_deals, ROUND(COALESCE(SUM(value), 0), 2) AS value,
        ROUND(COALESCE(SUM(value * COALESCE(s.probability, 0) / 100.0), 0), 2) AS weighted_value
      FROM deals d LEFT JOIN deal_stages s ON s.id = d.stage_id WHERE d.status = 'open'
    `).first();

    const leads = await c.db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new,
        SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS qualified
      FROM leads WHERE status != 'converted'
    `).first();

    const proposals = await c.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS awaiting_response,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted
      FROM proposals
    `).first();

    const topServices = await all(c.db, `
      SELECT COALESCE(s.name, 'Custom / other') AS service, ROUND(SUM(ii.amount), 2) AS billed
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id AND i.status != 'cancelled'
      LEFT JOIN services s ON s.id = ii.service_id
      GROUP BY s.id ORDER BY billed DESC LIMIT 5
    `);

    const tasksDue = await c.db.prepare(`
      SELECT COUNT(*) AS count FROM tasks
      WHERE status NOT IN ('done', 'cancelled') AND due_date <= date('now', '+7 days')
    `).first();

    return json({
      revenue,
      expenses,
      profit: {
        all_time: round2(revenue.all_time - expenses.all_time),
        this_month: round2(revenue.this_month - expenses.this_month),
      },
      outstanding_invoices: outstanding,
      overdue_invoices: overdue,
      pipeline,
      leads,
      proposals,
      top_services: topServices,
      tasks_due_this_week: tasksDue.count,
    });
  });

  // Monthly revenue (payments received), expenses and profit
  add('GET', '/api/reports/profit-loss', async (c) => {
    const { from, to } = c.query;
    const income = await all(c.db, `
      SELECT strftime('%Y-%m', payment_date) AS month, ROUND(SUM(amount), 2) AS total
      FROM payments WHERE (? IS NULL OR payment_date >= ?) AND (? IS NULL OR payment_date <= ?)
      GROUP BY month
    `, [from ?? null, from ?? null, to ?? null, to ?? null]);
    const spend = await all(c.db, `
      SELECT strftime('%Y-%m', expense_date) AS month, ROUND(SUM(amount), 2) AS total
      FROM expenses WHERE (? IS NULL OR expense_date >= ?) AND (? IS NULL OR expense_date <= ?)
      GROUP BY month
    `, [from ?? null, from ?? null, to ?? null, to ?? null]);

    const months = [...new Set([...income.map((r) => r.month), ...spend.map((r) => r.month)])].sort();
    const rows = months.map((month) => {
      const revenue = income.find((r) => r.month === month)?.total ?? 0;
      const expenses = spend.find((r) => r.month === month)?.total ?? 0;
      return { month, revenue, expenses, profit: round2(revenue - expenses) };
    });
    return json({
      months: rows,
      totals: {
        revenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
        expenses: round2(rows.reduce((s, r) => s + r.expenses, 0)),
        profit: round2(rows.reduce((s, r) => s + r.profit, 0)),
      },
    });
  });

  // Sales funnel: win rate and value by stage
  add('GET', '/api/reports/sales', async (c) => {
    const byStage = await all(c.db, `
      SELECT s.name AS stage, COUNT(d.id) AS deals, ROUND(COALESCE(SUM(d.value), 0), 2) AS value
      FROM deal_stages s LEFT JOIN deals d ON d.stage_id = s.id AND d.status = 'open'
      GROUP BY s.id ORDER BY s.position
    `);
    const closed = await all(c.db, `
      SELECT status, COUNT(*) AS count, ROUND(COALESCE(SUM(value), 0), 2) AS value
      FROM deals WHERE status IN ('won', 'lost') GROUP BY status
    `);
    const won = closed.find((r) => r.status === 'won') ?? { count: 0, value: 0 };
    const lost = closed.find((r) => r.status === 'lost') ?? { count: 0, value: 0 };
    const winRate = won.count + lost.count > 0 ? round2((won.count / (won.count + lost.count)) * 100) : null;
    return json({ pipeline_by_stage: byStage, won, lost, win_rate_percent: winRate });
  });

  // Revenue and outstanding balance per client
  add('GET', '/api/reports/clients', async (c) => {
    return json(await all(c.db, `
      SELECT c.id, c.name,
        COUNT(DISTINCT i.id) AS invoices,
        ROUND(COALESCE(SUM(i.total), 0), 2) AS billed,
        ROUND(COALESCE(SUM(i.amount_paid), 0), 2) AS paid,
        ROUND(COALESCE(SUM(CASE WHEN i.status IN ('sent','partial','overdue') THEN i.total - i.amount_paid ELSE 0 END), 0), 2) AS outstanding
      FROM companies c LEFT JOIN invoices i ON i.company_id = c.id AND i.status != 'cancelled'
      GROUP BY c.id ORDER BY billed DESC
    `));
  });
}
