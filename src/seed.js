/**
 * Seeds the database with an admin user and realistic sample data for
 * Royal Eagle Web and Marketing. Safe to re-run: skips if users exist.
 *
 * Usage: npm run seed
 * Override credentials: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 */
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const adminEmail = process.env.SEED_ADMIN_EMAIL || 'roy@royaleagleweb.com';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'RoyalEagle2026!';

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
  console.log('Database already has users — skipping seed.');
  process.exit(0);
}

const adminId = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
  .run('Roy', adminEmail, bcrypt.hashSync(adminPassword, 10)).lastInsertRowid;

const companyId = db.prepare(`
  INSERT INTO companies (name, industry, website, email, phone, city, country, owner_id)
  VALUES ('Sunrise Dental Group', 'Healthcare', 'https://sunrisedental.example.com', 'office@sunrisedental.example.com', '+1 555 0100', 'Miami', 'USA', ?)
`).run(adminId).lastInsertRowid;

const contactId = db.prepare(`
  INSERT INTO contacts (company_id, first_name, last_name, email, phone, job_title, source, owner_id)
  VALUES (?, 'Maria', 'Lopez', 'maria@sunrisedental.example.com', '+1 555 0101', 'Practice Manager', 'Referral', ?)
`).run(companyId, adminId).lastInsertRowid;

db.prepare(`
  INSERT INTO leads (name, email, company_name, source, status, estimated_value, owner_id)
  VALUES ('James Carter', 'james@carterlaw.example.com', 'Carter Law Firm', 'Website form', 'new', 4500, ?)
`).run(adminId);

const stageId = db.prepare("SELECT id FROM deal_stages WHERE name = 'Proposal Sent'").get().id;
db.prepare(`
  INSERT INTO deals (title, company_id, contact_id, stage_id, value, expected_close_date, owner_id)
  VALUES ('Website redesign + SEO retainer', ?, ?, ?, 8200, date('now', '+21 days'), ?)
`).run(companyId, contactId, stageId, adminId);

const softwareCat = db.prepare("SELECT id FROM expense_categories WHERE name = 'Software & Subscriptions'").get().id;
const adsCat = db.prepare("SELECT id FROM expense_categories WHERE name = 'Advertising & Marketing'").get().id;
db.prepare(`
  INSERT INTO expenses (category_id, vendor, description, amount, expense_date, is_recurring, recurring_interval, created_by)
  VALUES (?, 'Adobe', 'Creative Cloud subscription', 59.99, date('now', '-3 days'), 1, 'monthly', ?)
`).run(softwareCat, adminId);
db.prepare(`
  INSERT INTO expenses (category_id, vendor, description, amount, expense_date, created_by)
  VALUES (?, 'Google Ads', 'Client campaign ad spend', 350.00, date('now', '-1 days'), ?)
`).run(adsCat, adminId);

db.prepare(`
  INSERT INTO tasks (title, description, due_date, priority, related_type, related_id, assignee_id, created_by)
  VALUES ('Follow up with Maria on proposal', 'Call to walk through the website redesign scope', date('now', '+2 days'), 'high', 'contact', ?, ?, ?)
`).run(contactId, adminId, adminId);

console.log('Seed complete.');
console.log(`Admin login: ${adminEmail} / ${adminPassword}`);
console.log('Change this password immediately via PATCH /api/auth/users/:id');
