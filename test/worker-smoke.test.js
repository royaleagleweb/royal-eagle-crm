/**
 * End-to-end smoke test for the Cloudflare Workers port (worker/), adapted
 * from test/smoke.test.js. Exercises the same full agency workflow:
 * signup → lead → convert → deal → proposal → send → accept → invoice →
 * payment → expenses → files (R2) → reports.
 *
 * Unlike smoke.test.js this does NOT start the app — it expects a running
 * `wrangler dev` server against a FRESH local D1 database:
 *
 *   npx wrangler d1 migrations apply royal-eagle-crm-db --local
 *   npx wrangler dev --port 8788 --local
 *   node test/worker-smoke.test.js         # or WORKER_URL=... node test/worker-smoke.test.js
 *
 * (Re-running against a used database will fail: registration closes after
 * the first user and document numbers start at ...-0001.)
 */

const assert = require('node:assert');

const BASE = (process.env.WORKER_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
let token = null;
let passed = 0;

async function api(method, path, body, { raw = false, expect } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = raw ? await res.text() : (res.status === 204 ? null : await res.json());
  if (expect !== undefined) {
    assert.strictEqual(res.status, expect, `${method} ${path} → ${res.status}, expected ${expect}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { status: res.status, data };
}

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  // --- Worker is up, serves the SPA and health check ---
  const spa = await fetch(BASE + '/');
  const spaHtml = await spa.text();
  assert.strictEqual(spa.status, 200);
  assert.ok(spaHtml.includes('<div id="root">') && spaHtml.includes('Royal Eagle CRM'), 'GET / returns the SPA HTML');
  ok('GET / serves the SPA HTML via Workers assets');

  const health = await api('GET', '/api/health', null, { expect: 200 });
  assert.deepStrictEqual(health.data, { status: 'ok', service: 'royal-eagle-crm' });
  ok('GET /api/health returns ok');

  // --- Auth ---
  await api('GET', '/api/companies', null, { expect: 401 });
  ok('rejects unauthenticated requests');

  const reg = await api('POST', '/api/auth/register', { name: 'Roy', email: 'roy@royaleagleweb.com', password: 'supersecret1' }, { expect: 201 });
  assert.strictEqual(reg.data.user.role, 'admin');
  token = reg.data.token;
  ok('first registered user becomes admin');

  await api('POST', '/api/auth/register', { name: 'X', email: 'x@x.com', password: 'supersecret1' }, { expect: 403 });
  ok('registration closes after first user');

  const login = await api('POST', '/api/auth/login', { email: 'roy@royaleagleweb.com', password: 'supersecret1' }, { expect: 200 });
  token = login.data.token;
  ok('login works (PBKDF2 hash verifies)');

  const me = await api('GET', '/api/auth/me', null, { expect: 200 });
  assert.strictEqual(me.data.user.email, 'roy@royaleagleweb.com');
  ok('GET /api/auth/me returns the authenticated user');

  await api('POST', '/api/auth/users', { name: 'Staffer', email: 'staff@royaleagleweb.com', password: 'supersecret1' }, { expect: 201 });
  ok('admin can create staff users');

  // --- Settings ---
  const settings = await api('GET', '/api/settings', null, { expect: 200 });
  assert.strictEqual(settings.data.company_name, 'Royal Eagle Web and Marketing');
  await api('PUT', '/api/settings', { default_tax_rate: '7', company_phone: '+1 555 0199' }, { expect: 200 });
  ok('settings read/update, company preconfigured as Royal Eagle Web and Marketing');

  // --- Services & pricing ---
  const services = await api('GET', '/api/services', null, { expect: 200 });
  assert.ok(services.data.length >= 10, 'default price list seeded');
  const seo = services.data.find((s) => s.name === 'SEO Retainer');
  assert.strictEqual(seo.unit_price, 600);
  const custom = await api('POST', '/api/services', { name: 'Rush Fee', unit_price: 250, unit: 'project' }, { expect: 201 });
  await api('POST', '/api/services', { name: 'Rush Fee', unit_price: 1 }, { expect: 400 });
  await api('PATCH', `/api/services/${custom.data.id}`, { unit_price: 300, is_active: true }, { expect: 200 });
  ok('service price list: seeded defaults, create, duplicate rejected, price update');

  // --- Lead → convert ---
  const lead = await api('POST', '/api/leads', {
    name: 'Maria Lopez', email: 'maria@sunrise.example.com', company_name: 'Sunrise Dental',
    source: 'Website form', estimated_value: 8000,
  }, { expect: 201 });
  const converted = await api('POST', `/api/leads/${lead.data.id}/convert`, { deal_title: 'Website redesign' }, { expect: 200 });
  assert.strictEqual(converted.data.lead.status, 'converted');
  assert.ok(converted.data.contact.id && converted.data.company.id && converted.data.deal.id);
  await api('POST', `/api/leads/${lead.data.id}/convert`, {}, { expect: 400 });
  await api('PATCH', `/api/leads/${lead.data.id}`, { name: 'Changed' }, { expect: 400 });
  ok('lead converts into contact + company + deal, converted lead locked');

  const companyId = converted.data.company.id;
  const contactId = converted.data.contact.id;
  const dealId = converted.data.deal.id;

  // --- Pipeline ---
  const stages = await api('GET', '/api/deals/stages', null, { expect: 200 });
  assert.ok(stages.data.length >= 5);
  await api('POST', `/api/deals/${dealId}/move`, { stage_id: stages.data[2].id }, { expect: 200 });
  const board = await api('GET', '/api/deals/pipeline', null, { expect: 200 });
  assert.ok(board.data.find((s) => s.id === stages.data[2].id).deals.some((d) => d.id === dealId));
  ok('deal moves through pipeline stages, kanban board reflects it');

  // --- Proposal ---
  const proposal = await api('POST', '/api/proposals', {
    title: 'Website Redesign & SEO', deal_id: dealId, company_id: companyId, contact_id: contactId,
    tax_rate: 7, discount: 100,
    items: [
      { description: 'Website redesign (10 pages)', quantity: 1, unit_price: 5000 },
      // catalog service (600 default) billed at a custom price
      { service_id: seo.id, description: 'SEO setup', quantity: 1, unit_price: 1500 },
      { description: 'Monthly maintenance', quantity: 3, unit_price: 250 },
    ],
  }, { expect: 201 });
  assert.strictEqual(proposal.data.items.find((i) => i.service_id === seo.id).unit_price, 1500);
  ok('line item links a catalog service but keeps its custom price');
  assert.strictEqual(proposal.data.subtotal, 7250);
  assert.strictEqual(proposal.data.tax_amount, 500.5); // (7250-100)*7%
  assert.strictEqual(proposal.data.total, 7650.5);
  assert.match(proposal.data.number, /^PRO-\d{4}-0001$/);
  ok('proposal created with line items, totals and numbering (PRO-YYYY-0001)');

  await api('POST', '/api/proposals', { title: 'bad', items: [{ description: 'x', quantity: -1, unit_price: 5 }] }, { expect: 400 });
  ok('invalid line items rejected with 400');

  const sent = await api('POST', `/api/proposals/${proposal.data.id}/send`, {}, { expect: 200 });
  assert.strictEqual(sent.data.proposal.status, 'sent');
  assert.deepStrictEqual(sent.data.email, { delivered: false, dev: true });
  ok('proposal emails to client contact (dev mode without RESEND_API_KEY) and is marked sent');

  const html = await api('GET', `/api/proposals/${proposal.data.id}/html`, null, { raw: true, expect: 200 });
  assert.ok(html.data.includes('Royal Eagle Web and Marketing') && html.data.includes('Website redesign (10 pages)'));
  ok('proposal renders as branded print-ready HTML');

  await api('POST', `/api/proposals/${proposal.data.id}/accept`, {}, { expect: 200 });
  await api('PATCH', `/api/proposals/${proposal.data.id}`, { title: 'Nope' }, { expect: 400 });
  ok('accepted proposal cannot be edited');

  // --- Invoice from proposal ---
  const invoice = (await api('POST', `/api/proposals/${proposal.data.id}/convert-to-invoice`, {}, { expect: 201 })).data;
  assert.strictEqual(invoice.total, 7650.5);
  assert.strictEqual(invoice.items.length, 3);
  assert.match(invoice.number, /^INV-\d{4}-0001$/);
  await api('POST', `/api/proposals/${proposal.data.id}/convert-to-invoice`, {}, { expect: 400 });
  ok('accepted proposal converts to invoice exactly once');

  await api('POST', `/api/invoices/${invoice.id}/send`, {}, { expect: 200 });

  // --- Payments ---
  await api('POST', `/api/invoices/${invoice.id}/payments`, { amount: 9999999 }, { expect: 400 });
  const partial = await api('POST', `/api/invoices/${invoice.id}/payments`, { amount: 3000, method: 'stripe' }, { expect: 201 });
  assert.strictEqual(partial.data.status, 'partial');
  assert.strictEqual(partial.data.balance, 4650.5);
  const paid = await api('POST', `/api/invoices/${invoice.id}/payments`, { amount: 4650.5, method: 'bank_transfer' }, { expect: 201 });
  assert.strictEqual(paid.data.status, 'paid');
  assert.strictEqual(paid.data.balance, 0);
  await api('POST', `/api/invoices/${invoice.id}/cancel`, {}, { expect: 400 });
  ok('payments recorded: partial → paid, overpayment rejected, paid invoice cannot be cancelled');

  await api('POST', `/api/deals/${dealId}/win`, {}, { expect: 200 });

  // --- Expenses ---
  const categories = await api('GET', '/api/expenses/categories', null, { expect: 200 });
  assert.ok(categories.data.length >= 10);
  await api('POST', '/api/expenses', {
    category_id: categories.data.find((c) => c.name === 'Software & Subscriptions').id,
    vendor: 'Adobe', description: 'Creative Cloud', amount: 59.99, recurring_interval: 'monthly',
  }, { expect: 201 });
  await api('POST', '/api/expenses', {
    category_id: categories.data.find((c) => c.name === 'Advertising & Marketing').id,
    vendor: 'Google Ads', description: 'Client ad spend', amount: 350, billable: true, company_id: companyId,
  }, { expect: 201 });
  await api('POST', '/api/expenses', { description: 'no amount' }, { expect: 400 });
  const summary = await api('GET', '/api/expenses/summary', null, { expect: 200 });
  assert.strictEqual(summary.data.total, 409.99);
  assert.strictEqual(summary.data.by_category.length, 2);
  ok('expenses tracked with categories, billable flag and summary report');

  // --- Files (metadata in D1, bytes in R2) ---
  const content = Buffer.from('Signed agreement PDF bytes').toString('base64');
  const file = await api('POST', '/api/files', { name: 'sunrise-agreement.pdf', mime: 'application/pdf', data: content, company_id: companyId }, { expect: 201 });
  await api('POST', '/api/files', { name: 'empty.pdf', data: '' }, { expect: 400 });
  const files = await api('GET', '/api/files', null, { expect: 200 });
  assert.ok(files.data.some((f) => f.name === 'sunrise-agreement.pdf' && f.company_id === companyId));
  const download = await api('GET', `/api/files/${file.data.id}/download`, null, { raw: true, expect: 200 });
  assert.strictEqual(download.data, 'Signed agreement PDF bytes');
  await api('DELETE', `/api/files/${file.data.id}`, null, { expect: 204 });
  await api('GET', `/api/files/${file.data.id}/download`, null, { expect: 404 });
  ok('files upload, list by client, R2 download round-trip, delete removes bytes');

  // --- Tasks & activities ---
  await api('POST', '/api/tasks', { title: 'Kickoff call', related_type: 'deal', related_id: dealId, priority: 'high' }, { expect: 201 });
  await api('POST', '/api/activities', { type: 'call', content: 'Discussed launch timeline', related_type: 'deal', related_id: dealId }, { expect: 201 });
  const dealDetail = await api('GET', `/api/deals/${dealId}`, null, { expect: 200 });
  assert.ok(dealDetail.data.activities.length >= 2); // manual call + system logs
  ok('tasks and activity timeline attach to records');

  // --- Reports ---
  const svcRevenue = (await api('GET', '/api/services/revenue', null, { expect: 200 })).data;
  assert.strictEqual(svcRevenue.find((r) => r.service === 'SEO Retainer').billed, 1500);
  ok('revenue by service tracks catalog items at their custom price');

  const dash = (await api('GET', '/api/reports/dashboard', null, { expect: 200 })).data;
  assert.ok(dash.top_services.some((s) => s.service === 'SEO Retainer' && s.billed === 1500));
  assert.strictEqual(dash.revenue.all_time, 7650.5);
  assert.strictEqual(dash.expenses.all_time, 409.99);
  assert.strictEqual(dash.profit.all_time, 7240.51);
  ok('dashboard: revenue, expenses and profit are consistent');

  const pl = (await api('GET', '/api/reports/profit-loss', null, { expect: 200 })).data;
  assert.strictEqual(pl.totals.profit, 7240.51);
  const sales = (await api('GET', '/api/reports/sales', null, { expect: 200 })).data;
  assert.strictEqual(sales.won.count, 1);
  assert.strictEqual(sales.win_rate_percent, 100);
  const clients = (await api('GET', '/api/reports/clients', null, { expect: 200 })).data;
  assert.strictEqual(clients.find((c) => c.id === companyId).outstanding, 0);
  ok('profit & loss, sales funnel and per-client reports');

  console.log(`\nAll ${passed} worker smoke checks passed.`);
}

main().catch((err) => {
  console.error('\nWORKER SMOKE TEST FAILED:', err.message);
  process.exitCode = 1;
});
