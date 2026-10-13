'use strict';
const express = require('express');
const auth = require('../auth');
const v = require('../validate');
const { tx } = require('../db');
const { isValidTimeZone } = require('../engine/dates');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function authRoutes(db, { secureCookies }) {
  const r = express.Router();
  const limiter = auth.rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

  r.post('/register', limiter, (req, res) => {
    const email = v.str(req.body.email, 'email', 254, { required: true }).toLowerCase();
    const name = v.str(req.body.name, 'name', 80, { required: true });
    const password = req.body.password;
    if (!EMAIL_RE.test(email)) throw v.bad('Please enter a valid email');
    if (typeof password !== 'string' || password.length < 8) throw v.bad('Password must be at least 8 characters');
    if (password.length > 200) throw v.bad('Password is too long');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new v.HttpError(409, 'An account with this email already exists');
    const tz = isValidTimeZone(req.body.timezone) ? req.body.timezone : 'UTC';
    const userId = tx(db, () => {
      const id = Number(db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(email, name, auth.hashPassword(password)).lastInsertRowid);
      db.prepare('INSERT INTO profiles (user_id, timezone) VALUES (?, ?)').run(id, tz);
      db.prepare('INSERT INTO notification_prefs (user_id) VALUES (?)').run(id);
      return id;
    });
    const s = auth.createSession(db, userId);
    auth.setSessionCookie(res, s.token, s.expires, secureCookies);
    res.status(201).json({ user: { id: userId, email, name }, token: s.token });
  });

  r.post('/login', limiter, (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    // Verify against a dummy hash when the user is unknown to keep timing uniform.
    const ok = user ? auth.verifyPassword(password, user.password_hash) : (auth.verifyPassword(password, DUMMY_HASH), false);
    if (!ok) throw new v.HttpError(401, 'Incorrect email or password');
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(user.id, Date.now());
    const s = auth.createSession(db, user.id);
    auth.setSessionCookie(res, s.token, s.expires, secureCookies);
    res.json({ user: { id: user.id, email: user.email, name: user.name }, token: s.token });
  });

  r.post('/logout', (req, res) => {
    auth.destroySession(db, auth.readToken(req));
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  const requireAuth = auth.requireAuth(db);

  r.get('/me', requireAuth, (req, res) => {
    const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
    res.json({ user: req.user, profile: { ...profile, conditions: JSON.parse(profile.conditions) } });
  });

  r.post('/password', requireAuth, (req, res) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!auth.verifyPassword(String(req.body.current || ''), row.password_hash)) throw new v.HttpError(401, 'Current password is incorrect');
    const next = req.body.next;
    if (typeof next !== 'string' || next.length < 8 || next.length > 200) throw v.bad('New password must be 8–200 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(next), req.user.id);
    // Sign out every other device.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, auth.sha256(req.token));
    res.json({ ok: true });
  });

  r.delete('/account', requireAuth, (req, res) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!auth.verifyPassword(String(req.body.password || ''), row.password_hash)) throw new v.HttpError(401, 'Password is incorrect');
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  return r;
};

const DUMMY_HASH = auth.hashPassword('lunaria-timing-equaliser');
