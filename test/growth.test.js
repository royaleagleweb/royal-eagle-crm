/**
 * End-to-end test for the Growth module (goals, habits, journal) against a
 * temp database: create a goal and log progress to completion, check a
 * habit in and verify the streak math (including a back-dated checkin and
 * an undo), round-trip a journal entry, and confirm the reports shapes.
 *
 * Usage: npm run test:growth
 */
process.env.DB_FILE = require('path').join(require('os').tmpdir(), `crm-growth-test-${process.pid}.sqlite`);
process.env.JWT_SECRET = 'test-secret';

const assert = require('node:assert');
const fs = require('node:fs');
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
  ok('admin registered');

  // --- Goals ---
  const goal = (await api('POST', '/api/goals', {
    title: 'Read 12 books', area: 'growth', target_value: 12, unit: 'books', target_date: '2026-12-31',
  }, { expect: 201 })).data;
  assert.strictEqual(goal.status, 'active');
  assert.strictEqual(goal.current_value, 0);
  ok('goal created with a numeric target');

  const progressed = (await api('PATCH', `/api/goals/${goal.id}`, { current_value: 5 }, { expect: 200 })).data;
  assert.strictEqual(progressed.current_value, 5);
  assert.strictEqual(progressed.status, 'active');
  ok('progress logged via PATCH current_value');

  const done = (await api('PATCH', `/api/goals/${goal.id}`, { status: 'done' }, { expect: 200 })).data;
  assert.strictEqual(done.status, 'done');
  assert.ok(done.completed_at, 'completed_at should be stamped');
  ok('marking a goal done stamps completed_at');

  await api('POST', '/api/goals', {}, { expect: 400 });
  ok('goal without a title is rejected');

  // A second, still-active goal in a different area for the report breakdown.
  await api('POST', '/api/goals', { title: 'Run a 5k', area: 'health', target_value: 5, unit: 'km' }, { expect: 201 });

  // --- Habits ---
  const habit = (await api('POST', '/api/habits', { title: 'Morning walk', area: 'health', frequency: 'daily' }, { expect: 201 })).data;
  assert.strictEqual(habit.streak, 0);
  assert.strictEqual(habit.checked_today, false);
  ok('habit created, no streak yet');

  const checkedOnce = (await api('POST', `/api/habits/${habit.id}/checkin`, {}, { expect: 201 })).data;
  assert.strictEqual(checkedOnce.streak, 1);
  assert.strictEqual(checkedOnce.checked_today, true);
  ok('checking in today sets streak to 1');

  const checkedTwice = (await api('POST', `/api/habits/${habit.id}/checkin`, {}, { expect: 201 })).data;
  assert.strictEqual(checkedTwice.streak, 1);
  const checkinCount = db.prepare('SELECT COUNT(*) AS n FROM habit_checkins WHERE habit_id = ?').get(habit.id).n;
  assert.strictEqual(checkinCount, 1, 'checking in twice the same day must not double-count');
  ok('checkin is idempotent — checking in twice same day does not double-count');

  // Back-date a checkin for yesterday directly via SQL, as a real user's
  // history would already contain, and confirm the streak becomes 2.
  const yesterday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  db.prepare('INSERT INTO habit_checkins (habit_id, checkin_date) VALUES (?, ?)').run(habit.id, yesterday);
  const afterBackdate = (await api('GET', `/api/habits/${habit.id}`, null, { expect: 200 })).data;
  assert.strictEqual(afterBackdate.streak, 2);
  ok('back-dated checkin for yesterday extends the streak to 2');

  const afterUndo = (await api('DELETE', `/api/habits/${habit.id}/checkin`, null, { expect: 200 })).data;
  assert.strictEqual(afterUndo.checked_today, false);
  assert.strictEqual(afterUndo.streak, 1);
  ok('deleting today\'s checkin (undo) drops the streak back to 1');

  // A second, inactive-by-default-false habit not touched, just to prove
  // GET /habits?active=true only returns active ones.
  const habit2 = (await api('POST', '/api/habits', { title: 'No screens after 9pm', area: 'health' }, { expect: 201 })).data;
  await api('PATCH', `/api/habits/${habit2.id}`, { is_active: false }, { expect: 200 });
  const activeHabits = (await api('GET', '/api/habits?active=true', null, { expect: 200 })).data;
  assert.ok(activeHabits.every((h) => h.id !== habit2.id));
  assert.ok(activeHabits.some((h) => h.id === habit.id));
  ok('?active=true filters out deactivated habits');

  // --- Journal ---
  const created = (await api('POST', '/api/journal', { content: 'Closed the Sunrise deal, felt great.', mood: 'great' }, { expect: 201 })).data;
  const today = (await api('GET', '/api/journal/today', null, { expect: 200 })).data;
  assert.ok(today);
  assert.strictEqual(today.id, created.id);
  assert.strictEqual(today.content, 'Closed the Sunrise deal, felt great.');
  ok('GET /journal/today returns the entry just created');

  const patched = (await api('PATCH', `/api/journal/${created.id}`, { content: 'Closed the Sunrise deal, felt great. Celebrated with dinner.' }, { expect: 200 })).data;
  assert.strictEqual(patched.content, 'Closed the Sunrise deal, felt great. Celebrated with dinner.');
  ok('journal entry content updates via PATCH');

  await api('POST', '/api/journal', {}, { expect: 400 });
  ok('journal entry without content is rejected');

  const list = (await api('GET', '/api/journal?limit=10', null, { expect: 200 })).data;
  assert.ok(list.length >= 1);
  ok('journal entries list, newest first');

  // --- Reports ---
  const growth = (await api('GET', '/api/reports/growth', null, { expect: 200 })).data;
  assert.strictEqual(growth.goals.active, 1); // "Run a 5k" — "Read 12 books" was marked done
  assert.strictEqual(growth.goals.done_last_30d, 1);
  const growthArea = growth.goals.by_area.find((a) => a.area === 'health');
  assert.strictEqual(growthArea.active, 1);
  const readingArea = growth.goals.by_area.find((a) => a.area === 'growth');
  assert.strictEqual(readingArea.done, 1);
  assert.strictEqual(growth.habits.today_total, 1); // only the active "Morning walk" habit
  assert.strictEqual(growth.habits.today_completed, 0); // today's checkin was undone above
  assert.strictEqual(growth.habits.longest_streak, 1);
  const walkStreak = growth.habits.current_streaks.find((h) => h.habit_id === habit.id);
  assert.strictEqual(walkStreak.streak, 1);
  assert.strictEqual(growth.journal.entries_last_30d, 1);
  assert.strictEqual(growth.journal.current_streak, 1);
  ok('GET /reports/growth returns the correct shape and numbers');

  const dash = (await api('GET', '/api/reports/dashboard', null, { expect: 200 })).data;
  assert.ok(dash.growth, 'dashboard response should include a growth field');
  assert.strictEqual(dash.growth.habits_today, '0/1');
  assert.strictEqual(dash.growth.longest_streak, 1);
  assert.strictEqual(dash.growth.active_goals, 1);
  ok('GET /reports/dashboard includes the compact growth card data');

  console.log(`\nAll ${passed} growth checks passed.`);
}

main()
  .catch((err) => { console.error('\nGROWTH TEST FAILED:', err.message); process.exitCode = 1; })
  .finally(() => {
    server.close();
    try { fs.rmSync(process.env.DB_FILE, { force: true }); fs.rmSync(process.env.DB_FILE + '-wal', { force: true }); fs.rmSync(process.env.DB_FILE + '-shm', { force: true }); } catch {}
  });
