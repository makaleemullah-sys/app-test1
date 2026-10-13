// In-browser implementation of the Lunaria REST API for the phone build.
// Mirrors server/routes/*.js but keeps data in the private store instead of
// SQLite, and reuses the exact same engines, validators and notification rules.
import { initStore, getState, scheduleSave } from './store.js';
import { calendar } from '../server/engine/cycle.js';
import { guidanceFor } from '../server/engine/phases.js';
import * as insights from '../server/engine/insights.js';
import * as nutrition from '../server/engine/nutrition.js';
import * as C from '../server/engine/constants.js';
import { addDays, diffDays, todayIn, isValidTimeZone } from '../server/engine/dates.js';
import * as v from '../server/validate.js';
import { buildContext, ironAvgFromRows } from '../server/context.js';
import { decideNotifications, DEFAULT_PREFS } from '../server/notifications/rules.js';
import { generateDemoData } from '../scripts/demo-data.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_PROFILE = {
  birth_year: null, goal: 'track', conditions: [], diet: 'omnivore', cycle_length: 28, period_length: 5,
  luteal_length: 14, temp_unit: 'C', timezone: 'UTC', onboarded: 0,
};
const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

let ready = null;
const st = () => getState();
const nextId = () => st().seq++;

// ---------- passwords (PBKDF2 via WebCrypto) ----------
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pbkdf2(password, salt, iterations) {
  if (!globalThis.crypto?.subtle) throw new ApiError(500, 'This browser can’t create secure accounts here. Try opening the page in Chrome or Safari.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const it = 150000;
  return `pbkdf2$${it}$${b64(salt)}$${b64(await pbkdf2(password, salt, it))}`;
}
async function verifyPassword(password, stored) {
  const [alg, it, salt, hash] = String(stored).split('$');
  if (alg !== 'pbkdf2') return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(it)));
  const want = unb64(hash);
  let diff = got.length ^ want.length;
  for (let i = 0; i < Math.min(got.length, want.length); i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// ---------- helpers ----------
function me() {
  const u = st().users.find((x) => x.id === st().session);
  if (!u) throw new ApiError(401, 'Not signed in');
  return u;
}
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });
const profileOut = (u) => ({ ...u.profile, user_id: u.id });
const logList = (u) => Object.values(u.logs).sort((a, b) => (a.date < b.date ? -1 : 1));
const today = (u) => todayIn(u.profile.timezone || 'UTC');
function age(profile, t) { return profile?.birth_year ? Number(t.slice(0, 4)) - profile.birth_year : null; }

function context(u, now = new Date()) {
  const t = todayIn(u.profile.timezone || 'UTC', now);
  const periods = [...u.periods].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const logs = logList(u).filter((l) => l.date >= addDays(t, -730));
  return buildContext({ profile: u.profile, periods, logs, today: t });
}
const ironAvg = (u, t) => ironAvgFromRows(u.foods, t);

function newUser({ email, name, password_hash, timezone }) {
  return {
    id: nextId(), email, name, password_hash, created_at: sqlNow(),
    profile: { ...DEFAULT_PROFILE, timezone }, prefs: { ...DEFAULT_PREFS },
    periods: [], logs: {}, foods: [], meds: [], doses: {}, notifications: [],
  };
}

function syncPeriodFromFlow(u, date, flow) {
  if (!flow || flow < 2) return null;
  const containing = u.periods.find((p) => p.start_date <= date && p.start_date >= addDays(date, -12) && (!p.end_date || p.end_date >= date));
  if (containing) return null;
  const prev = u.periods.filter((p) => p.start_date <= date).sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0];
  if (prev && prev.end_date && diffDays(prev.end_date, date) <= 2 && diffDays(prev.start_date, date) <= 12) {
    prev.end_date = date;
    return { type: 'extended', id: prev.id };
  }
  const next = u.periods.filter((p) => p.start_date > date).sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0];
  if (next && diffDays(date, next.start_date) <= 3) {
    next.start_date = date;
    return { type: 'moved_start', id: next.id };
  }
  const id = nextId();
  u.periods.push({ id, start_date: date, end_date: null });
  return { type: 'started', id };
}

