const express = require('express');
const { db } = require('../db');
const { round2, dailyStreak, weeklyStreak } = require('../utils/helpers');

const router = express.Router();

// Shared by /dashboard (compact card) and /growth (full picture): today's
// habit completion and each active habit's current streak.
function habitSnapshot() {
  const habits = db.prepare("SELECT * FROM habits WHERE is_active = 1").all();
  const checkins = db.prepare('SELECT habit_id, checkin_date FROM habit_checkins').all();
  const byHabit = {};
  for (const c of checkins) (byHabit[c.habit_id] ??= []).push(c.checkin_date);

  const today = new Date().toISOString().slice(0, 10);
  let todayCompleted = 0;
  let longestStreak = 0;
  const currentStreaks = [];
  for (const h of habits) {
    const dates = byHabit[h.id] || [];
    if (dates.includes(today)) todayCompleted++;
    const streak = h.frequency === 'weekly' ? weeklyStreak(dates) : dailyStreak(dates);
    currentStreaks.push({ habit_id: h.id, title: h.title, streak });
    if (streak > longestStreak) longestStreak = streak;
  }
  return { todayCompleted, todayTotal: habits.length, currentStreaks, longestStreak };
}

// Everything the home screen needs in one call
router.get('/dashboard', (req, res) => {
  const monthStart = "date('now', 'start of month')";

  const revenue = db.prepare(`
    SELECT
      ROUND(COALESCE(SUM(amount), 0), 2) AS all_time,
      ROUND(COALESCE(SUM(CASE WHEN payment_date >= ${monthStart} THEN amount END), 0), 2) AS this_month
    FROM payments
  `).get();

  const expenses = db.prepare(`
    SELECT
      ROUND(COALESCE(SUM(amount), 0), 2) AS all_time,
      ROUND(COALESCE(SUM(CASE WHEN expense_date >= ${monthStart} THEN amount END), 0), 2) AS this_month
    FROM expenses
  `).get();

  const outstanding = db.prepare(`
    SELECT ROUND(COALESCE(SUM(total - amount_paid), 0), 2) AS amount, COUNT(*) AS count
    FROM invoices WHERE status IN ('sent', 'partial', 'overdue')
  `).get();

  const overdue = db.prepare(`
    SELECT ROUND(COALESCE(SUM(total - amount_paid), 0), 2) AS amount, COUNT(*) AS count
    FROM invoices WHERE status = 'overdue'
  `).get();

  const pipeline = db.prepare(`
    SELECT COUNT(*) AS open_deals, ROUND(COALESCE(SUM(value), 0), 2) AS value,
      ROUND(COALESCE(SUM(value * COALESCE(s.probability, 0) / 100.0), 0), 2) AS weighted_value
    FROM deals d LEFT JOIN deal_stages s ON s.id = d.stage_id WHERE d.status = 'open'
  `).get();

  const leads = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new,
      SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS qualified
    FROM leads WHERE status != 'converted'
  `).get();

  const proposals = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS awaiting_response,
      SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted
    FROM proposals
  `).get();

  const topServices = db.prepare(`
    SELECT COALESCE(s.name, 'Custom / other') AS service, ROUND(SUM(ii.amount), 2) AS billed
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id AND i.status != 'cancelled'
    LEFT JOIN services s ON s.id = ii.service_id
    GROUP BY s.id ORDER BY billed DESC LIMIT 5
  `).all();

  const tasksDue = db.prepare(`
    SELECT COUNT(*) AS count FROM tasks
    WHERE status NOT IN ('done', 'cancelled') AND due_date <= date('now', '+7 days')
  `).get();

  const activeGoals = db.prepare("SELECT COUNT(*) AS n FROM goals WHERE status = 'active'").get().n;
  const { todayCompleted, todayTotal, longestStreak } = habitSnapshot();

  res.json({
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
    // Compact Growth card — the full picture (goals, per-habit streaks, journal) lives on the Growth page.
    growth: {
      habits_today: `${todayCompleted}/${todayTotal}`,
      longest_streak: longestStreak,
      active_goals: activeGoals,
    },
  });
});

