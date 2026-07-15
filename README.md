# Royal Eagle CRM

A complete CRM for **Royal Eagle Web and Marketing**: track leads and clients, move deals through a sales pipeline, send proposals, invoice clients, record payments, track business expenses, and see the health of the business on one dashboard — through a REST API **and a built-in web portal**.

## Web portal

Start the server and open **http://localhost:3000** — you'll get a login screen. The first account created becomes the admin (or run `npm run seed` for a ready-made admin + sample data).

The portal is QuickBooks-inspired and covers the whole workflow:

- **Dashboard** — income, expenses and profit (this month + all time), unpaid/overdue invoices, pipeline value, leads, proposals awaiting reply, tasks due, top services billed, spending by category
- **Services & Pricing** — your editable price list (10 agency services seeded with default prices); picking a service on an invoice or proposal pre-fills its price, and every line still accepts a custom price
- **"+ New" quick-create** — invoice, proposal, expense, lead, client, deal or task from anywhere
- **Leads** — capture, qualify, and one-click convert to client + deal
- **Pipeline** — kanban board with stage totals; move, win, or lose deals inline
- **Proposals & Invoices** — line-item editor, send by email, record payments, and **View / print** opens the branded, print-ready document (print to PDF from the browser)
- **Expenses** — record one-time or recurring expenses, mark billable to a client, see category totals
- **Reports** — monthly Profit & Loss, sales funnel with win rate, per-client billed/paid/outstanding
- **Productivity report** — "am I following through": task completion rate, tasks overdue, average time-to-first-contact on leads, a daily activity streak, and a 14-day activity trend — colored red/amber/green so a bad week actually reads as bad
- **Growth** — the same honest-mirror philosophy extended to the whole person, not just business: daily/weekly habit check-ins with streaks, goals (business, health, finance, relationships, growth, other) with optional numeric progress bars, and a daily journal
- **Settings** — company profile, currency, tax rate, numbering, terms (admin only), and per-device push notification opt-in

No build step — the portal is plain HTML/CSS/JS served by Express. It's also installable as a PWA (see **Mobile & Notifications** below) and works on phones down to 375px wide.