function nutritionCoverage(u, t) {
  const byDate = {};
  for (const r of u.foods) if (r.date > addDays(t, -14) && r.date <= t) (byDate[r.date] ??= []).push(r);
  const keys = ['iron', 'calcium', 'magnesium', 'fiber', 'protein', 'folate', 'b6', 'vitc'];
  return Object.values(byDate).map((es) => {
    const a = nutrition.analyzeDay(es, u.profile, 'follicular');
    const pcts = a.rows.filter((r) => keys.includes(r.key)).map((r) => Math.min(100, r.pct));
    return pcts.reduce((x, y) => x + y, 0) / pcts.length;
  });
}

function runNotifications(u, now = new Date()) {
  const ctx = context(u, now);
  if (!ctx.profile?.onboarded) return;
  const items = decideNotifications({
    ...ctx, now, prefs: u.prefs,
    todayFoods: u.foods.filter((f) => f.date === ctx.today),
    untakenMeds: u.meds.filter((m) => m.active && !(u.doses[m.id] || []).includes(ctx.today)),
    ironAvg: ironAvg(u, ctx.today),
  });
  let added = false;
  for (const n of items) {
    if (u.notifications.some((x) => x.dedupe_key === n.dedupe_key)) continue;
    u.notifications.push({ id: nextId(), user_id: u.id, ...n, read: 0, created_at: sqlNow() });
    added = true;
  }
  if (u.notifications.length > 150) u.notifications = u.notifications.slice(-150);
  if (added) scheduleSave();
}

// ---------- routes ----------
const routes = [];
const on = (method, pattern, fn) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, fn });
};

on('POST', '/auth/register', async (b) => {
  const email = v.str(b.email, 'email', 254, { required: true }).toLowerCase();
  const name = v.str(b.name, 'name', 80, { required: true });
  if (!EMAIL_RE.test(email)) throw v.bad('Please enter a valid email');
  if (typeof b.password !== 'string' || b.password.length < 8) throw v.bad('Password must be at least 8 characters');
  if (st().users.some((u) => u.email === email)) throw new ApiError(409, 'An account with this email already exists');
  const u = newUser({ email, name, password_hash: await hashPassword(b.password), timezone: isValidTimeZone(b.timezone) ? b.timezone : deviceTz() });
  st().users.push(u);
  st().session = u.id;
  return { user: publicUser(u) };
});

on('POST', '/auth/login', async (b) => {
  const email = String(b.email || '').trim().toLowerCase();
  const u = st().users.find((x) => x.email === email);
  if (!u || !(await verifyPassword(String(b.password || ''), u.password_hash))) throw new ApiError(401, 'Incorrect email or password');
  st().session = u.id;
  return { user: publicUser(u) };
});

// One-tap demo: an account pre-filled with 7 months of sample data.
on('POST', '/auth/demo', async () => {
  const email = 'demo@lunaria.app';
  const s = st();
  s.users = s.users.filter((x) => x.email !== email);
  const tz = deviceTz();
  const u = newUser({ email, name: 'Maya (demo)', password_hash: await hashPassword('lunaria-demo'), timezone: tz });
  const demo = generateDemoData(todayIn(tz));
  Object.assign(u.profile, demo.profile, { onboarded: 1 });
  u.prefs.bbt_reminder = 1;
  u.periods = demo.periods.map((p) => ({ id: nextId(), ...p }));
  for (const l of demo.logs) u.logs[l.date] = { user_id: u.id, ...l, updated_at: sqlNow() };
  u.foods = demo.foods.map((f) => ({ id: nextId(), ...f }));
  u.meds = demo.meds.map((m) => ({ id: nextId(), ...m, active: 1 }));
  s.users.push(u);
  s.session = u.id;
  return { user: publicUser(u) };
});

on('POST', '/auth/logout', () => { st().session = null; return { ok: true }; });
on('GET', '/auth/me', () => { const u = me(); return { user: publicUser(u), profile: profileOut(u) }; });

on('POST', '/auth/password', async (b) => {
  const u = me();
  if (!(await verifyPassword(String(b.current || ''), u.password_hash))) throw new ApiError(401, 'Current password is incorrect');
  if (typeof b.next !== 'string' || b.next.length < 8 || b.next.length > 200) throw v.bad('New password must be 8–200 characters');
  u.password_hash = await hashPassword(b.next);
  return { ok: true };
});

