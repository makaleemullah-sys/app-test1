'use strict';
const { loadContext, ironIntakeAvg } = require('../context');
const { decideNotifications, inQuietHours, DEFAULT_PREFS } = require('./rules');
const { sendPush } = require('./push');

/**
 * Decide which notifications a user should get right now. Safe to run
 * often: dedupe keys make each notification fire at most once.
 */
function computeNotifications(db, userId, now = new Date()) {
  const ctx = loadContext(db, userId, now);
  if (!ctx.profile?.onboarded) return [];
  return decideNotifications({
    ...ctx,
    now,
    prefs: db.prepare('SELECT * FROM notification_prefs WHERE user_id = ?').get(userId),
    todayFoods: db.prepare('SELECT food_id, servings FROM food_logs WHERE user_id = ? AND date = ?').all(userId, ctx.today),
    untakenMeds: db.prepare(`SELECT m.* FROM medications m WHERE m.user_id = ? AND m.active = 1
      AND NOT EXISTS (SELECT 1 FROM med_doses d WHERE d.med_id = m.id AND d.date = ?)`).all(userId, ctx.today),
    ironAvg: ironIntakeAvg(db, userId, ctx.today),
  });
}

/** Persist new notifications (deduped) and push them to subscribed devices. */
async function runForUser(db, userId, now = new Date()) {
  const items = computeNotifications(db, userId, now);
  const insert = db.prepare(`INSERT OR IGNORE INTO notifications (user_id, type, title, body, link, dedupe_key)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const created = [];
  for (const n of items) {
    const r = insert.run(userId, n.type, n.title, n.body, n.link, n.dedupe_key);
    if (r.changes) created.push({ id: Number(r.lastInsertRowid), ...n });
  }
  for (const n of created) await sendPush(db, userId, { title: n.title, body: n.body, url: n.link, tag: n.dedupe_key, id: n.id });
  return created;
}

async function runAll(db, now = new Date()) {
  const users = db.prepare('SELECT user_id FROM profiles WHERE onboarded = 1').all();
  let total = 0;
  for (const { user_id: id } of users) {
    try { total += (await runForUser(db, id, now)).length; } catch (err) { console.error(`notify user ${id}:`, err); }
  }
  return total;
}

function startScheduler(db, intervalMs = 5 * 60 * 1000) {
  const tick = () => runAll(db).catch((err) => console.error('scheduler:', err));
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, 2000).unref();
  return timer;
}

module.exports = { computeNotifications, decideNotifications, runForUser, runAll, startScheduler, inQuietHours, DEFAULT_PREFS };
