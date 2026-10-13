'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const { computeNotifications, runForUser, inQuietHours } = require('../server/notifications/scheduler');
const { addDays, todayIn } = require('../server/engine/dates');

let server, base, db;

test.before(async () => {
  db = openDb(':memory:');
  const app = createApp(db);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u, b) => call('DELETE', u, b) };
}

test('auth: register, me, logout, login, bad password', async () => {
  const c = client();
  let r = await c.post('/auth/register', { email: 'A@x.io', name: 'Ann', password: 'short' });
  assert.equal(r.status, 400);
  r = await c.post('/auth/register', { email: 'A@x.io', name: 'Ann', password: 'password123', timezone: 'Europe/London' });
  assert.equal(r.status, 201);
  r = await c.get('/auth/me');
  assert.equal(r.body.user.email, 'a@x.io');
  assert.equal(r.body.profile.timezone, 'Europe/London');
  assert.equal((await c.post('/auth/register', { email: 'a@x.io', name: 'B', password: 'password123' })).status, 409);
  await c.post('/auth/logout');
  assert.equal((await c.get('/auth/me')).status, 401);
  assert.equal((await c.post('/auth/login', { email: 'a@x.io', password: 'nope-nope' })).status, 401);
  assert.equal((await c.post('/auth/login', { email: 'a@x.io', password: 'password123' })).status, 200);
  assert.equal((await c.get('/today')).status, 200);
});

test('protected routes require a session', async () => {
  const c = client();
  assert.equal((await c.get('/today')).status, 401);
  assert.equal((await c.get('/insights')).status, 401);
});

test('full flow: onboarding, logging, periods, nutrition, insights, isolation', async () => {
  const c = client();
  await c.post('/auth/register', { email: 'b@x.io', name: 'Bea', password: 'password123', timezone: 'UTC' });
  const today = todayIn('UTC');
  const last = addDays(today, -10);
  let r = await c.post('/onboarding', { goal: 'conceive', diet: 'vegetarian', conditions: ['pcos'], cycle_length: 30, period_length: 5, period_starts: [addDays(last, -30), last] });
  assert.equal(r.status, 200);

  r = await c.get('/today');
  assert.equal(r.body.current.cycleDay, 11);
  assert.equal(r.body.current.nextStart, addDays(last, 30));
  assert.ok(r.body.guidance.goalTips.length > 0);
  assert.ok(r.body.guidance.conditionTips.some((t) => t.condition === 'pcos'));

  r = await c.put(`/logs/${today}`, { symptoms: ['cramps', 'bogus'] });
  assert.equal(r.status, 400);
  r = await c.put(`/logs/${today}`, { symptoms: ['bloating'], mood: 4, pain: 2, bbt: 97.7, lh: 'positive', notes: '<script>x</script>' });
  assert.equal(r.status, 200);
  r = await c.get(`/logs/${today}`);
  assert.equal(r.body.log.bbt, 36.5); // °F converted to °C
  assert.deepEqual(r.body.log.symptoms, ['bloating']);

  r = await c.get('/today');
  assert.equal(r.body.current.ovulation.method, 'lh');
  assert.equal(r.body.current.ovulation.confirmed, true);

  r = await c.post(`/logs/${today}/water`, { delta: 500 });
  assert.equal(r.body.water_ml, 500);
  r = await c.post(`/logs/${today}/water`, { delta: -900 });
  assert.equal(r.body.water_ml, 0);

  assert.equal((await c.put(`/logs/${addDays(today, 5)}`, {})).status, 400);

  // Medium flow on a day with no period auto-starts one.
  r = await c.put(`/logs/${addDays(last, -60)}`, { flow: 3 });
  assert.equal(r.body.periodEvent.type, 'started');
  r = await c.get('/periods');
  assert.equal(r.body.periods.length, 3);
  assert.equal((await c.post('/periods', { start_date: addDays(last, 1) })).status, 409);

  r = await c.post('/nutrition/entries', { date: today, food_id: 'lentils', meal: 'lunch', servings: 1 });
  assert.equal(r.status, 201);
  assert.equal((await c.post('/nutrition/entries', { date: today, food_id: 'unicorn' })).status, 400);
  r = await c.get(`/nutrition/day/${today}`);
  assert.equal(r.body.entries.length, 1);
  assert.equal(r.body.analysis.targets.iron, 32);
  assert.equal(r.body.analysis.targets.folate, 600);

  r = await c.get('/insights');
  assert.equal(r.status, 200);
  assert.ok(r.body.score.score > 0);

  r = await c.get('/report');
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Bea');

  r = await c.get('/export');
  assert.equal(r.body.daily_logs.length, 2);

  // Another user can't see or delete Bea's data.
  const other = client();
  await other.post('/auth/register', { email: 'c@x.io', name: 'Cy', password: 'password123' });
  const pid = (await c.get('/periods')).body.periods[0].id;
  assert.equal((await other.del(`/periods/${pid}`)).status, 404);
  assert.equal((await other.get(`/logs/${today}`)).body.log, null);
});

test('notifications: prefs, meds, scheduler and dedupe', async () => {
  const c = client();
  const reg = await c.post('/auth/register', { email: 'd@x.io', name: 'Dee', password: 'password123', timezone: 'UTC' });
  const uid = reg.body.user.id;
  const today = todayIn('UTC');
  await c.post('/onboarding', { period_starts: [addDays(today, -26)], cycle_length: 28 });
  await c.put('/notifications/prefs', { quiet_start: '00:00', quiet_end: '00:00' });
  assert.equal((await c.put('/notifications/prefs', { daily_log_time: '25:00' })).status, 400);
  const med = await c.post('/meds', { name: 'Folic acid', dose: '400 µg', time: '08:00', kind: 'supplement' });
  assert.equal(med.status, 201);

  const noon = new Date(`${today}T12:00:00Z`);
  const items = computeNotifications(db, uid, noon);
  const types = items.map((n) => n.type);
  assert.ok(types.includes('period'), 'period heads-up');
  assert.ok(types.includes('medication'));
  assert.ok(types.includes('hydration'));

  const first = await runForUser(db, uid, noon);
  const second = await runForUser(db, uid, noon);
  assert.ok(first.length > 0);
  assert.equal(second.length, 0, 'deduped');

  await c.post(`/meds/${med.body.id}/taken`, {});
  assert.ok(!computeNotifications(db, uid, noon).some((n) => n.type === 'medication'));

  const r = await c.get('/notifications');
  // Marking the dose taken also marked its reminder read.
  assert.ok(r.body.unread >= first.filter((n) => n.type !== 'medication').length);
  await c.post('/notifications/read', { all: true });
  assert.equal((await c.get('/notifications')).body.unread, 0);

  assert.equal(inQuietHours(23 * 60, '22:00', '07:00'), true);
  assert.equal(inQuietHours(12 * 60, '22:00', '07:00'), false);
});

test('account deletion removes all data', async () => {
  const c = client();
  await c.post('/auth/register', { email: 'e@x.io', name: 'Eve', password: 'password123' });
  assert.equal((await c.del('/auth/account', { password: 'wrong-pass' })).status, 401);
  assert.equal((await c.del('/auth/account', { password: 'password123' })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE email = 'e@x.io'").get().n, 0);
  assert.equal((await c.get('/auth/me')).status, 401);
});

test('cross-origin writes are rejected', async () => {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(res.status, 403);
});
