// Shared helpers for the Workers port — mirrors src/utils/helpers.js and the
// settings helpers from src/db.js, adapted for D1's async API.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export function notFound(message = 'Not found') {
  const err = new Error(message);
  err.status = 404;
  return err;
}

export function unauthorized(message) {
  const err = new Error(message);
  err.status = 401;
  return err;
}

export function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

/** JSON response with the same shape the Express app produces. */
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export const noContent = () => new Response(null, { status: 204 });

export const htmlResponse = (body) =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export function addDays(dateStr, days) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/**
 * Normalizes line items and computes document totals.
 * Returns { items, subtotal, discount, taxRate, taxAmount, total }.
 * Exact copy of computeTotals from src/utils/helpers.js.
 */
export function computeTotals(rawItems, { discount = 0, taxRate = 0 } = {}) {
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

/** Generates sequential document numbers like INV-2026-0001, scoped per year. */
export async function nextDocumentNumber(db, table, prefixSettingKey) {
  const prefix = (await getSetting(db, prefixSettingKey)) || 'DOC';
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = await db
    .prepare(`SELECT number FROM ${table} WHERE number LIKE ? ORDER BY CAST(substr(number, -4) AS INTEGER) DESC LIMIT 1`)
    .bind(like)
    .first();
  const nextSeq = row ? parseInt(row.number.slice(-4), 10) + 1 : 1;
  return `${prefix}-${year}-${String(nextSeq).padStart(4, '0')}`;
}

export async function logActivity(db, { type = 'system', content, relatedType, relatedId, userId = null }) {
  await db
    .prepare('INSERT INTO activities (type, content, related_type, related_id, user_id) VALUES (?, ?, ?, ?, ?)')
    .bind(type, content, relatedType, relatedId, userId)
    .run();
}

// ---- Settings (mirrors src/db.js) ----

export async function getSetting(db, key) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function getAllSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of results) settings[row.key] = row.value;
  return settings;
}

export async function setSetting(db, key, value) {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value))
    .run();
}

/** All rows from a query as a plain array (D1 .all() wraps them in {results}). */
export async function all(db, sql, params = []) {
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}
