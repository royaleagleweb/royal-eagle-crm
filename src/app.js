const path = require('path');
const express = require('express');
const { authenticate } = require('./middleware/auth');

const app = express();
app.use(express.json({ limit: '15mb' })); // headroom for base64 file uploads (10 MB cap enforced per file)

// Web portal (login + admin UI)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'royal-eagle-crm' }));

app.use('/api/auth', require('./routes/auth'));

// Everything below requires a valid JWT
app.use('/api', authenticate);
app.use('/api/companies', require('./routes/companies'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/deals', require('./routes/deals'));
app.use('/api/services', require('./routes/services'));
app.use('/api/proposals', require('./routes/proposals'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/files', require('./routes/files'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/activities', require('./routes/activities'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/habits', require('./routes/habits'));
app.use('/api/journal', require('./routes/journal'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/push', require('./routes/push'));

app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  res.status(404).json({ error: 'Route not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

module.exports = app;