The feature set is modeled on what the most popular open-source CRMs on [github.com/topics/crm](https://github.com/topics/crm) (Twenty, ERPNext, Krayin/Laravel CRM, EspoCRM) have in common:

| Feature | What you get |
|---|---|
| **Contacts & Companies** | Client records with search, notes, owners, and full relationship views |
| **Leads** | Capture leads with source + status, one-click convert to contact + company + deal |
| **Deals & Pipeline** | Customizable stages with win probability, kanban board endpoint, win/lose tracking |
| **Proposals** | Line items, discounts, tax, auto-numbering (`PRO-2026-0001`), branded HTML, email to client, accept/decline |
| **Invoices** | Convert accepted proposals to invoices in one call, auto-numbering (`INV-2026-0001`), due dates, overdue detection, email to client |
| **Payments** | Record partial/full payments (bank, card, Stripe, PayPal, cash…), automatic status transitions |
| **Expenses** | Categorized expense tracking, recurring expenses, billable-to-client flag, category & monthly summaries |
| **Tasks** | Priorities, due dates, assignees, linkable to any record, overdue filter |
| **Activity timeline** | Notes, calls, emails, meetings logged against contacts, deals, invoices, etc. |
| **Reports** | Dashboard (revenue / expenses / profit / pipeline / outstanding invoices), monthly P&L, sales funnel + win rate, per-client revenue |
| **Users & auth** | JWT auth, admin/staff roles, admin-managed accounts |
| **Settings** | Company profile, currency, tax rate, numbering prefixes, payment terms (preconfigured for Royal Eagle Web and Marketing) |

## Stack

- **Node.js 22+** — uses the built-in `node:sqlite` database, so there are no native dependencies and nothing else to install or host.
- **Express 5** for routing, **JWT** auth, **nodemailer** for SMTP email.
- Single-file SQLite database (`data/crm.sqlite` by default) — trivial to back up.

## Quick start

Requires [Node.js](https://nodejs.org) 22.13 or newer (`node --version` to check).

Until the pull request is merged, the code lives on the `claude/crm-features-research-eeu4te` branch — clone it directly:

```bash
git clone -b claude/crm-features-research-eeu4te https://github.com/royaleagleweb/CRMBACEND.git
cd CRMBACEND
npm install
npm run seed     # creates admin user + sample data (prints login credentials)
npm start        # then open http://localhost:3000 in your browser
```

Log in with `roy@royaleagleweb.com` / `RoyalEagle2026!` (change it after first login).

Run the end-to-end test suite (covers the full lead → proposal → invoice → payment → reports flow):

```bash
npm test
```

Push notification plumbing and the productivity report have their own suite (mocks the actual push send, so it never hits a real push service):

```bash
npm run test:notifications
```

The Growth module (goals, habits, journal) has its own suite too:

```bash
npm run test:growth
```

## Put it online (get a real link)

`http://localhost:3000` only works on the computer where the app is running. To get a public `https://` link your whole team can open:

1. Create an account at [render.com](https://render.com) and connect your GitHub.
2. In the Render dashboard choose **New → Blueprint** and pick this repository (branch `claude/crm-features-research-eeu4te` until the PR is merged, or `main` after).
3. Render reads `render.yaml`, builds the included `Dockerfile`, attaches a 1 GB disk for the database, and gives you a URL like `https://royal-eagle-crm.onrender.com`.
4. Open that URL, create the admin account on first visit, and you're in business.

Any Docker-capable host works the same way (Railway, Fly.io, a VPS): build the image, mount a volume at `/data`, set `JWT_SECRET`.

## Deploy to Cloudflare (free)

The repo also contains a full Cloudflare Workers port of the backend (`worker/` + `wrangler.jsonc` + `migrations/`) that runs on Cloudflare's free tier: the API on Workers, the database on D1, uploaded files on R2, and the web portal served as static assets. The Express backend in `src/` is untouched — both deployments serve the same SPA and the same `/api` contract.

**One-click** (requires the repository to be public):

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/royaleagleweb/CRMBACEND)

**Manual path:**

```bash
npm install                                                    # installs wrangler (devDependency)
npx wrangler login
npx wrangler d1 create royal-eagle-crm-db                      # copy the database_id it prints into wrangler.jsonc
npx wrangler d1 migrations apply royal-eagle-crm-db --remote
npx wrangler deploy
npx wrangler secret put JWT_SECRET                             # set a strong secret
```

Optional email delivery (Workers can't use SMTP): create a free [Resend](https://resend.com) API key and set `npx wrangler secret put RESEND_API_KEY` (and `EMAIL_FROM` as a var if you have a verified sender — defaults to `onboarding@resend.dev`). Without it, "send" endpoints work in dev mode (logged, not delivered), exactly like running the Node backend without `SMTP_HOST`.

Local development / tests for the Workers port:

```bash
npx wrangler d1 migrations apply royal-eagle-crm-db --local
npx wrangler dev --port 8788 --local
node test/worker-smoke.test.js       # in another terminal, against a fresh local DB
```

Known differences from the Node backend (also documented at the top of `worker/index.js`): PBKDF2 password hashes instead of bcrypt (accounts are not portable between the two backends), Resend HTTP API instead of SMTP, file bytes in R2 instead of a database BLOB, multi-statement writes use sequential/batched D1 statements instead of SQLite transactions, and defaults are seeded lazily on first request. All endpoint shapes, status codes, totals math, numbering and status-transition guards are identical.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_FILE` | `data/crm.sqlite` | SQLite database location |
| `JWT_SECRET` | `change-me-in-production` | **Set this in production** |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` / `SMTP_FROM` | — | Email delivery. Without `SMTP_HOST`, "send" endpoints still work but log instead of emailing (dev mode). |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | `roy@royaleagleweb.com` / `RoyalEagle2026!` | Seed credentials — change the password after first login |

VAPID keys for Web Push are generated automatically the first time the server starts and stored in the `settings` table — no environment variable or manual setup needed.

## Mobile & Notifications

**Install it like an app.** The portal is a installable PWA (Progressive Web App) with an offline app shell, a mobile-friendly layout (hamburger drawer sidebar, single-column cards, horizontally-scrolling tables) and a manifest/service worker.

- **iOS (Safari):** open the live `https://` URL → tap the **Share** button → **Add to Home Screen**.
- **Android (Chrome):** open the live `https://` URL → tap the **⋮** menu → **Add to Home Screen** / **Install app**.
- This requires the CRM to actually be served somewhere reachable (the deployed URL) for a normal user's phone to open it — `localhost` only works for testing on the same machine as the server (browsers treat `http://localhost` as a secure-context exception, so install/service-worker testing there works fine, but a phone obviously can't reach your laptop's `localhost`).

**Push notifications.** Go to **Settings → Notifications** and click **Enable push notifications on this device**. Your browser will ask for notification permission — accept it, and the CRM will push you (on that device) when:
- a task becomes overdue or is due within 24 hours (checked every 15 minutes),
- an invoice flips to overdue,
- a new lead comes in.

Click **Disable** in the same panel to stop notifications on that device. If the browser blocks or doesn't support push, the button explains why instead of failing silently.

## API overview

All endpoints are under `/api` and return JSON. Authenticate with `Authorization: Bearer <token>`.

### Auth
- `POST /api/auth/register` — first user only (becomes admin); registration closes after that
- `POST /api/auth/login` → `{ token, user }`
- `GET /api/auth/me`
- `GET|POST /api/auth/users`, `PATCH /api/auth/users/:id` — admin user management

### CRM core
- `GET|POST /api/companies`, `GET|PATCH|DELETE /api/companies/:id` (detail includes contacts, deals, invoices)
- `GET|POST /api/contacts`, `GET|PATCH|DELETE /api/contacts/:id` — `?search=` and `?company_id=` filters
- `GET|POST /api/leads`, `GET|PATCH|DELETE /api/leads/:id`
- `POST /api/leads/:id/convert` — creates contact (+ company if named) and optionally a deal

### Services & pricing
- `GET|POST /api/services`, `GET|PATCH|DELETE /api/services/:id` — the price list (`?active=true` filter); services used on documents can be deactivated but not deleted
- `GET /api/services/revenue` — billed revenue per service
- Line items on proposals/invoices accept an optional `service_id`; `unit_price` is always taken from the request (custom price per document)

### Sales pipeline
- `GET /api/deals/stages` · `GET /api/deals/pipeline` (kanban board with stage totals)
- `GET|POST /api/deals`, `GET|PATCH|DELETE /api/deals/:id`
- `POST /api/deals/:id/move` `{ stage_id }` · `POST /api/deals/:id/win` · `POST /api/deals/:id/lose` `{ reason }`

### Proposals
- `GET|POST /api/proposals`, `GET|PATCH|DELETE /api/proposals/:id`
  - Create with `{ title, company_id, contact_id, deal_id, items: [{ description, quantity, unit_price }], discount, tax_rate }`
- `GET /api/proposals/:id/html` — branded, print-ready document
- `POST /api/proposals/:id/send` `{ to? }` — emails the client, marks sent
- `POST /api/proposals/:id/accept` · `POST /api/proposals/:id/decline`
- `POST /api/proposals/:id/convert-to-invoice` — accepted proposals only, one time

### Invoices & payments
- `GET|POST /api/invoices`, `GET|PATCH|DELETE /api/invoices/:id` — `?status=` filter; overdue is detected automatically
- `GET /api/invoices/:id/html` · `POST /api/invoices/:id/send` `{ to? }` · `POST /api/invoices/:id/cancel`
- `POST /api/invoices/:id/payments` `{ amount, method, payment_date, reference }` — status moves draft/sent → partial → paid

### Expenses
- `GET|POST /api/expenses`, `GET|PATCH|DELETE /api/expenses/:id` — filter by `category_id`, `company_id`, `from`, `to`, `billable`
- `GET|POST /api/expenses/categories` — 10 agency-relevant categories seeded
- `GET /api/expenses/summary?from=&to=` — totals by category and by month

### Productivity
- `GET|POST /api/tasks`, `GET|PATCH|DELETE /api/tasks/:id` — `?overdue=true`, `?status=`, `?assignee_id=`
- `GET|POST /api/activities`, `DELETE /api/activities/:id` — timeline of notes/calls/emails/meetings per record

### Growth (goals, habits, journal)
- `GET|POST /api/goals`, `GET|PATCH|DELETE /api/goals/:id` — `?status=`, `?area=` filters; `PATCH { status: 'done' }` stamps `completed_at`; `PATCH { current_value }` logs progress
- `GET|POST /api/habits`, `GET|PATCH|DELETE /api/habits/:id` — `?active=true`; each row includes `checked_today` and the current `streak`
- `POST /api/habits/:id/checkin` (idempotent — checking in twice the same day is a no-op) · `DELETE /api/habits/:id/checkin` (undo)
- `GET|POST /api/journal`, `GET /api/journal/today`, `PATCH|DELETE /api/journal/:id` — `?limit=` on the list

### Business reports
- `GET /api/reports/dashboard` — revenue, expenses, profit (all-time + this month), outstanding/overdue invoices, pipeline value (weighted by stage probability), lead & proposal counts, tasks due
- `GET /api/reports/profit-loss?from=&to=` — monthly revenue vs expenses vs profit
- `GET /api/reports/sales` — funnel by stage, won/lost totals, win rate
- `GET /api/reports/clients` — billed / paid / outstanding per client
- `GET /api/reports/productivity` — task completion rate (30d), tasks overdue, average hours to first lead contact, activity streak, 30-day daily activity counts
- `GET /api/reports/growth` — goals (active, done in last 30d, by area), habits (today's completion, per-habit streaks, longest streak), journal (entries in last 30d, current streak); `dashboard` also carries a compact `growth` field

### Push notifications
- `GET /api/push/vapid-public-key` — the VAPID public key the browser needs to call `pushManager.subscribe`
- `POST /api/push/subscribe` `{ endpoint, keys: { p256dh, auth } }` — registers this device for push, tied to the logged-in user
- `DELETE /api/push/subscribe` `{ endpoint }` — unregisters a device
- Automatic pushes: a task becomes overdue or due within 24h, an invoice flips to overdue, a new lead comes in

### Settings
- `GET /api/settings` · `PUT /api/settings` (admin) — company profile, currency, tax, numbering, terms

## Typical workflow

```
Lead comes in            POST /api/leads
Qualify & convert        POST /api/leads/:id/convert          → contact + company + deal
Work the deal            POST /api/deals/:id/move
Send a proposal          POST /api/proposals  →  POST /api/proposals/:id/send
Client accepts           POST /api/proposals/:id/accept
Invoice the client       POST /api/proposals/:id/convert-to-invoice → POST /api/invoices/:id/send
Get paid                 POST /api/invoices/:id/payments      → deal :id/win
Track your costs         POST /api/expenses
See the big picture      GET  /api/reports/dashboard
```