on('DELETE', '/auth/account', async (b) => {
  const u = me();
  if (!(await verifyPassword(String(b.password || ''), u.password_hash))) throw new ApiError(401, 'Password is incorrect');
  st().users = st().users.filter((x) => x.id !== u.id);
  st().session = null;
  return { ok: true };
});

on('GET', '/meta', () => ({
  symptoms: C.SYMPTOMS, flow: C.FLOW_LABELS, lh: C.LH_VALUES, mucus: C.MUCUS_VALUES,
  sex: C.SEX_VALUES, goals: C.GOALS, diets: C.DIETS, conditions: C.CONDITIONS, nutrients: nutrition.NUTRIENTS,
}));

function applyProfile(u, fields) {
  if (fields.conditions) fields.conditions = JSON.parse(fields.conditions);
  Object.assign(u.profile, fields);
}

on('PUT', '/profile', (b) => {
  const u = me();
  applyProfile(u, v.profile(b));
  if (b.name !== undefined) u.name = v.str(b.name, 'name', 80, { required: true });
  return { profile: profileOut(u) };
});

on('POST', '/onboarding', (b) => {
  const u = me();
  const fields = v.profile({ ...b, onboarded: true });
  const starts = (Array.isArray(b.period_starts) ? b.period_starts : []).map((d) => v.date(d, 'period start'));
  if (!starts.length) throw v.bad('Tell us when your last period started');
  applyProfile(u, fields);
  const len = u.profile.period_length || 5;
  for (const s of starts) if (!u.periods.some((p) => p.start_date === s)) u.periods.push({ id: nextId(), start_date: s, end_date: addDays(s, len - 1) });
  return { ok: true };
});

on('GET', '/export', () => {
  const u = me();
  return {
    exported_at: new Date().toISOString(),
    user: { email: u.email, name: u.name, created_at: u.created_at },
    profile: u.profile, periods: u.periods, daily_logs: logList(u), food_logs: u.foods,
    medications: u.meds, notification_prefs: u.prefs,
  };
});

on('GET', '/today', () => {
  const u = me();
  const ctx = context(u);
  const { profile, analysis, annotated } = ctx;
  const t = ctx.today;
  const cur = analysis.current;
  const phase = cur?.phase || 'follicular';
  const nut = nutrition.analyzeDay(u.foods.filter((f) => f.date === t), profile, phase, { age: age(profile, t) });
  return {
    today: t,
    user: publicUser(u),
    profile: profileOut(u),
    current: cur,
    stats: analysis.stats,
    predictions: analysis.predictions,
    guidance: guidanceFor(phase, profile),
    forecast: insights.forecast(analysis, annotated, t, 3),
    log: u.logs[t] || null,
    nutrition: { rows: nut.rows.filter((x) => x.focus), focus: nut.focus },
    waterGoal: cur?.inPeriod ? 2500 : 2000,
    meds: u.meds.filter((m) => m.active).sort((a, b) => (a.time < b.time ? -1 : 1)).map((m) => ({ ...m, taken: (u.doses[m.id] || []).includes(t) })),
    flags: insights.healthFlags({ analysis, annotated, today: t, profile, ironIntakeAvg: ironAvg(u, t) }).slice(0, 3),
    unread: u.notifications.filter((n) => !n.read).length,
  };
});

on('GET', '/cycle/calendar', (b, q) => {
  const from = v.date(q.get('from'), 'from');
  const to = v.date(q.get('to'), 'to');
  if (diffDays(from, to) < 0 || diffDays(from, to) > 400) throw v.bad('Range must be 0–400 days');
  const ctx = context(me());
  return { today: ctx.today, days: calendar(ctx.analysis, ctx.logs, from, to), current: ctx.analysis.current };
});

on('GET', '/periods', () => {
  const ctx = context(me());
  return { periods: ctx.periods, cycles: ctx.analysis.cycles, stats: ctx.analysis.stats };
});

