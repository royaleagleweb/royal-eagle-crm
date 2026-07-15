const express = require('express');
const { db } = require('../db');
const { handler, badRequest } = require('../utils/helpers');
const { getPublicKey } = require('../services/push');

const router = express.Router();

router.get('/vapid-public-key', (req, res) => res.json({ publicKey: getPublicKey() }));

router.post('/subscribe', handler((req, res) => {
  const b = req.body || {};
  const endpoint = b.endpoint;
  const p256dh = b.keys?.p256dh;
  const auth = b.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw badRequest('endpoint and keys.p256dh/keys.auth are required');

  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(req.user.id, endpoint, p256dh, auth);
  res.status(201).json({ subscribed: true });
}));

router.delete('/subscribe', handler((req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) throw badRequest('endpoint is required');
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  res.status(204).end();
}));

module.exports = router;
