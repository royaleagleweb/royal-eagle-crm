/**
 * Royal Eagle CRM — Cloudflare Workers port of the Express backend in src/.
 *
 * Zero runtime dependencies: a hand-rolled router (array of
 * { method, regex, handler } entries matched in order, same pattern as the
 * src routes), Cloudflare D1 for data (binding DB), R2 for file bytes
 * (binding FILES), WebCrypto for JWT (HMAC-SHA256) and password hashing
 * (PBKDF2-SHA256, 25k iterations). The SPA in public/ is served via Workers
 * assets (binding ASSETS) with SPA fallback; only /api/* reaches this worker
 * (run_worker_first in wrangler.jsonc).
 *
 * Known differences from the Node backend (everything else is identical —
 * same endpoints, status codes, {error} JSON, money math, numbering and
 * status-transition guards):
 *
 * 1. Transactions: D1 has no interactive BEGIN/COMMIT. Multi-statement
 *    writes (lead convert, proposal/invoice create, convert-to-invoice,
 *    payments) run as sequential statements, using db.batch() (atomic) for
 *    the item-replacement and payment steps. A crash mid-flow could leave a
 *    partial record, which the Node version's transactions would roll back.
 * 2. Passwords: PBKDF2-SHA256 (pbkdf2$25000$<salt>$<hash>) instead of
 *    bcrypt — hashes are not interchangeable between the two backends.
 * 3. Email: Resend HTTP API (RESEND_API_KEY / EMAIL_FROM) instead of SMTP;
 *    without a key it behaves like the Node dev mode
 *    ({ delivered: false, dev: true }).
 * 4. Files: bytes stored in R2 under the file id (files.r2_key) instead of
 *    a BLOB column; the upload/download/delete API is unchanged.
 * 5. Seeding: defaults are inserted lazily on the first request that finds
 *    an empty settings table (src/db.js seeds at process start).
 */

import { json, badRequest, unauthorized, forbidden } from './helpers.js';
import { verifyToken, jwtSecret } from './security.js';
import { ensureSeeded } from './seed.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCompanyRoutes } from './routes/companies.js';
import { registerContactRoutes } from './routes/contacts.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerDealRoutes } from './routes/deals.js';
import { registerServiceRoutes } from './routes/services.js';
import { registerProposalRoutes } from './routes/proposals.js';
import { registerInvoiceRoutes } from './routes/invoices.js';
import { registerExpenseRoutes } from './routes/expenses.js';
import { registerFileRoutes } from './routes/files.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerActivityRoutes } from './routes/activities.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerSettingsRoutes } from './routes/settings.js';

// ---- Router: { method, regex, handler, auth, admin } matched in order ----

const routes = [];

function compilePath(path) {
  // '/api/leads/:id/convert' → ^/api/leads/(?<id>[^/]+)/convert$
  const pattern = path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => `(?<${name}>[^/]+)`);
  return new RegExp(`^${pattern}$`);
}

/** Registers a route. Options: auth (default true), admin (default false). */
function add(method, path, handler, { auth = true, admin = false } = {}) {
  routes.push({ method, regex: compilePath(path), handler, auth, admin });
}

add('GET', '/api/health', () => json({ status: 'ok', service: 'royal-eagle-crm' }), { auth: false });

registerAuthRoutes(add);
registerCompanyRoutes(add);
registerContactRoutes(add);
registerLeadRoutes(add);
registerDealRoutes(add);
registerServiceRoutes(add);
registerProposalRoutes(add);
registerInvoiceRoutes(add);
registerExpenseRoutes(add);
registerFileRoutes(add);
registerTaskRoutes(add);
registerActivityRoutes(add);
registerReportRoutes(add);
registerSettingsRoutes(add);

// ---- Auth middleware (mirrors src/middleware/auth.js) ----

async function authenticate(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized('Authentication required');

  const payload = await verifyToken(token, jwtSecret(env));
  if (!payload) throw unauthorized('Invalid or expired token');
  const user = await env.DB.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').bind(payload.sub).first();
  if (!user || !user.is_active) throw unauthorized('Account is inactive or does not exist');
  return user;
}

// ---- Fetch handler ----

async function handleApi(request, env) {
  await ensureSeeded(env);

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || url.pathname;

  const route = routes.find((r) => r.method === request.method && r.regex.test(pathname));
  if (!route) {
    // Express mounts `authenticate` on /api before the 404 fallback, so an
    // unknown API path is 401 without a valid token and 404 with one.
    await authenticate(request, env);
    return json({ error: 'Route not found' }, 404);
  }

  // Parse the JSON body (Express: invalid JSON → 400 { error })
  let body = {};
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const text = await request.text();
    if (text) {
      try { body = JSON.parse(text); } catch { throw badRequest('Invalid JSON body'); }
    }
  }

  const c = {
    req: request,
    env,
    db: env.DB,
    params: pathname.match(route.regex).groups || {},
    query: Object.fromEntries(url.searchParams),
    body,
    user: null,
  };

  if (route.auth) {
    c.user = await authenticate(request, env);
    if (route.admin && c.user.role !== 'admin') throw forbidden('Admin access required');
  }

  return route.handler(c);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Non-API requests are served from the public/ assets (SPA fallback is
    // configured in wrangler.jsonc); with run_worker_first only /api/* should
    // ever reach the worker, but be defensive.
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/api') {
      return env.ASSETS.fetch(request);
    }

    try {
      return await handleApi(request, env);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return json({ error: status >= 500 ? 'Internal server error' : err.message }, status);
    }
  },
};
