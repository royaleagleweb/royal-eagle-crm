const { db, getSetting } = require('../db');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Generates sequential document numbers like INV-2026-0001, scoped per year.
 */
function nextDocumentNumber(table, prefixSettingKey) {
  const prefix = getSetting(prefixSettingKey) || 'DOC';
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = db
    .prepare(`SELECT number FROM ${table} WHERE number LIKE ? ORDER BY CAST(substr(number, -4) AS INTEGER) DESC LIMIT 1`)
    .get(like);
  const nextSeq = row ? parseInt(row.number.slice(-4), 10) + 1 : 1;
  return `${prefix}-${year}-${String(nextSeq).padStart(4, '0')}`;
}

/**
 * Normalizes line items and computes document totals.
 * Returns { items, subtotal, discount, taxRate, taxAmount, total }.
 */
function computeTotals(rawItems, { discount = 0, taxRate = 0 } = {}) {
  const items = (rawItems || []).map((item, i) => {
    const quantity = Number(item.quantity ?? 1);
    const unitPrice = Number(item.unit_price ?? item.unitPrice ?? 0);
    if (!item.description || String(item.description).trim() === '') {
      throw badRequest(`Item ${i + 1} is missing a description`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) throw badRequest(`Item ${i + 1} has an invalid quantity`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw badRequest(`Item ${i + 1} has an invalid unit price`);
    return {
      service_id: item.service_id ?? null,
      description: String(item.description).trim(),
      quantity,
      unit_price: round2(unitPrice),
      amount: round2(quantity * unitPrice),
      position: i + 1,
    };
  });

  const subtotal = round2(items.reduce((sum, item) => sum + item.amount, 0));
  const normalizedDiscount = round2(Number(discount) || 0);
  if (normalizedDiscount < 0 || normalizedDiscount > subtotal) throw badRequest('Discount must be between 0 and the subtotal');
  const normalizedTaxRate = Number(taxRate) || 0;
  if (normalizedTaxRate < 0 || normalizedTaxRate > 100) throw badRequest('Tax rate must be between 0 and 100');
  const taxAmount = round2((subtotal - normalizedDiscount) * (normalizedTaxRate / 100));
  const total = round2(subtotal - normalizedDiscount + taxAmount);

  return { items, subtotal, discount: normalizedDiscount, taxRate: normalizedTaxRate, taxAmount, total };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function notFound(message = 'Not found') {
  const err = new Error(message);
  err.status = 404;
  return err;
}

/** Wraps an async/sync route handler so thrown errors reach the error middleware. */
const handler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function logActivity({ type = 'system', content, relatedType, relatedId, userId = null }) {
  db.prepare('INSERT INTO activities (type, content, related_type, related_id, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(type, content, relatedType, relatedId, userId);
}

function addDays(dateStr, days) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/**
 * Consecutive-day streak (Growth module: habits, journal). Given a list of
 * 'YYYY-MM-DD' dates something happened, counts back from today (or
 * yesterday, so a streak isn't wiped out before the day is over) as long as
 * each prior day also has an entry. Returns 0 if neither today nor
 * yesterday has one — a streak that's gone cold reads as gone, not stale.
 */
function dailyStreak(dateStrings) {
  const days = new Set(dateStrings);
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  let anchor;
  if (days.has(todayStr)) anchor = todayStr;
  else if (days.has(yesterdayStr)) anchor = yesterdayStr;
  else return 0;

  let streak = 1;
  const cursor = new Date(`${anchor}T00:00:00Z`);
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (days.has(cursor.toISOString().slice(0, 10))) streak++;
    else break;
  }
  return streak;
}

/** Monday of the week containing dateStr, as 'YYYY-MM-DD'. */
function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

/** Same idea as dailyStreak but for weekly-frequency habits: consecutive weeks with a checkin. */
function weeklyStreak(dateStrings) {
  const weeks = new Set(dateStrings.map(weekStart));
  const thisWeek = weekStart(new Date().toISOString().slice(0, 10));
  const lastWeek = (() => {
    const d = new Date(`${thisWeek}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  })();

  let anchor;
  if (weeks.has(thisWeek)) anchor = thisWeek;
  else if (weeks.has(lastWeek)) anchor = lastWeek;
  else return 0;

  let streak = 1;
  const cursor = new Date(`${anchor}T00:00:00Z`);
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() - 7);
    if (weeks.has(cursor.toISOString().slice(0, 10))) streak++;
    else break;
  }
  return streak;
}

module.exports = {
  round2, nextDocumentNumber, computeTotals, badRequest, notFound, handler, logActivity, addDays,
  dailyStreak, weeklyStreak,
};