on('POST', '/periods', (b) => {
  const u = me();
  const start = v.date(b.start_date, 'start_date');
  const end = b.end_date ? v.date(b.end_date, 'end_date') : null;
  if (end && end < start) throw v.bad('End date must be after start date');
  if (end && diffDays(start, end) > 15) throw v.bad('A period longer than 15 days looks like a mistake — check the dates');
  const overlap = u.periods.some((p) => p.start_date <= (end || start) && (p.end_date || addDays(p.start_date, 6)) >= start);
  if (overlap) throw new ApiError(409, 'This overlaps a period you already logged');
  const id = nextId();
  u.periods.push({ id, start_date: start, end_date: end });
  return { id };
});

on('PUT', '/periods/:id', (b, q, p) => {
  const per = me().periods.find((x) => x.id === Number(p.id));
  if (!per) throw new ApiError(404, 'Period not found');
  const start = b.start_date ? v.date(b.start_date, 'start_date') : per.start_date;
  const end = b.end_date === null ? null : b.end_date ? v.date(b.end_date, 'end_date') : per.end_date;
  if (end && end < start) throw v.bad('End date must be after start date');
  Object.assign(per, { start_date: start, end_date: end });
  return { ok: true };
});

on('DELETE', '/periods/:id', (b, q, p) => {
  const u = me();
  const n = u.periods.length;
  u.periods = u.periods.filter((x) => x.id !== Number(p.id));
  if (u.periods.length === n) throw new ApiError(404, 'Period not found');
  return { ok: true };
});

on('GET', '/logs/:date', (b, q, p) => {
  const u = me();
  const date = v.date(p.date);
  const period = u.periods
    .filter((x) => x.start_date <= date && x.start_date >= addDays(date, -12) && (!x.end_date || x.end_date >= date))
    .sort((a, c) => (a.start_date < c.start_date ? 1 : -1))[0];
  return { log: u.logs[date] || null, period: period || null };
});

on('PUT', '/logs/:date', (b, q, p) => {
  const u = me();
  const date = v.date(p.date);
  if (date > addDays(today(u), 1)) throw v.bad('You can’t log days in the future');
  const l = v.dailyLog(b);
  u.logs[date] = { user_id: u.id, date, ...l, updated_at: sqlNow() };
  return { ok: true, periodEvent: syncPeriodFromFlow(u, date, l.flow) };
});

on('POST', '/logs/:date/water', (b, q, p) => {
  const u = me();
  const date = v.date(p.date);
  const delta = v.optNum(b.delta, 'delta', -2000, 2000, { integer: true }) || 0;
  const log = u.logs[date] || (u.logs[date] = { user_id: u.id, date, flow: null, symptoms: [], water_ml: 0, updated_at: sqlNow() });
  log.water_ml = Math.max(0, (log.water_ml || 0) + delta);
  return { water_ml: log.water_ml };
});

on('GET', '/insights', () => {
  const u = me();
  const ctx = context(u);
  const { analysis, annotated, profile } = ctx;
  const t = ctx.today;
  const cur = analysis.current;
  const curLen = Math.max(35, Math.round(analysis.stats.avgCycle || 28) + 3);
  const bbt = cur ? ctx.logs.filter((l) => l.date >= cur.start && l.bbt).map((l) => ({ date: l.date, day: diffDays(cur.start, l.date) + 1, bbt: l.bbt, lh: l.lh, mucus: l.mucus })) : [];
  return {
    today: t,
    stats: analysis.stats,
    current: cur,
    cycles: analysis.cycles.slice(-12).map((c) => ({ start: c.start, length: c.length, periodLength: c.periodLength, ovulation: c.ovulation, ovulationMethod: c.ovulationMethod, lutealLength: c.lutealLength ?? null, valid: c.valid })),
    patterns: insights.symptomPatterns(annotated),
    forecast: insights.forecast(analysis, annotated, t, 5),
    curves: insights.curves(annotated, curLen),
    correlations: insights.correlations(annotated),
    flags: insights.healthFlags({ analysis, annotated, today: t, profile, ironIntakeAvg: ironAvg(u, t) }),
    score: insights.healthScore({ analysis, annotated, today: t, nutritionDays: nutritionCoverage(u, t) }),
    bbt,
    logsCount: ctx.logs.length,
  };
});

