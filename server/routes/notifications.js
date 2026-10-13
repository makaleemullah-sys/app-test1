'use strict';
const express = require('express');
const v = require('../validate');
const { getPublicKey, sendPush } = require('../notifications/push');
const { runForUser } = require('../notifications/scheduler');
const { todayIn } = require('../engine/dates');

module.exports = function notificationRoutes(db) {
  const r = express.Router();
  const uid = (req) => req.user.id;
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  r.get('/notifications', wrap(async (req, res) => {
    // Evaluate on read too, so the inbox is fresh even between scheduler ticks.
    await runForUser(db, uid(req));
    const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(uid(req));
    res.json({ items: items.map((n) => ({ ...n, read: Boolean(n.read) })), unread: items.filter((n) => !n.read).length });
  }));

  r.post('/notifications/read', (req, res) => {
    if (req.body.all) db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(uid(req));
    else {
      const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger);
      const upd = db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?');
      for (const id of ids) upd.run(uid(req), id);
    }
    res.json({ ok: true });
  });

  r.delete('/notifications', (req, res) => {
    db.prepare('DELETE FROM notifications WHERE user_id = ? AND read = 1').run(uid(req));
    res.json({ ok: true });
  });

  r.get('/notifications/prefs', (req, res) => {
    res.json({ prefs: db.prepare('SELECT * FROM notification_prefs WHERE user_id = ?').get(uid(req)) });
  });

  r.put('/notifications/prefs', (req, res) => {
    const fields = v.prefs(req.body);
    const keys = Object.keys(fields);
    if (keys.length) db.prepare(`UPDATE notification_prefs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`).run(...keys.map((k) => fields[k]), uid(req));
    res.json({ prefs: db.prepare('SELECT * FROM notification_prefs WHERE user_id = ?').get(uid(req)) });
  });

  r.get('/push/key', (req, res) => res.json({ publicKey: getPublicKey() }));

  r.post('/push/subscribe', (req, res) => {
    const { endpoint, keys } = req.body || {};
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || !keys?.p256dh || !keys?.auth) throw v.bad('Invalid push subscription');
    db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, keys) VALUES (?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys`)
      .run(uid(req), endpoint, JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }));
    res.status(201).json({ ok: true });
  });

  r.post('/push/unsubscribe', (req, res) => {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(uid(req), String(req.body.endpoint || ''));
    res.json({ ok: true });
  });

  r.post('/notifications/test', wrap(async (req, res) => {
    const key = `test:${Date.now()}`;
    db.prepare('INSERT INTO notifications (user_id, type, title, body, link, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid(req), 'test', 'Notifications are working 🌙', 'You will get cycle, health and nutrition nudges here.', '/notifications', key);
    const pushed = await sendPush(db, uid(req), { title: 'Notifications are working 🌙', body: 'You will get cycle, health and nutrition nudges here.', url: '/notifications', tag: key });
    res.json({ ok: true, pushed });
  }));

  // ---------- medications & supplements ----------
  r.get('/meds', (req, res) => {
    const { timezone } = db.prepare('SELECT timezone FROM profiles WHERE user_id = ?').get(uid(req));
    const today = todayIn(timezone);
    const meds = db.prepare(`SELECT m.*, EXISTS(SELECT 1 FROM med_doses d WHERE d.med_id = m.id AND d.date = ?) AS taken,
      (SELECT COUNT(*) FROM med_doses d WHERE d.med_id = m.id AND d.date > date(?, '-7 days')) AS taken7
      FROM medications m WHERE m.user_id = ? ORDER BY m.active DESC, m.time`).all(today, today, uid(req));
    res.json({ today, meds: meds.map((m) => ({ ...m, taken: Boolean(m.taken), active: Boolean(m.active) })) });
  });

  r.post('/meds', (req, res) => {
    const name = v.str(req.body.name, 'name', 80, { required: true });
    const dose = v.str(req.body.dose, 'dose', 80);
    const time = v.hm(req.body.time, 'time');
    const kind = v.optEnum(req.body.kind, 'kind', ['medication', 'supplement', 'contraceptive']) || 'medication';
    const info = db.prepare('INSERT INTO medications (user_id, name, dose, time, kind) VALUES (?, ?, ?, ?, ?)').run(uid(req), name, dose, time, kind);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.put('/meds/:id', (req, res) => {
    const m = db.prepare('SELECT * FROM medications WHERE id = ? AND user_id = ?').get(req.params.id, uid(req));
    if (!m) throw new v.HttpError(404, 'Not found');
    const next = {
      name: req.body.name !== undefined ? v.str(req.body.name, 'name', 80, { required: true }) : m.name,
      dose: req.body.dose !== undefined ? v.str(req.body.dose, 'dose', 80) : m.dose,
      time: req.body.time !== undefined ? v.hm(req.body.time, 'time') : m.time,
      active: req.body.active !== undefined ? (req.body.active ? 1 : 0) : m.active,
    };
    db.prepare('UPDATE medications SET name = ?, dose = ?, time = ?, active = ? WHERE id = ?').run(next.name, next.dose, next.time, next.active, m.id);
    res.json({ ok: true });
  });

  r.delete('/meds/:id', (req, res) => {
    const info = db.prepare('DELETE FROM medications WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
    if (!info.changes) throw new v.HttpError(404, 'Not found');
    res.json({ ok: true });
  });

  r.post('/meds/:id/taken', (req, res) => {
    const m = db.prepare('SELECT * FROM medications WHERE id = ? AND user_id = ?').get(req.params.id, uid(req));
    if (!m) throw new v.HttpError(404, 'Not found');
    const { timezone } = db.prepare('SELECT timezone FROM profiles WHERE user_id = ?').get(uid(req));
    const date = req.body.date ? v.date(req.body.date) : todayIn(timezone);
    if (req.body.taken === false) db.prepare('DELETE FROM med_doses WHERE med_id = ? AND date = ?').run(m.id, date);
    else db.prepare('INSERT OR IGNORE INTO med_doses (med_id, date) VALUES (?, ?)').run(m.id, date);
    // Clear the matching reminder from the inbox.
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND dedupe_key = ?').run(uid(req), `med:${m.id}:${date}`);
    res.json({ ok: true });
  });

  return r;
};
