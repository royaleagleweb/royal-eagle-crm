// Port of src/routes/settings.js.

import { json, badRequest, getAllSettings, setSetting } from '../helpers.js';

const EDITABLE_KEYS = [
  'company_name', 'company_email', 'company_phone', 'company_address', 'company_website',
  'currency', 'currency_symbol', 'default_tax_rate',
  'invoice_prefix', 'proposal_prefix', 'invoice_due_days', 'proposal_valid_days',
  'invoice_terms', 'proposal_terms',
];

export function registerSettingsRoutes(add) {
  add('GET', '/api/settings', async (c) => json(await getAllSettings(c.db)));

  add('PUT', '/api/settings', async (c) => {
    const updates = c.body || {};
    const unknown = Object.keys(updates).filter((k) => !EDITABLE_KEYS.includes(k));
    if (unknown.length) throw badRequest(`Unknown settings: ${unknown.join(', ')}`);
    for (const [key, value] of Object.entries(updates)) await setSetting(c.db, key, value);
    return json(await getAllSettings(c.db));
  }, { admin: true });
}