// Monthly revenue (payments received), expenses and profit
router.get('/profit-loss', (req, res) => {
  const { from, to } = req.query;
  const income = db.prepare(`
    SELECT strftime('%Y-%m', payment_date) AS month, ROUND(SUM(amount), 2) AS total
    FROM payments WHERE (? IS NULL OR payment_date >= ?) AND (? IS NULL OR payment_date <= ?)
    GROUP BY month
  `).all(from ?? null, from ?? null, to ?? null, to ?? null);
  const spend = db.prepare(`
    SELECT strftime('%Y-%m', expense_date) AS month, ROUND(SUM(amount), 2) AS total
    FROM expenses WHERE (? IS NULL OR expense_date >= ?) AND (? IS NULL OR expense_date <= ?)
    GROUP BY month
  `).all(from ?? null, from ?? null, to ?? null, to ?? null);

  const months = [...new Set([...income.map((r) => r.month), ...spend.map((r) => r.month)])].sort();
  const rows = months.map((month) => {
    const revenue = income.find((r) => r.month === month)?.total ?? 0;
    const expenses = spend.find((r) => r.month === month)?.total ?? 0;
    return { month, revenue, expenses, profit: round2(revenue - expenses) };
  });
  res.json({
    months: rows,
    totals: {
      revenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
      expenses: round2(rows.reduce((s, r) => s + r.expenses, 0)),
      profit: round2(rows.reduce((s, r) => s + r.profit, 0)),
    },
  });
});

// Sales funnel: win rate and value by stage
router.get('/sales', (req, res) => {
  const byStage = db.prepare(`
    SELECT s.name AS stage, COUNT(d.id) AS deals, ROUND(COALESCE(SUM(d.value), 0), 2) AS value
    FROM deal_stages s LEFT JOIN deals d ON d.stage_id = s.id AND d.status = 'open'
    GROUP BY s.id ORDER BY s.position
  `).all();
  const closed = db.prepare(`
    SELECT status, COUNT(*) AS count, ROUND(COALESCE(SUM(value), 0), 2) AS value
    FROM deals WHERE status IN ('won', 'lost') GROUP BY status
  `).all();
  const won = closed.find((r) => r.status === 'won') ?? { count: 0, value: 0 };
  const lost = closed.find((r) => r.status === 'lost') ?? { count: 0, value: 0 };
  const winRate = won.count + lost.count > 0 ? round2((won.count / (won.count + lost.count)) * 100) : null;
  res.json({ pipeline_by_stage: byStage, won, lost, win_rate_percent: winRate });
});

// Revenue and outstanding balance per client
router.get('/clients', (req, res) => {
  res.json(db.prepare(`
    SELECT c.id, c.name,
      COUNT(DISTINCT i.id) AS invoices,
      ROUND(COALESCE(SUM(i.total), 0), 2) AS billed,
      ROUND(COALESCE(SUM(i.amount_paid), 0), 2) AS paid,
      ROUND(COALESCE(SUM(CASE WHEN i.status IN ('sent','partial','overdue') THEN i.total - i.amount_paid ELSE 0 END), 0), 2) AS outstanding
    FROM companies c LEFT JOIN invoices i ON i.company_id = c.id AND i.status != 'cancelled'
    GROUP BY c.id ORDER BY billed DESC
  `).all());
});

