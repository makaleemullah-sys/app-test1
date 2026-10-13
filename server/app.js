'use strict';
const path = require('node:path');
const express = require('express');
const { requireAuth } = require('./auth');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const notificationRoutes = require('./routes/notifications');

function createApp(db, { secureCookies = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting proxy (Render, Railway, Fly…) set TRUST_PROXY=1 so
  // rate limiting sees each visitor's real IP instead of the proxy's.
  app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : 'loopback');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  // Basic CSRF defence for cookie-authenticated writes: require same-origin.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-origin request blocked' });
    next();
  });

  app.use('/api/auth', authRoutes(db, { secureCookies }));
  app.use('/api', requireAuth(db), notificationRoutes(db), apiRoutes(db));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
  });
  return app;
}

module.exports = { createApp };
