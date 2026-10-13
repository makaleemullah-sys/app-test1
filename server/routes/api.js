'use strict';
const express = require('express');
const v = require('../validate');
const { tx } = require('../db');
const { loadContext, ironIntakeAvg, parseLog } = require('../context');
const { calendar } = require('../engine/cycle');
const { guidanceFor } = require('../engine/phases');
const insights = require('../engine/insights');
const nutrition = require('../engine/nutrition');
const C = require('../engine/constants');
const { addDays, diffDays, todayIn } = require('../engine/dates');

module.exports = function apiRoutes(db) {
  const r = express.Router();
  const uid = (req) => req.user.id;

  r.get('/meta', (req, res) => {
    res.json({
      symptoms: C.SYMPTOMS, flow: C.FLOW_LABELS, lh: C.LH_VALUES, mucus: C.MUCUS_VALUES,
      sex: C.SEX_VALUES, goals: C.GOALS, diets: C.DIETS, conditions: C.CONDITIONS, nutrients: nutrition.NUTRIENTS,
    });
  });

  // ---------- profile ----------
  r.put('/profile', (req, res) => {
    const fields = v.profile(req.body);
    const keys = Object.keys(fields);
    if (keys.length) {
      db.prepare(`UPDATE profiles SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`).run(...keys.map((k) => fields[k]), uid(req));
    }
    if (req.body.name !== undefined) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(v.str(req.body.name, 'name', 80, { required: true }), uid(req));
    }
    const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid(req));
    res.json({ profile: { ...p, conditions: JSON.parse(p.conditions) } });
  });

  // Onboarding: profile + first period(s) in one atomic step.
  r.post('/onboarding', (req, res) => {
    const fields = v.profile({ ...req.body, onboarded: true });
    const starts = (Array.isArray(req.body.period_starts) ? req.body.period_starts : []).map((d) => v.date(d, 'period start'));
    if (!starts.length) throw v.bad('Tell us when your last period started');
    tx(db, () => {
      const keys = Object.keys(fields);
      db.prepare(`UPDATE profiles SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`).run(...keys.map((k) => fields[k]), uid(req));
      const ins = db.prepare('INSERT OR IGNORE INTO periods (user_id, start_date, end_date) VALUES (?, ?, ?)');
      const len = fields.period_length || 5;
      for (const s of starts) ins.run(uid(req), s, addDays(s, len - 1));
    });
    res.json({ ok: true });
  });

  r.get('/export', (req, res) => {
    const id = uid(req);
    const data = {
      exported_at: new Date().toISOString(),
      user: db.prepare('SELECT email, name, created_at FROM users WHERE id = ?').get(id),
      profile: db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(id),
      periods: db.prepare('SELECT start_date, end_date FROM periods WHERE user_id = ? ORDER BY start_date').all(id),
      daily_logs: db.prepare('SELECT * FROM daily_logs WHERE user_id = ? ORDER BY date').all(id).map(parseLog),
      food_logs: db.prepare('SELECT date, food_id, servings, meal FROM food_logs WHERE user_id = ? ORDER BY date').all(id),
      medications: db.prepare('SELECT name, dose, time, kind, active FROM medications WHERE user_id = ?').all(id),
      notification_prefs: db.prepare('SELECT * FROM notification_prefs WHERE user_id = ?').get(id),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="lunaria-export.json"');
    res.json(data);
  });

  // ---------- dashboard ----------
  r.get('/today', (req, res) => {
    const ctx = loadContext(db, uid(req));
    const { profile, today, analysis, annotated } = ctx;
    const cur = analysis.current;
    const phase = cur?.phase || 'follicular';
    const todayLog = ctx.logs.find((l) => l.date === today) || null;
    const entries = db.prepare('SELECT food_id, servings FROM food_logs WHERE user_id = ? AND date = ?').all(uid(req), today);
    const nut = nutrition.analyzeDay(entries, profile, phase, { age: age(profile, today) });
    const meds = db.prepare(`SELECT m.*, EXISTS(SELECT 1 FROM med_doses d WHERE d.med_id = m.id AND d.date = ?) AS taken
      FROM medications m WHERE m.user_id = ? AND m.active = 1 ORDER BY m.time`).all(today, uid(req));
    const flags = insights.healthFlags({ analysis, annotated, today, profile, ironIntakeAvg: ironIntakeAvg(db, uid(req), today) });
    res.json({
      today,
      user: req.user,
      profile: { ...profile, conditions: JSON.parse(profile.conditions) },
      current: cur,
      stats: analysis.stats,
      predictions: analysis.predictions,
      guidance: guidanceFor(phase, profile),
      forecast: insights.forecast(analysis, annotated, today, 3),
      log: todayLog,
      nutrition: { rows: nut.rows.filter((x) => x.focus), focus: nut.focus },
      waterGoal: cur?.inPeriod ? 2500 : 2000,
      meds: meds.map((m) => ({ ...m, taken: Boolean(m.taken) })),
      flags: flags.slice(0, 3),
      unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(uid(req)).n,
    });
  });

  r.get('/cycle/calendar', (req, res) => {
    const from = v.date(req.query.from, 'from');
    const to = v.date(req.query.to, 'to');
    if (diffDays(from, to) < 0 || diffDays(from, to) > 400) throw v.bad('Range must be 0–400 days');
    const ctx = loadContext(db, uid(req));
    res.json({ today: ctx.today, days: calendar(ctx.analysis, ctx.logs, from, to), current: ctx.analysis.current });
  });

  // ---------- periods ----------
  r.get('/periods', (req, res) => {
    const ctx = loadContext(db, uid(req));
    res.json({ periods: ctx.periods, cycles: ctx.analysis.cycles, stats: ctx.analysis.stats });
  });

  r.post('/periods', (req, res) => {
    const start = v.date(req.body.start_date, 'start_date');
    const end = req.body.end_date ? v.date(req.body.end_date, 'end_date') : null;
    if (end && end < start) throw v.bad('End date must be after start date');
    if (end && diffDays(start, end) > 15) throw v.bad('A period longer than 15 days looks like a mistake — check the dates');
    const overlap = db.prepare(`SELECT id FROM periods WHERE user_id = ? AND start_date <= ? AND COALESCE(end_date, date(start_date, '+6 days')) >= ?`)
      .get(uid(req), end || start, start);
    if (overlap) throw new v.HttpError(409, 'This overlaps a period you already logged');
    const info = db.prepare('INSERT INTO periods (user_id, start_date, end_date) VALUES (?, ?, ?)').run(uid(req), start, end);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.put('/periods/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM periods WHERE id = ? AND user_id = ?').get(req.params.id, uid(req));
    if (!p) throw new v.HttpError(404, 'Period not found');
    const start = req.body.start_date ? v.date(req.body.start_date, 'start_date') : p.start_date;
    const end = req.body.end_date === null ? null : req.body.end_date ? v.date(req.body.end_date, 'end_date') : p.end_date;
    if (end && end < start) throw v.bad('End date must be after start date');
    db.prepare('UPDATE periods SET start_date = ?, end_date = ? WHERE id = ?').run(start, end, p.id);
    res.json({ ok: true });
  });

  r.delete('/periods/:id', (req, res) => {
    const info = db.prepare('DELETE FROM periods WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
    if (!info.changes) throw new v.HttpError(404, 'Period not found');
    res.json({ ok: true });
  });

  // ---------- daily logs ----------
  r.get('/logs', (req, res) => {
    const from = v.date(req.query.from, 'from');
    const to = v.date(req.query.to, 'to');
    const rows = db.prepare('SELECT * FROM daily_logs WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date').all(uid(req), from, to);
    res.json({ logs: rows.map(parseLog) });
  });

  r.get('/logs/:date', (req, res) => {
    const date = v.date(req.params.date);
    const row = db.prepare('SELECT * FROM daily_logs WHERE user_id = ? AND date = ?').get(uid(req), date);
    const period = db.prepare(`SELECT * FROM periods WHERE user_id = ? AND start_date <= ? AND start_date >= ?
      AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC LIMIT 1`).get(uid(req), date, addDays(date, -12), date);
    res.json({ log: parseLog(row), period: period || null });
  });

  r.put('/logs/:date', (req, res) => {
    const date = v.date(req.params.date);
    const { timezone } = db.prepare('SELECT timezone FROM profiles WHERE user_id = ?').get(uid(req));
    const today = todayIn(timezone);
    if (date > addDays(today, 1)) throw v.bad('You can’t log days in the future');
    const l = v.dailyLog(req.body);
    let periodEvent = null;
    tx(db, () => {
      db.prepare(`INSERT INTO daily_logs (user_id, date, flow, symptoms, mood, energy, pain, stress, sleep_hours, water_ml, exercise_min, bbt, lh, mucus, sex, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT (user_id, date) DO UPDATE SET flow = excluded.flow, symptoms = excluded.symptoms, mood = excluded.mood,
          energy = excluded.energy, pain = excluded.pain, stress = excluded.stress, sleep_hours = excluded.sleep_hours,
          water_ml = excluded.water_ml, exercise_min = excluded.exercise_min, bbt = excluded.bbt, lh = excluded.lh,
          mucus = excluded.mucus, sex = excluded.sex, notes = excluded.notes, updated_at = excluded.updated_at`)
        .run(uid(req), date, l.flow, JSON.stringify(l.symptoms), l.mood, l.energy, l.pain, l.stress, l.sleep_hours,
          l.water_ml, l.exercise_min, l.bbt, l.lh, l.mucus, l.sex, l.notes);
      periodEvent = syncPeriodFromFlow(db, uid(req), date, l.flow);
    });
    res.json({ ok: true, periodEvent });
  });

  r.post('/logs/:date/water', (req, res) => {
    const date = v.date(req.params.date);
    const delta = v.optNum(req.body.delta, 'delta', -2000, 2000, { integer: true }) || 0;
    db.prepare(`INSERT INTO daily_logs (user_id, date, water_ml) VALUES (?, ?, MAX(0, ?))
      ON CONFLICT (user_id, date) DO UPDATE SET water_ml = MAX(0, water_ml + ?), updated_at = datetime('now')`).run(uid(req), date, delta, delta);
    const row = db.prepare('SELECT water_ml FROM daily_logs WHERE user_id = ? AND date = ?').get(uid(req), date);
    res.json({ water_ml: row.water_ml });
  });

  // ---------- insights ----------
  r.get('/insights', (req, res) => {
    const ctx = loadContext(db, uid(req));
    const { analysis, annotated, today, profile } = ctx;
    const nutritionDays = nutritionCoverage(db, uid(req), profile, today);
    const curLen = Math.max(35, Math.round(analysis.stats.avgCycle || 28) + 3);
    const cur = analysis.current;
    const bbt = cur
      ? ctx.logs.filter((l) => l.date >= cur.start && l.bbt).map((l) => ({ date: l.date, day: diffDays(cur.start, l.date) + 1, bbt: l.bbt, lh: l.lh, mucus: l.mucus }))
      : [];
    res.json({
      today,
      stats: analysis.stats,
      current: cur,
      cycles: analysis.cycles.slice(-12).map((c) => ({ start: c.start, length: c.length, periodLength: c.periodLength, ovulation: c.ovulation, ovulationMethod: c.ovulationMethod, lutealLength: c.lutealLength ?? null, valid: c.valid })),
      patterns: insights.symptomPatterns(annotated),
      forecast: insights.forecast(analysis, annotated, today, 5),
      curves: insights.curves(annotated, curLen),
      correlations: insights.correlations(annotated),
      flags: insights.healthFlags({ analysis, annotated, today, profile, ironIntakeAvg: ironIntakeAvg(db, uid(req), today) }),
      score: insights.healthScore({ analysis, annotated, today, nutritionDays }),
      bbt,
      logsCount: ctx.logs.length,
    });
  });

  // Clinician-ready summary.
  r.get('/report', (req, res) => {
    const ctx = loadContext(db, uid(req));
    const { analysis, annotated, today, profile } = ctx;
    const since = addDays(today, -180);
    const recent = annotated.filter((l) => l.date >= since);
    const symptomCounts = {};
    for (const l of recent) for (const s of l.symptoms) symptomCounts[s] = (symptomCounts[s] || 0) + 1;
    const pains = recent.map((l) => l.pain).filter((x) => typeof x === 'number');
    const meds = db.prepare('SELECT name, dose, time, kind FROM medications WHERE user_id = ? AND active = 1').all(uid(req));
    res.json({
      generated: today,
      name: req.user.name,
      age: age(profile, today),
      goal: profile.goal,
      conditions: JSON.parse(profile.conditions),
      stats: analysis.stats,
      current: analysis.current,
      cycles: analysis.cycles.slice(-8),
      symptoms: Object.entries(symptomCounts).map(([id, n]) => ({ id, label: C.SYMPTOM_LABEL[id], days: n })).sort((a, b) => b.days - a.days),
      pain: pains.length ? { avg: Math.round((pains.reduce((a, b) => a + b, 0) / pains.length) * 10) / 10, max: Math.max(...pains), severeDays: pains.filter((p) => p >= 7).length } : null,
      patterns: insights.symptomPatterns(annotated).filter((p) => p.cyclical).slice(0, 6),
      flags: insights.healthFlags({ analysis, annotated, today, profile, ironIntakeAvg: ironIntakeAvg(db, uid(req), today) }),
      meds,
      daysLogged: recent.length,
    });
  });

  // ---------- nutrition ----------
  r.get('/nutrition/foods', (req, res) => {
    const profile = db.prepare('SELECT diet FROM profiles WHERE user_id = ?').get(uid(req));
    res.json({ foods: nutrition.searchFoods(req.query.q, profile) });
  });

  r.get('/nutrition/day/:date', (req, res) => {
    const date = v.date(req.params.date);
    const ctx = loadContext(db, uid(req));
    const cal = calendar(ctx.analysis, ctx.logs, date, date)[0];
    const phase = cal?.phase || ctx.analysis.current?.phase || 'follicular';
    const entries = db.prepare('SELECT id, food_id, servings, meal FROM food_logs WHERE user_id = ? AND date = ? ORDER BY id').all(uid(req), date);
    const analysis = nutrition.analyzeDay(entries, ctx.profile, phase, { age: age(ctx.profile, ctx.today) });
    const log = ctx.logs.find((l) => l.date === date);
    res.json({
      date,
      phase,
      entries: entries.map((e) => ({ ...e, food: nutrition.FOOD_BY_ID.get(e.food_id) })),
      analysis,
      suggestions: nutrition.suggestFoods(analysis, ctx.profile),
      meals: nutrition.mealIdeas(phase, ctx.profile),
      guidance: guidanceFor(phase, ctx.profile).nutrition,
      water_ml: log?.water_ml || 0,
      waterGoal: cal?.period ? 2500 : 2000,
    });
  });

  r.post('/nutrition/entries', (req, res) => {
    const date = v.date(req.body.date);
    const servings = v.optNum(req.body.servings, 'servings', 0.25, 10) ?? 1;
    const meal = v.optEnum(req.body.meal, 'meal', ['breakfast', 'lunch', 'dinner', 'snack']) || 'snack';
    const foods = Array.isArray(req.body.food_ids) ? req.body.food_ids : [req.body.food_id];
    if (!foods.length || foods.some((f) => !nutrition.FOOD_BY_ID.has(f))) throw v.bad('Unknown food');
    const ins = db.prepare('INSERT INTO food_logs (user_id, date, food_id, servings, meal) VALUES (?, ?, ?, ?, ?)');
    tx(db, () => foods.forEach((f) => ins.run(uid(req), date, f, servings, meal)));
    res.status(201).json({ ok: true });
  });

  r.delete('/nutrition/entries/:id', (req, res) => {
    const info = db.prepare('DELETE FROM food_logs WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
    if (!info.changes) throw new v.HttpError(404, 'Entry not found');
    res.json({ ok: true });
  });

  return r;
};

function age(profile, today) {
  return profile?.birth_year ? Number(today.slice(0, 4)) - profile.birth_year : null;
}

/**
 * Logging flow should "just work": medium+ flow with no open period nearby
 * starts one; flow logged right after a period extends its end date.
 */
function syncPeriodFromFlow(db, userId, date, flow) {
  if (!flow || flow < 2) return null;
  const containing = db.prepare(`SELECT * FROM periods WHERE user_id = ? AND start_date <= ? AND start_date >= ?
    AND (end_date IS NULL OR end_date >= ?)`).get(userId, date, addDays(date, -12), date);
  if (containing) return null;
  const prev = db.prepare('SELECT * FROM periods WHERE user_id = ? AND start_date <= ? ORDER BY start_date DESC LIMIT 1').get(userId, date);
  if (prev && prev.end_date && diffDays(prev.end_date, date) <= 2 && diffDays(prev.start_date, date) <= 12) {
    db.prepare('UPDATE periods SET end_date = ? WHERE id = ?').run(date, prev.id);
    return { type: 'extended', id: prev.id };
  }
  const next = db.prepare('SELECT * FROM periods WHERE user_id = ? AND start_date > ? ORDER BY start_date LIMIT 1').get(userId, date);
  if (next && diffDays(date, next.start_date) <= 3) {
    db.prepare('UPDATE periods SET start_date = ? WHERE id = ?').run(date, next.id);
    return { type: 'moved_start', id: next.id };
  }
  const info = db.prepare('INSERT INTO periods (user_id, start_date) VALUES (?, ?)').run(userId, date);
  return { type: 'started', id: Number(info.lastInsertRowid) };
}

/** % of focus-nutrient targets met on each logged day over the last 14 days. */
function nutritionCoverage(db, userId, profile, today) {
  const rows = db.prepare('SELECT date, food_id, servings FROM food_logs WHERE user_id = ? AND date > ? AND date <= ?').all(userId, addDays(today, -14), today);
  const byDate = {};
  for (const r of rows) (byDate[r.date] ??= []).push(r);
  const keys = ['iron', 'calcium', 'magnesium', 'fiber', 'protein', 'folate', 'b6', 'vitc'];
  return Object.values(byDate).map((es) => {
    const a = nutrition.analyzeDay(es, profile, 'follicular');
    const pcts = a.rows.filter((r) => keys.includes(r.key)).map((r) => Math.min(100, r.pct));
    return pcts.reduce((x, y) => x + y, 0) / pcts.length;
  });
}