// "Am I following through" — an honest, unflattering-when-warranted look at
// whether tasks get done, leads get worked, and there's a daily rhythm of activity.
router.get('/productivity', (req, res) => {
  // Task completion rate: done vs total created in the last 30 days.
  const taskStats = db.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
    FROM tasks WHERE created_at >= datetime('now', '-30 days')
  `).get();
  const completionRatePercent = taskStats.total > 0 ? round2((taskStats.done / taskStats.total) * 100) : null;

  const tasksOverdue = db.prepare(`
    SELECT COUNT(*) AS count FROM tasks
    WHERE status NOT IN ('done', 'cancelled') AND due_date IS NOT NULL AND due_date < date('now')
  `).get().count;

  // Time-to-first-contact: hours between a lead's creation and the earlier of
  // (a) its first logged activity or (b) its conversion — averaged over leads
  // that reached "contacted" or "converted" in the last 30 days.
  const leadRows = db.prepare(`
    SELECT l.id, l.created_at,
      (SELECT MIN(a.created_at) FROM activities a WHERE a.related_type = 'lead' AND a.related_id = l.id) AS first_activity_at,
      CASE WHEN l.status = 'converted' THEN l.updated_at ELSE NULL END AS converted_at
    FROM leads l
    WHERE l.created_at >= datetime('now', '-30 days') AND l.status IN ('contacted', 'converted')
  `).all();

  const toMs = (sqliteDatetime) => new Date(sqliteDatetime.replace(' ', 'T') + 'Z').getTime();
  const contactHours = [];
  for (const l of leadRows) {
    const touches = [l.first_activity_at, l.converted_at].filter(Boolean).map(toMs);
    if (!touches.length) continue;
    const hours = (Math.min(...touches) - toMs(l.created_at)) / 3600000;
    if (Number.isFinite(hours) && hours >= 0) contactHours.push(hours);
  }
  const avgHoursToFirstContact = contactHours.length
    ? round2(contactHours.reduce((sum, h) => sum + h, 0) / contactHours.length)
    : null;

  // Activity streak: consecutive calendar days, most recent first, with at least
  // one activity or completed task that day. Deal stage moves/wins/losses are not
  // queried separately here — deals.js already logs a system activity row for each
  // one, so counting `activities` avoids double-counting the same event.
  const activeDays = db.prepare(`
    SELECT DISTINCT day FROM (
      SELECT date(created_at) AS day FROM activities
      UNION
      SELECT date(completed_at) AS day FROM tasks WHERE status = 'done' AND completed_at IS NOT NULL
    ) ORDER BY day DESC
  `).all().map((r) => r.day);

  let streakDays = 0;
  if (activeDays.length) {
    streakDays = 1;
    const cursor = new Date(`${activeDays[0]}T00:00:00Z`);
    for (let i = 1; i < activeDays.length; i++) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      if (activeDays[i] === cursor.toISOString().slice(0, 10)) streakDays++;
      else break;
    }
  }

  // 30-day daily activity count (activities + task completions that day).
  const dailyRaw = db.prepare(`
    SELECT day, SUM(cnt) AS count FROM (
      SELECT date(created_at) AS day, COUNT(*) AS cnt FROM activities
      WHERE created_at >= date('now', '-30 days') GROUP BY day
      UNION ALL
      SELECT date(completed_at) AS day, COUNT(*) AS cnt FROM tasks
      WHERE status = 'done' AND completed_at IS NOT NULL AND completed_at >= date('now', '-30 days') GROUP BY day
    ) GROUP BY day
  `).all();
  const dailyMap = Object.fromEntries(dailyRaw.map((r) => [r.day, r.count]));
  const dailyActivity = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    dailyActivity.push({ date: day, count: dailyMap[day] || 0 });
  }

  res.json({
    completion_rate_percent: completionRatePercent,
    tasks_created_30d: taskStats.total,
    tasks_done_30d: taskStats.done || 0,
    tasks_overdue: tasksOverdue,
    avg_hours_to_first_contact: avgHoursToFirstContact,
    streak_days: streakDays,
    daily_activity: dailyActivity,
  });
});

// The Growth module's own honest mirror — goals and habits and journaling,
// spanning business AND personal life, not just business follow-through.
router.get('/growth', (req, res) => {
  const goalsActive = db.prepare("SELECT COUNT(*) AS n FROM goals WHERE status = 'active'").get().n;
  const goalsDoneLast30d = db.prepare(`
    SELECT COUNT(*) AS n FROM goals WHERE status = 'done' AND completed_at >= datetime('now', '-30 days')
  `).get().n;
  const goalsByArea = db.prepare(`
    SELECT area,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
    FROM goals GROUP BY area ORDER BY area
  `).all();

  const { todayCompleted, todayTotal, currentStreaks, longestStreak } = habitSnapshot();

  const journalDays = db.prepare('SELECT DISTINCT entry_date FROM journal_entries').all().map((r) => r.entry_date);
  const journalEntries30d = db.prepare(`
    SELECT COUNT(*) AS n FROM journal_entries WHERE entry_date >= date('now', '-30 days')
  `).get().n;

  res.json({
    goals: { active: goalsActive, done_last_30d: goalsDoneLast30d, by_area: goalsByArea },
    habits: {
      today_completed: todayCompleted,
      today_total: todayTotal,
      current_streaks: currentStreaks,
      longest_streak: longestStreak,
    },
    journal: { entries_last_30d: journalEntries30d, current_streak: dailyStreak(journalDays) },
  });
});

module.exports = router;
