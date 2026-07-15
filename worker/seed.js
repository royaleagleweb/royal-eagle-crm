// Lazy default seeding — same defaults as src/db.js. Runs once per isolate:
// on the first request we check whether settings exist and insert the
// defaults if the database is empty, then cache the flag module-level.

const DEFAULT_SETTINGS = {
  company_name: 'Royal Eagle Web and Marketing',
  company_email: 'roy@royaleagleweb.com',
  company_phone: '',
  company_address: '',
  company_website: 'https://royaleagleweb.com',
  currency: 'USD',
  currency_symbol: '$',
  default_tax_rate: '0',
  invoice_prefix: 'INV',
  proposal_prefix: 'PRO',
  invoice_due_days: '14',
  proposal_valid_days: '30',
  invoice_terms: 'Payment is due within 14 days of the invoice date.',
  proposal_terms: 'This proposal is valid for 30 days from the issue date.',
};

const DEFAULT_STAGES = [
  { name: 'Qualification', position: 1, probability: 10 },
  { name: 'Discovery', position: 2, probability: 25 },
  { name: 'Proposal Sent', position: 3, probability: 50 },
  { name: 'Negotiation', position: 4, probability: 75 },
  { name: 'Closing', position: 5, probability: 90 },
];

// Starter price list for a web & marketing agency — fully editable in the portal.
const DEFAULT_SERVICES = [
  { name: 'Website Design & Build', description: 'Custom responsive website design and development', unit_price: 3500, unit: 'project' },
  { name: 'Landing Page', description: 'Single conversion-focused landing page', unit_price: 750, unit: 'project' },
  { name: 'E-commerce Store', description: 'Online store setup with payments and products', unit_price: 5500, unit: 'project' },
  { name: 'Logo & Branding', description: 'Logo design and brand style guide', unit_price: 900, unit: 'project' },
  { name: 'SEO Retainer', description: 'Ongoing search engine optimization', unit_price: 600, unit: 'month' },
  { name: 'Google Ads Management', description: 'Campaign setup, management and reporting', unit_price: 450, unit: 'month' },
  { name: 'Social Media Management', description: 'Content calendar, posting and engagement', unit_price: 500, unit: 'month' },
  { name: 'Website Maintenance', description: 'Updates, backups, security and small changes', unit_price: 150, unit: 'month' },
  { name: 'Content Writing', description: 'Blog posts, web copy and email copy', unit_price: 120, unit: 'article' },
  { name: 'Consulting', description: 'Strategy and technical consulting', unit_price: 95, unit: 'hour' },
];

const DEFAULT_EXPENSE_CATEGORIES = [
  'Software & Subscriptions',
  'Hosting & Domains',
  'Advertising & Marketing',
  'Contractors & Freelancers',
  'Office & Supplies',
  'Travel & Meals',
  'Equipment & Hardware',
  'Professional Services',
  'Taxes & Fees',
  'Other',
];

let seeded = false;

export async function ensureSeeded(env) {
  if (seeded) return;
  const db = env.DB;
  const row = await db.prepare('SELECT COUNT(*) AS n FROM settings').first();
  if (row.n === 0) {
    const statements = [];
    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) statements.push(insertSetting.bind(key, value));

    const stageCount = (await db.prepare('SELECT COUNT(*) AS n FROM deal_stages').first()).n;
    if (stageCount === 0) {
      const insertStage = db.prepare('INSERT INTO deal_stages (name, position, probability) VALUES (?, ?, ?)');
      for (const s of DEFAULT_STAGES) statements.push(insertStage.bind(s.name, s.position, s.probability));
    }

    const insertCategory = db.prepare('INSERT OR IGNORE INTO expense_categories (name) VALUES (?)');
    for (const name of DEFAULT_EXPENSE_CATEGORIES) statements.push(insertCategory.bind(name));

    // Only seed the price list once — after that the user owns it (edits/deletes persist).
    const serviceCount = (await db.prepare('SELECT COUNT(*) AS n FROM services').first()).n;
    if (serviceCount === 0) {
      const insertService = db.prepare('INSERT INTO services (name, description, unit_price, unit) VALUES (?, ?, ?, ?)');
      for (const s of DEFAULT_SERVICES) statements.push(insertService.bind(s.name, s.description, s.unit_price, s.unit));
    }

    await db.batch(statements);
  }
  seeded = true;
}
