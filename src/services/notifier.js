const { db } = require('../db');
// Required as a module object (not destructured) so tests can monkey-patch
// `push.sendPush` without hitting the real web-push / Google endpoint.
const push = require('./push');

/** Sends a push payload to every device a user has subscribed from, pruning dead subscriptions. */
async function notifyUser(userId, payload) {
  if (!userId) return;
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  for (const sub of subs) {
    try {
      await push.sendPush(sub, payload);
    } catch (err) {
      if (err.expired) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      else console.error('[push] send failed:', err.message);
    }
  }
}

/** Sends a push payload to every user in the team who has at least one subscription. */
async function notifyAllUsers(payload) {
  const userIds = db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all();
  for (const { user_id } of userIds) await notifyUser(user_id, payload);
}

/**
 * Finds tasks that are overdue or due within the next 24h and haven't already
 * been notified about today, pushes their assignee, and stamps last_notified_at
 * so the same task doesn't page anyone again until tomorrow.
 */
async function checkAndNotify() {
  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE status NOT IN ('done', 'cancelled')
      AND due_date IS NOT NULL
      AND due_date <= date('now', '+1 day')
      AND (last_notified_at IS NULL OR date(last_notified_at) != date('now'))
  `).all();

  const today = new Date().toISOString().slice(0, 10);
  for (const task of tasks) {
    const userId = task.assignee_id || task.created_by;
    const overdue = task.due_date < today;
    await notifyUser(userId, {
      title: overdue ? 'Task overdue' : 'Task due soon',
      body: task.title,
      url: '#/tasks',
    });
    db.prepare("UPDATE tasks SET last_notified_at = datetime('now') WHERE id = ?").run(task.id);
  }
}

module.exports = { checkAndNotify, notifyUser, notifyAllUsers };