on('GET', '/report', () => {
  const u = me();
  const ctx = context(u);
  const { analysis, annotated, profile } = ctx;
  const t = ctx.today;
  const recent = annotated.filter((l) => l.date >= addDays(t, -180));
  const counts = {};
  for (const l of recent) for (const s of l.symptoms) counts[s] = (counts[s] || 0) + 1;
  const pains = recent.map((l) => l.pain).filter((x) => typeof x === 'number');
  return {
    generated: t,
    name: u.name,
    age: age(profile, t),
    goal: profile.goal,
    conditions: profile.conditions,
    stats: analysis.stats,
    current: analysis.current,
    cycles: analysis.cycles.slice(-8),
    symptoms: Object.entries(counts).map(([id, n]) => ({ id, label: C.SYMPTOM_LABEL[id], days: n })).sort((a, b) => b.days - a.days),
    pain: pains.length ? { avg: Math.round((pains.reduce((a, b) => a + b, 0) / pains.length) * 10) / 10, max: Math.max(...pains), severeDays: pains.filter((x) => x >= 7).length } : null,
    patterns: insights.symptomPatterns(annotated).filter((x) => x.cyclical).slice(0, 6),
    flags: insights.healthFlags({ analysis, annotated, today: t, profile, ironIntakeAvg: ironAvg(u, t) }),
    meds: u.meds.filter((m) => m.active).map(({ name, dose, time, kind }) => ({ name, dose, time, kind })),
    daysLogged: recent.length,
  };
});

on('GET', '/nutrition/foods', (b, q) => ({ foods: nutrition.searchFoods(q.get('q'), me().profile) }));

on('GET', '/nutrition/day/:date', (b, q, p) => {
  const u = me();
  const date = v.date(p.date);
  const ctx = context(u);
  const cal = calendar(ctx.analysis, ctx.logs, date, date)[0];
  const phase = cal?.phase || ctx.analysis.current?.phase || 'follicular';
  const entries = u.foods.filter((f) => f.date === date);
  const analysis = nutrition.analyzeDay(entries, u.profile, phase, { age: age(u.profile, ctx.today) });
  return {
    date, phase,
    entries: entries.map((e) => ({ ...e, food: nutrition.FOOD_BY_ID.get(e.food_id) })),
    analysis,
    suggestions: nutrition.suggestFoods(analysis, u.profile),
    meals: nutrition.mealIdeas(phase, u.profile),
    guidance: guidanceFor(phase, u.profile).nutrition,
    water_ml: u.logs[date]?.water_ml || 0,
    waterGoal: cal?.period ? 2500 : 2000,
  };
});

on('POST', '/nutrition/entries', (b) => {
  const u = me();
  const date = v.date(b.date);
  const servings = v.optNum(b.servings, 'servings', 0.25, 10) ?? 1;
  const meal = v.optEnum(b.meal, 'meal', ['breakfast', 'lunch', 'dinner', 'snack']) || 'snack';
  const foods = Array.isArray(b.food_ids) ? b.food_ids : [b.food_id];
  if (!foods.length || foods.some((f) => !nutrition.FOOD_BY_ID.has(f))) throw v.bad('Unknown food');
  for (const food_id of foods) u.foods.push({ id: nextId(), date, food_id, servings, meal });
  return { ok: true };
});

on('DELETE', '/nutrition/entries/:id', (b, q, p) => {
  const u = me();
  const n = u.foods.length;
  u.foods = u.foods.filter((f) => f.id !== Number(p.id));
  if (u.foods.length === n) throw new ApiError(404, 'Entry not found');
  return { ok: true };
});

on('GET', '/notifications', () => {
  const u = me();
  runNotifications(u);
  const items = [...u.notifications].reverse().slice(0, 100).map((n) => ({ ...n, read: Boolean(n.read) }));
  return { items, unread: items.filter((n) => !n.read).length };
});

on('POST', '/notifications/read', (b) => {
  const u = me();
  const ids = new Set((Array.isArray(b.ids) ? b.ids : []).map(Number));
  for (const n of u.notifications) if (b.all || ids.has(n.id)) n.read = 1;
  return { ok: true };
});

