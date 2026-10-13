'use strict';
const path = require('node:path');
const { openDb } = require('./db');
const { createApp } = require('./app');
const { initPush } = require('./notifications/push');
const { startScheduler } = require('./notifications/scheduler');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'lunaria.db');

const db = openDb(DB_FILE);
initPush(db);
startScheduler(db, Number(process.env.NOTIFY_INTERVAL_MS) || 5 * 60 * 1000);
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

const app = createApp(db, { secureCookies: process.env.NODE_ENV === 'production' });
app.listen(PORT, () => console.log(`🌙 Lunaria running at http://localhost:${PORT}`));
