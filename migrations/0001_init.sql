-- Royal Eagle CRM — D1 schema.
-- Identical to src/schema.sql except: no PRAGMA lines (D1 manages those), and
-- the files table stores an R2 object key (r2_key) instead of a data BLOB —
-- file bytes live in the R2 bucket bound as FILES.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Client companies / organizations
CREATE TABLE IF NOT EXISTS companies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  industry   TEXT,
  website    TEXT,
  email      TEXT,
  phone      TEXT,
  address    TEXT,
  city       TEXT,
  country    TEXT,
  notes      TEXT,
  owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name  TEXT,
  email      TEXT,
  phone      TEXT,
  job_title  TEXT,
  source     TEXT,
  notes      TEXT,
  owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  email                TEXT,
  phone                TEXT,
  company_name         TEXT,
  source               TEXT,
  status               TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'contacted', 'qualified', 'unqualified', 'converted')),
  estimated_value      REAL DEFAULT 0,
  notes                TEXT,
  owner_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  converted_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  converted_deal_id    INTEGER,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deal_stages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  position    INTEGER NOT NULL DEFAULT 0,
  probability INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deals (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  title               TEXT NOT NULL,
  company_id          INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contact_id          INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  stage_id            INTEGER REFERENCES deal_stages(id) ON DELETE SET NULL,
  value               REAL NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  lost_reason         TEXT,
  expected_close_date TEXT,
  closed_at           TEXT,
  owner_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Service catalog: what Royal Eagle sells, with default pricing.
-- Line items can reference a service but always carry their own (custom) price.
CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  unit_price  REAL NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT 'project',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proposals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  number      TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  deal_id     INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
  issue_date  TEXT NOT NULL DEFAULT (date('now')),
  valid_until TEXT,
  subtotal    REAL NOT NULL DEFAULT 0,
  discount    REAL NOT NULL DEFAULT 0,
  tax_rate    REAL NOT NULL DEFAULT 0,
  tax_amount  REAL NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  terms       TEXT,
  sent_at     TEXT,
  accepted_at TEXT,
  declined_at TEXT,
  invoice_id  INTEGER,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proposal_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  service_id  INTEGER REFERENCES services(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity    REAL NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  amount      REAL NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  number      TEXT NOT NULL UNIQUE,
  company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  proposal_id INTEGER REFERENCES proposals(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled')),
  issue_date  TEXT NOT NULL DEFAULT (date('now')),
  due_date    TEXT,
  subtotal    REAL NOT NULL DEFAULT 0,
  discount    REAL NOT NULL DEFAULT 0,
  tax_rate    REAL NOT NULL DEFAULT 0,
  tax_amount  REAL NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  terms       TEXT,
  sent_at     TEXT,
  paid_at     TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  service_id  INTEGER REFERENCES services(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity    REAL NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  amount      REAL NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount       REAL NOT NULL,
  payment_date TEXT NOT NULL DEFAULT (date('now')),
  method       TEXT NOT NULL DEFAULT 'bank_transfer'
               CHECK (method IN ('bank_transfer', 'credit_card', 'paypal', 'stripe', 'cash', 'check', 'other')),
  reference    TEXT,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS expenses (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id        INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
  company_id         INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  vendor             TEXT,
  description        TEXT NOT NULL,
  amount             REAL NOT NULL,
  expense_date       TEXT NOT NULL DEFAULT (date('now')),
  payment_method     TEXT,
  reference          TEXT,
  billable           INTEGER NOT NULL DEFAULT 0,
  billed_invoice_id  INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  receipt_url        TEXT,
  is_recurring       INTEGER NOT NULL DEFAULT 0,
  recurring_interval TEXT CHECK (recurring_interval IN (NULL, 'weekly', 'monthly', 'quarterly', 'yearly')),
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT,
  due_date     TEXT,
  priority     TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  related_type TEXT CHECK (related_type IN (NULL, 'contact', 'company', 'lead', 'deal', 'proposal', 'invoice')),
  related_id   INTEGER,
  assignee_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notes, calls, emails, meetings logged against any record (activity timeline)
CREATE TABLE IF NOT EXISTS activities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL DEFAULT 'note' CHECK (type IN ('note', 'call', 'email', 'meeting', 'system')),
  content      TEXT NOT NULL,
  related_type TEXT NOT NULL CHECK (related_type IN ('contact', 'company', 'lead', 'deal', 'proposal', 'invoice', 'expense')),
  related_id   INTEGER NOT NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Uploaded documents (contracts, receipts, briefs). Metadata lives here;
-- the bytes live in the FILES R2 bucket under r2_key.
CREATE TABLE IF NOT EXISTS files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  mime         TEXT NOT NULL DEFAULT 'application/octet-stream',
  size         INTEGER NOT NULL,
  r2_key       TEXT,
  company_id   INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  related_type TEXT CHECK (related_type IN (NULL, 'contact', 'company', 'lead', 'deal', 'proposal', 'invoice', 'expense')),
  related_id   INTEGER,
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_company ON files(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_activities_related ON activities(related_type, related_id);