on('DELETE', '/notifications', () => { const u = me(); u.notifications = u.notifications.filter((n) => !n.read); return { ok: true }; });
on('GET', '/notifications/prefs', () => ({ prefs: me().prefs }));
on('PUT', '/notifications/prefs', (b) => { const u = me(); Object.assign(u.prefs, v.prefs(b)); return { prefs: u.prefs }; });
on('GET', '/push/key', () => ({ publicKey: null }));

on('POST', '/notifications/test', () => {
  const u = me();
  u.notifications.push({ id: nextId(), user_id: u.id, type: 'test', title: 'Notifications are working 🌙', body: 'You will get cycle, health and nutrition nudges here.', link: '/notifications', dedupe_key: `test:${Date.now()}`, read: 0, created_at: sqlNow() });
  return { ok: true, pushed: 0 };
});

on('GET', '/meds', () => {
  const u = me();
  const t = today(u);
  const order = [...u.meds].sort((a, b) => (b.active - a.active) || (a.time < b.time ? -1 : 1));
  return {
    today: t,
    meds: order.map((m) => {
      const d = u.doses[m.id] || [];
      return { ...m, active: Boolean(m.active), taken: d.includes(t), taken7: d.filter((x) => x > addDays(t, -7) && x <= t).length };
    }),
  };
});

on('POST', '/meds', (b) => {
  const u = me();
  const med = {
    id: nextId(),
    name: v.str(b.name, 'name', 80, { required: true }),
    dose: v.str(b.dose, 'dose', 80),
    time: v.hm(b.time, 'time'),
    kind: v.optEnum(b.kind, 'kind', ['medication', 'supplement', 'contraceptive']) || 'medication',
    active: 1,
  };
  u.meds.push(med);
  return { id: med.id };
});

on('PUT', '/meds/:id', (b, q, p) => {
  const m = me().meds.find((x) => x.id === Number(p.id));
  if (!m) throw new ApiError(404, 'Not found');
  if (b.name !== undefined) m.name = v.str(b.name, 'name', 80, { required: true });
  if (b.dose !== undefined) m.dose = v.str(b.dose, 'dose', 80);
  if (b.time !== undefined) m.time = v.hm(b.time, 'time');
  if (b.active !== undefined) m.active = b.active ? 1 : 0;
  return { ok: true };
});

on('DELETE', '/meds/:id', (b, q, p) => {
  const u = me();
  const n = u.meds.length;
  u.meds = u.meds.filter((m) => m.id !== Number(p.id));
  if (u.meds.length === n) throw new ApiError(404, 'Not found');
  delete u.doses[p.id];
  return { ok: true };
});

on('POST', '/meds/:id/taken', (b, q, p) => {
  const u = me();
  const m = u.meds.find((x) => x.id === Number(p.id));
  if (!m) throw new ApiError(404, 'Not found');
  const date = b.date ? v.date(b.date) : today(u);
  const doses = (u.doses[m.id] ||= []);
  if (b.taken === false) u.doses[m.id] = doses.filter((d) => d !== date);
  else if (!doses.includes(date)) doses.push(date);
  for (const n of u.notifications) if (n.dedupe_key === `med:${m.id}:${date}`) n.read = 1;
  return { ok: true };
});

async function request(method, url, body = {}) {
  ready ??= initStore();
  await ready;
  const [path, qs = ''] = url.split('?');
  const route = routes.find((r) => r.method === method && r.re.test(path));
  if (!route) throw new ApiError(404, 'Not found');
  const m = route.re.exec(path);
  const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  try {
    const out = await route.fn(body || {}, new URLSearchParams(qs), params);
    if (method !== 'GET' || path === '/notifications') scheduleSave();
    return JSON.parse(JSON.stringify(out)); // hand back copies, like a network response
  } catch (err) {
    if (err.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('lunaria:signed-out'));
    if (err instanceof ApiError || err.status) throw new ApiError(err.status || 400, err.message);
    console.error(err);
    throw new ApiError(500, 'Something went wrong');
  }
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b = {}) => request('PUT', u, b),
  del: (u, b) => request('DELETE', u, b),
};

let metaCache = null;
export async function meta() {
  metaCache ??= await api.get('/meta');
  return metaCache;
}
