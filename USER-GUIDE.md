# Royal Eagle CRM — Owner's Guide

How to run Royal Eagle Web and Marketing on this CRM, day to day. No technical knowledge needed — everything here happens in the web portal.

## First-time setup (5 minutes)

1. **Log in** with your admin account (the seed account is `roy@royaleagleweb.com` / `RoyalEagle2026!`).
2. Go to **Settings → Team → Reset password** on your own account and set a real password.
3. In **Settings**, fill in your phone, address, and default tax rate — these appear on every invoice and proposal you send.
4. Review **Services & Pricing**. The 10 seeded services carry placeholder prices — set them to what you actually charge. Add services you sell that are missing; deactivate ones you don't offer.
5. In **Settings → Team**, add your staff. Give them the *Staff* role — they can do everything except change settings and manage the team.

## The daily loop

```
New inquiry  →  Leads (+ New lead)
Worth pursuing?  →  Convert (creates the client + a deal automatically)
Working the deal  →  Pipeline (drag through stages)
Ready to quote  →  Proposals (+ New proposal → Send)
They said yes  →  Accept → "→ Invoice" → Send
Money arrives  →  Invoices (+ Payment), then mark the deal Won
Money leaves  →  Expenses (+ New expense)
Friday check  →  Dashboard + Reports
```

## Each screen, in one paragraph

**Dashboard** — your morning view. Income, expenses, and profit for the month; how much clients owe you (and how much of that is overdue); the value of deals in play; which services earn the most; where the money goes. If something looks wrong here, the linked page has the detail.

**Leads** — every inquiry goes in here the moment it arrives, even half-baked ones. Update the status as you talk to them (new → contacted → qualified). Dead end? Mark *unqualified*. Real prospect? Hit **Convert** — the CRM creates the client record, the contact person, and a deal in your pipeline in one click.

**Pipeline** — your sales board. Each column is a stage; each card a potential job with its dollar value. Move deals right as they progress. Won the work? ✓. Lost it? ✕ (it asks why — those reasons teach you things). The dashboard's "pipeline value" comes from here, weighted by how far along each deal is.

**Clients & Contacts** — who you work with. The Clients page also shows the money picture per client: billed, paid, outstanding.

**Services & Pricing** — your price list. Keep it honest and current; it's what pre-fills proposals and invoices. You can always type a different price on any individual document — the list is a starting point, not a cage.

**Proposals** — your quotes. Build one from services (or custom lines), send it by email from the CRM, and track whether it's been accepted or declined. Accepted proposals convert to invoices with one click, so nothing gets retyped and nothing gets forgotten.

**Invoices** — the money you're owed. Every invoice is numbered automatically (INV-2026-0001, 0002, …), has a due date, and turns *overdue* by itself when the date passes. **View / print** opens the client-facing document — print it, save it as PDF, or send it by email straight from the CRM. Record payments as they land; partial payments are fine.

**Expenses** — the money you spend. Log everything: software, hosting, ad spend, contractors. Mark recurring costs (like Adobe) as monthly so you remember they exist. If an expense was for a specific client (their ad budget, a photographer for their shoot), mark it *billable to* that client so you can invoice it back.

**Tasks** — your to-do list, with priorities and due dates. The dashboard warns you when things are due this week.

**Reports** — month by month: what came in, what went out, what's left (your P&L); how often you win the deals you chase; which clients are worth the most and who still owes you. The **Productivity** panel at the top is the "am I actually following through?" check — task completion rate, tasks overdue, average time to first-contact a lead, and your daily activity streak.

**Settings** (admin only) — company details, tax rate, invoice numbering, payment terms, and your **Team**: add staff, deactivate someone who leaves (their history stays), reset passwords.

## Growth — goals, habits, and journal

The Productivity report asks "am I following through on the business?" Growth asks the same honest question about the *whole* person — business, health, finances, relationships, whatever you're working on — in one place, so you see yourself whole instead of siloed into "work you" and everything else.

- **Today's check-in** — one tap per habit, each day. It's meant to feel like a habit tracker: tap "✓ Done today," it turns green, and you see your streak (🔥 12 day streak). Miss a day and the streak resets — that's the point, it's an honest mirror, not a participation trophy. Tapped it by mistake? Tap again to undo.
- **Goals** — anything with a finish line: a revenue target, a weight goal, a savings goal, "read 12 books this year." Tag it with an area (business, health, finance, relationships, growth, other) so the report can break things down. If it has a number attached (12 books, $10,000, 20 lbs), log progress with **+ Progress** as it happens and watch the bar fill in. Mark it **done** when it's done — the CRM stamps the date — or **abandon** it if it's not the goal anymore. Neither is a failure to hide.
- **Journal** — a few lines, whenever something's worth remembering: a win, a lesson, a rough day. Pick a mood if you want. It auto-loads *today's* entry if you already wrote one today, so hitting Save updates it rather than creating duplicates. The last 10 entries sit right below so you can scroll back.

**How to use it day to day:** check off habits in the morning or at night (whichever you'll actually stick to), log goal progress the moment it happens rather than trying to remember it later, and jot a journal line when something's worth keeping — good or bad. The Growth page and the Dashboard's Growth card both use the same honest streaks and numbers: if a week looks bad here, it's because it was a bad week, and that's worth knowing.

## Habits that make it work

- **Everything in, immediately.** A lead you didn't log is a job you'll forget to chase. An expense you didn't log is profit you think you have but don't.
- **Send documents from the CRM**, not from your inbox — that's what keeps the paper trail complete and every number on the dashboard true.
- **Record payments the day they arrive**, so "who owes me what" is always answerable in one glance.
- **Friday: Dashboard + Reports.** Five minutes. Overdue invoices → chase. Stale pipeline deals → follow up or mark lost.

## Where everything lives

Every lead, client, proposal, invoice, payment, expense, task — and every uploaded file — is stored in **one database file** on the server that runs the CRM: `data/crm.sqlite`.

- Running on your computer → that file is in the project folder on your computer.
- Running on a host like Render → it's on the server's persistent disk, and the CRM is reachable from anywhere at your `https://…` address.

That single file **is** your business records. Copy it, and you've backed up everything, attachments included.

**Files** (new sidebar page) — upload contracts, receipts, briefs, and design sign-offs (up to 10 MB each), optionally tagged to a client. Download or delete them any time.

## Emails and backups (one-time technical setup)

- **Sending real emails**: the Send buttons deliver by email once SMTP is configured (see README — five settings from your email provider). Until then, sending still marks documents as sent; you'd download the PDF and email it yourself.
- **Backups**: all data lives in a single file (`data/crm.sqlite`). Copy that file somewhere safe on a schedule and you're covered. On Render hosting, the disk persists automatically.
