'use strict';
// Creates demo@lunaria.app / lunaria-demo with ~7 months of realistic data.
const path = require('node:path');
const { openDb, tx } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { todayIn } = require('../server/engine/dates');
const { generateDemoData } = require('./demo-data');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'lunaria.db');
const db = openDb(file);
const EMAIL = 'demo@lunaria.app';
const PASSWORD = 'lunaria-demo';
const TZ = process.env.DEMO_TZ || 'UTC';

db.prepare('DELETE FROM users WHERE email = ?').run(EMAIL);
const demo = generateDemoData(todayIn(TZ));
tx(db, () => {
  const id = Number(db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(EMAIL, 'Maya', hashPassword(PASSWORD)).lastInsertRowid);
  const p = demo.profile;
  db.prepare('INSERT INTO profiles (user_id, birth_year, goal, conditions, diet, timezone, onboarded) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(id, p.birth_year, p.goal, JSON.stringify(p.conditions), p.diet, TZ);
  db.prepare('INSERT INTO notification_prefs (user_id, bbt_reminder) VALUES (?, 1)').run(id);
  const insPeriod = db.prepare('INSERT INTO periods (user_id, start_date, end_date) VALUES (?, ?, ?)');
  for (const x of demo.periods) insPeriod.run(id, x.start_date, x.end_date);
  const insLog = db.prepare(`INSERT INTO daily_logs (user_id, date, flow, symptoms, mood, energy, pain, stress, sleep_hours, water_ml, exercise_min, bbt, lh, mucus, sex)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const l of demo.logs) {
    insLog.run(id, l.date, l.flow, JSON.stringify(l.symptoms), l.mood, l.energy, l.pain, l.stress, l.sleep_hours, l.water_ml, l.exercise_min, l.bbt, l.lh, l.mucus, l.sex);
  }
  const insFood = db.prepare('INSERT INTO food_logs (user_id, date, food_id, servings, meal) VALUES (?, ?, ?, ?, ?)');
  for (const f of demo.foods) insFood.run(id, f.date, f.food_id, f.servings, f.meal);
  const insMed = db.prepare('INSERT INTO medications (user_id, name, dose, time, kind) VALUES (?, ?, ?, ?, ?)');
  for (const m of demo.meds) insMed.run(id, m.name, m.dose, m.time, m.kind);
});
console.log(`Seeded demo account → ${EMAIL} / ${PASSWORD} (db: ${file})`);
