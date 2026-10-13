'use strict';
const { analyzeCycles } = require('./engine/cycle');
const { annotate } = require('./engine/insights');
const { todayIn, addDays } = require('./engine/dates');
const { totalsFor } = require('./engine/nutrition');

function getProfile(db, userId) {
  return db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
}

function parseLog(row) {
  if (!row) return null;
  let symptoms = [];
  try { symptoms = JSON.parse(row.symptoms || '[]'); } catch { /* keep empty */ }
  return { ...row, symptoms };
}

/** Everything the engines need for one user, computed for their local "today". */
function loadContext(db, userId, now = new Date()) {
  const profile = getProfile(db, userId);
  const today = todayIn(profile?.timezone || 'UTC', now);
  const periods = db.prepare('SELECT id, start_date, end_date FROM periods WHERE user_id = ? ORDER BY start_date').all(userId);
  const logs = db.prepare('SELECT * FROM daily_logs WHERE user_id = ? AND date >= ? ORDER BY date')
    .all(userId, addDays(today, -730)).map(parseLog);
  return buildContext({ profile, periods, logs, today });
}

/** Storage-independent half of loadContext (also used by the phone build). */
function buildContext({ profile, periods, logs, today }) {
  const analysis = analyzeCycles({ periods, logs, profile, today });
  return { profile, today, periods, logs, analysis, annotated: annotate(analysis, logs) };
}

/** Average daily iron (mg) across days with food logged in the last `days`. */
function ironIntakeAvg(db, userId, today, days = 30) {
  const rows = db.prepare('SELECT date, food_id, servings FROM food_logs WHERE user_id = ? AND date > ? AND date <= ?')
    .all(userId, addDays(today, -days), today);
  return ironAvgFromRows(rows, today, days);
}

function ironAvgFromRows(rows, today, days = 30) {
  const byDate = {};
  for (const r of rows) if (r.date > addDays(today, -days) && r.date <= today) (byDate[r.date] ??= []).push(r);
  const vals = Object.values(byDate).map((es) => totalsFor(es).iron);
  return vals.length >= 3 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
}

module.exports = { getProfile, parseLog, loadContext, buildContext, ironIntakeAvg, ironAvgFromRows };
