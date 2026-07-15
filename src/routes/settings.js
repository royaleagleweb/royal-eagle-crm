const express = require('express');
const { getAllSettings, setSetting } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { handler, badRequest } = require('../utils/helpers');

const router = express.Router();

const EDITABLE_KEYS = [
  'company_name', 'company_email', 'company_phone', 'company_address', 'company_website',
  'currency', 'currency_symbol', 'default_tax_rate',
  'invoice_prefix', 'proposal_prefix', 'invoice_due_days', 'proposal_valid_days',
  'invoice_terms', 'proposal_terms',
];

router.get('/', (req, res) => res.json(getAllSettings()));

router.put('/', requireAdmin, handler((req, res) => {
  const updates = req.body || {};
  const unknown = Object.keys(updates).filter((k) => !EDITABLE_KEYS.includes(k));
  if (unknown.length) throw badRequest(`Unknown settings: ${unknown.join(', ')}`);
  for (const [key, value] of Object.entries(updates)) setSetting(key, value);
  res.json(getAllSettings());
}));

module.exports = router;
