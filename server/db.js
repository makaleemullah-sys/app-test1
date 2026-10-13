'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  birth_year INTEGER,
  goal TEXT NOT NULL DEFAULT 'track',
  conditions TEXT NOT NULL DEFAULT '[]',
  diet TEXT NOT NULL DEFAULT 'omnivore',
  cycle_length INTEGER NOT NULL DEFAULT 28,
  period_length INTEGER NOT NULL DEFAULT 5,
  luteal_length INTEGER NOT NULL DEFAULT 14,
  temp_unit TEXT NOT NULL DEFAULT 'C',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  onboarded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT,
  UNIQUE (user_id, start_date)
);

CREATE TABLE IF NOT EXISTS daily_logs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  flow INTEGER,
  symptoms TEXT NOT NULL DEFAULT '[]',
  mood INTEGER,
  energy INTEGER,
  pain INTEGER,
  stress INTEGER,
  sleep_hours REAL,
  water_ml INTEGER NOT NULL DEFAULT 0,
  exercise_min INTEGER,
  bbt REAL,
  lh TEXT,
  mucus TEXT,
  sex TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS food_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  food_id TEXT NOT NULL,
  servings REAL NOT NULL DEFAULT 1,
  meal TEXT NOT NULL DEFAULT 'snack',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS food_logs_user_date ON food_logs(user_id, date);

CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dose TEXT,
  time TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'medication',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS med_doses (
  med_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  taken_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (med_id, date)
);

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  period_upcoming INTEGER NOT NULL DEFAULT 1,
  period_days_before INTEGER NOT NULL DEFAULT 2,
  period_late INTEGER NOT NULL DEFAULT 1,
  fertility INTEGER NOT NULL DEFAULT 1,
  daily_log INTEGER NOT NULL DEFAULT 1,
  daily_log_time TEXT NOT NULL DEFAULT '20:00',
  hydration INTEGER NOT NULL DEFAULT 1,
  medications INTEGER NOT NULL DEFAULT 1,
  phase_tips INTEGER NOT NULL DEFAULT 1,
  forecasts INTEGER NOT NULL DEFAULT 1,
  nutrition INTEGER NOT NULL DEFAULT 1,
  health_alerts INTEGER NOT NULL DEFAULT 1,
  bbt_reminder INTEGER NOT NULL DEFAULT 0,
  bbt_time TEXT NOT NULL DEFAULT '06:30',
  quiet_start TEXT NOT NULL DEFAULT '22:00',
  quiet_end TEXT NOT NULL DEFAULT '07:00',
  discreet INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  dedupe_key TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction; rolls back on throw. */
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, tx };
