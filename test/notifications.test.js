/**
 * Covers the three new features against a temp database:
 *  - Web Push plumbing (VAPID key, subscribe/unsubscribe, new-lead push trigger)
 *  - The "am I following through" productivity report
 *
 * The real webpush.sendNotification call (which would try to reach Google's/
 * Mozilla's push service) is monkey-patched out — we assert our own code calls
 * it with the right shape, not that a push actually got delivered to a device.
 *
 * Usage: node test/notifications.test.js
 */
process.env.DB_FILE = require('path').join(require('os').tmpdir(), `crm-notif-test-${process.pid}.sqlite`);
process.env.JWT_SECRET = 'test-secret';

const assert = require('node:assert');
const fs = require('node:fs');

const push = require('../src/services/push');

// Monkey-patch the real network call so subscribe/lead/task flows exercise our
// code without ever hitting a real push service.
const pushCalls = [];
push.sendPush = async (subscription, payload) => {
  pushCalls.push({ subscription, payload });
};

const app = require('../src/app');
const { db } = require('../src/db');

const server = app.listen(0);
const base = () => `http://127.0.0.1:${server.address().port}`;
let token = null;
let passed = 0;

async function api(method, path, body, { expect } = {}) {
  const res = await fetch(base() + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
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
  const reg = await api('POST', '/api/auth/register', { name: 'Roy', email: 'roy@royaleagleweb.com', password: 'supersecret1' }, { expect: 201 });
  token = reg.data.token;
  const userId = reg.data.user.id;
  ok('registered admin for notification tests');

  // --- VAPID public key ---
  const vapid = await api('GET', '/api/push/vapid-public-key', null, { expect: 200 });
  assert.ok(typeof vapid.data.publicKey === 'string' && vapid.data.publicKey.length > 20, 'public key looks like a real VAPID key');
  ok('VAPID public key endpoint returns a key');

  // --- subscribe / unsubscribe round trip ---
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-abc123',
    keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-secret' },
  };
  await api('POST', '/api/push/subscribe', subscription, { expect: 201 });
  const row = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint);
  assert.ok(row && row.user_id === userId, 'subscription persisted and tied to the authenticated user');
  ok('push subscribe stores endpoint + keys tied to the user');

  await api('DELETE', '/api/push/subscribe', { endpoint: subscription.endpoint }, { expect: 204 });
  assert.strictEqual(db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint), undefined);
  ok('push unsubscribe removes the subscription');

  // Re-subscribe so the lead/task triggers below have somewhere to push to.
  await api('POST', '/api/push/subscribe', subscription, { expect: 201 });

  // --- new lead triggers a push attempt ---
  pushCalls.length = 0;
  await api('POST', '/api/leads', { name: 'Jordan Client', email: 'jordan@example.com' }, { expect: 201 });
  await new Promise((resolve) => setTimeout(resolve, 50)); // push is fire-and-forget (not awaited by the route)
  assert.strictEqual(pushCalls.length, 1, 'exactly one push attempt for the new lead');
  assert.strictEqual(pushCalls[0].subscription.endpoint, subscription.endpoint);
  assert.match(pushCalls[0].payload.title, /new lead/i);
  assert.match(pushCalls[0].payload.body, /Jordan Client/);
  assert.strictEqual(pushCalls[0].payload.url, '#/leads');
  ok('new lead push-notifies subscribed users with the expected payload shape');

  // --- task overdue/due-soon push via checkAndNotify ---
  const { checkAndNotify } = require('../src/services/notifier');
  const overdueTask = await api('POST', '/api/tasks', { title: 'Follow up with Jordan', due_date: '2000-01-01' }, { expect: 201 });
  pushCalls.length = 0;
  await checkAndNotify();
  assert.ok(pushCalls.some((c) => c.payload.title === 'Task overdue' && c.payload.body === 'Follow up with Jordan'), 'overdue task produced a push');
  const stamped = db.prepare('SELECT last_notified_at FROM tasks WHERE id = ?').get(overdueTask.data.id);
  assert.ok(stamped.last_notified_at, 'task stamped with last_notified_at so it is not re-notified today');
  pushCalls.length = 0;
  await checkAndNotify();
  assert.strictEqual(pushCalls.length, 0, 'already-notified-today task is not paged again');
  ok('checkAndNotify pushes overdue tasks once per day and stamps last_notified_at');

  // --- productivity report ---
  // Seed a clean, predictable set of tasks: 2 done, 1 open-but-overdue, 1 open-not-due.
  await api('POST', '/api/tasks', { title: 'Task A' }, { expect: 201 });
  const taskB = await api('POST', '/api/tasks', { title: 'Task B' }, { expect: 201 });
  const taskC = await api('POST', '/api/tasks', { title: 'Task C', due_date: '2000-01-02' }, { expect: 201 });
  await api('PATCH', `/api/tasks/${taskB.data.id}`, { status: 'done' }, { expect: 200 });

  // A lead whose first contact (an activity) happens exactly 5 hours after creation.
  const lead2 = await api('POST', '/api/leads', { name: 'Delayed Contact Co' }, { expect: 201 });
  const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const createdFiveHoursBeforeThat = new Date(Date.now() - 5 * 3600 * 1000 - 5 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  // Backdate the lead's created_at and log an activity 5h after that backdated time, so
  // time-to-first-contact for this lead is deterministically 5 hours.
  db.prepare("UPDATE leads SET created_at = ?, status = 'contacted' WHERE id = ?").run(createdFiveHoursBeforeThat, lead2.data.id);
  db.prepare('INSERT INTO activities (type, content, related_type, related_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('note', 'First outreach call', 'lead', lead2.data.id, fiveHoursAgo);

  const productivity = await api('GET', '/api/reports/productivity', null, { expect: 200 });
  const p = productivity.data;
  assert.ok(p.tasks_created_30d >= 4, 'counts tasks created in the last 30 days');
  assert.ok(p.tasks_done_30d >= 1, 'counts done tasks');
  assert.strictEqual(typeof p.completion_rate_percent, 'number');
  assert.ok(p.completion_rate_percent >= 0 && p.completion_rate_percent <= 100, 'completion rate is a sane percentage');
  assert.ok(p.tasks_overdue >= 2, 'counts both overdue tasks (the earlier one plus Task C)');
  assert.strictEqual(p.avg_hours_to_first_contact, 5, 'average hours to first contact matches the seeded 5-hour gap');
  assert.strictEqual(typeof p.streak_days, 'number');
  assert.ok(p.streak_days >= 1, 'today has activity (tasks/leads created above), so streak is at least 1');
  assert.strictEqual(p.daily_activity.length, 30, 'returns a 30-day trend array');
  assert.ok(p.daily_activity.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && typeof d.count === 'number'), 'daily_activity entries are well formed');
  assert.strictEqual(p.daily_activity[29].date, new Date().toISOString().slice(0, 10), 'last entry is today');
  ok('productivity report returns sane shapes and correctly computed numbers on seeded data');

  console.log(`\nAll ${passed} notification/productivity checks passed.`);
}

main()
  .catch((err) => { console.error('\nNOTIFICATIONS TEST FAILED:', err); process.exitCode = 1; })
  .finally(() => {
    server.close();
    try { fs.rmSync(process.env.DB_FILE, { force: true }); fs.rmSync(process.env.DB_FILE + '-wal', { force: true }); fs.rmSync(process.env.DB_FILE + '-shm', { force: true }); } catch {}
  });
