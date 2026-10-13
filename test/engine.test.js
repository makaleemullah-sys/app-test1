'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeCycles, detectOvulation, calendar } = require('../server/engine/cycle');
const { addDays, diffDays, localParts } = require('../server/engine/dates');
const insights = require('../server/engine/insights');
const nutrition = require('../server/engine/nutrition');

const profile = { cycle_length: 28, period_length: 5, luteal_length: 14 };
const periodsFrom = (starts) => starts.map((s) => ({ start_date: s, end_date: addDays(s, 4) }));

test('dates: arithmetic is DST-safe and timezone-aware', () => {
  assert.equal(addDays('2026-03-07', 2), '2026-03-09');
  assert.equal(diffDays('2026-02-27', '2026-03-01'), 2);
  const now = new Date('2026-10-13T23:30:00Z');
  assert.equal(localParts('UTC', now).date, '2026-10-13');
  assert.equal(localParts('Asia/Karachi', now).date, '2026-10-14');
});

test('new user falls back to profile defaults', () => {
  const a = analyzeCycles({ periods: periodsFrom(['2026-10-01']), logs: [], profile, today: '2026-10-05' });
  assert.equal(a.current.cycleDay, 5);
  assert.equal(a.current.nextStart, '2026-10-29');
  assert.equal(a.current.ovulation.date, '2026-10-15');
  assert.equal(a.current.phase, 'menstrual');
  assert.equal(a.stats.confidence, 'low');
  assert.equal(a.predictions.length, 3);
});

test('averages learned cycle lengths with recency weighting', () => {
  const a = analyzeCycles({ periods: periodsFrom(['2026-06-01', '2026-07-01', '2026-07-31', '2026-08-30', '2026-09-29']), logs: [], profile, today: '2026-10-02' });
  assert.equal(a.stats.avgCycle, 30);
  assert.equal(a.stats.regularity, 'very regular');
  assert.equal(a.current.nextStart, '2026-10-29');
});

test('flags late periods', () => {
  const a = analyzeCycles({ periods: periodsFrom(['2026-08-01', '2026-08-29']), logs: [], profile, today: '2026-10-01' });
  assert.equal(a.current.isLate, true);
  assert.equal(a.current.daysLate, 5);
  assert.ok(a.predictions[0].start > '2026-10-01');
});

test('BBT three-over-six rule confirms ovulation', () => {
  const start = '2026-09-01';
  const logs = [];
  for (let d = 1; d <= 20; d++) logs.push({ date: addDays(start, d - 1), bbt: d <= 16 ? 36.4 : 36.75 });
  const byDate = new Map(logs.map((l) => [l.date, l]));
  const ov = detectOvulation(start, addDays(start, 19), byDate);
  assert.equal(ov.method, 'bbt');
  assert.equal(ov.date, addDays(start, 15)); // day before first high temp
});

test('confirmed ovulation pins next period to luteal length', () => {
  const start = '2026-09-01';
  const logs = [{ date: addDays(start, 18), lh: 'peak' }]; // late ovulation on day 20
  const a = analyzeCycles({ periods: periodsFrom([start]), logs, profile, today: addDays(start, 22) });
  assert.equal(a.current.ovulation.confirmed, true);
  assert.equal(a.current.ovulation.date, addDays(start, 19));
  assert.equal(a.current.nextStart, addDays(start, 33)); // ov + 14, not start + 28
  assert.deepEqual(a.current.nextWindow, [addDays(start, 32), addDays(start, 34)]);
});

test('outlier cycles are excluded from averages', () => {
  const a = analyzeCycles({ periods: periodsFrom(['2026-01-01', '2026-01-29', '2026-05-01', '2026-05-29']), logs: [], profile, today: '2026-06-01' });
  assert.equal(a.stats.outliers.length, 1);
  assert.equal(a.stats.avgCycle, 28);
});

test('calendar marks logged, fertile and predicted days', () => {
  const a = analyzeCycles({ periods: periodsFrom(['2026-10-01']), logs: [], profile, today: '2026-10-05' });
  const days = calendar(a, [], '2026-10-01', '2026-11-05');
  const by = Object.fromEntries(days.map((d) => [d.date, d]));
  assert.equal(by['2026-10-01'].period, 'logged');
  assert.equal(by['2026-10-15'].ovulation, true);
  assert.equal(by['2026-10-10'].fertile, true);
  assert.equal(by['2026-10-29'].period, 'predicted');
  assert.equal(by['2026-10-20'].phase, 'luteal');
});

function syntheticHistory() {
  const starts = ['2026-05-01', '2026-05-29', '2026-06-26', '2026-07-24', '2026-08-21', '2026-09-18'];
  const logs = [];
  for (let c = 0; c < starts.length - 1; c++) {
    for (let day = 1; day <= 28; day++) {
      const date = addDays(starts[c], day - 1);
      const symptoms = [];
      if (day <= 2) symptoms.push('cramps');
      if (day >= 26) symptoms.push('headache');
      const sleep = day % 2 ? 6 : 8;
      logs.push({ date, symptoms, mood: day >= 24 ? 2 : 4, energy: 3, pain: day <= 2 ? (sleep < 7 ? 8 : 5) : (sleep < 7 ? 3 : 0), sleep_hours: sleep, water_ml: 2000 });
    }
  }
  return { starts, logs };
}

test('insights find cyclical symptoms, forecast them and spot correlations', () => {
  const { starts, logs } = syntheticHistory();
  const today = addDays(starts[5], 24); // 4 days before next period
  const a = analyzeCycles({ periods: periodsFrom(starts), logs, profile, today });
  const ann = insights.annotate(a, logs);
  const patterns = insights.symptomPatterns(ann);
  const headache = patterns.find((p) => p.symptom === 'headache');
  assert.equal(headache.phase, 'luteal');
  assert.ok(headache.cyclical);
  assert.match(headache.when, /before your period/);
  const cramps = patterns.find((p) => p.symptom === 'cramps');
  assert.equal(cramps.phase, 'menstrual');

  const fc = insights.forecast(a, ann, today, 3);
  assert.ok(fc[1].symptoms.some((s) => s.symptom === 'headache' && s.probability >= 60));

  const cor = insights.correlations(ann);
  assert.ok(cor.some((c) => c.factor === 'sleep' && c.outcome === 'pain'));

  const flags = insights.healthFlags({ analysis: a, annotated: ann, today, profile, ironIntakeAvg: null });
  assert.ok(flags.some((f) => f.id === 'severe_pain'));
});

test('health flags catch long cycles', () => {
  const starts = ['2026-01-01', '2026-02-15', '2026-04-01', '2026-05-16'];
  const a = analyzeCycles({ periods: periodsFrom(starts), logs: [], profile, today: '2026-05-20' });
  const flags = insights.healthFlags({ analysis: a, annotated: [], today: '2026-05-20', profile, ironIntakeAvg: null });
  assert.ok(flags.some((f) => f.id === 'long_cycles' && f.severity === 'consult'));
});

test('nutrition: diet-aware targets, totals and gap-closing suggestions', () => {
  const veg = { diet: 'vegan', goal: 'conceive' };
  const t = nutrition.targets(veg, 'luteal');
  assert.equal(t.iron, 32);
  assert.equal(t.folate, 600);
  assert.equal(t.caffeine, 200);
  assert.equal(t.kcal, 2200);
  const day = nutrition.analyzeDay([{ food_id: 'lentils', servings: 2 }, { food_id: 'coffee', servings: 3 }], veg, 'menstrual');
  assert.equal(day.totals.iron, 13.2);
  assert.ok(day.warnings.some((w) => w.includes('Caffeine')));
  const sugg = nutrition.suggestFoods(day, veg);
  assert.ok(sugg.length > 0);
  for (const s of sugg) assert.equal(nutrition.FOOD_BY_ID.get(s.id).diet, 'vegan');
  assert.ok(nutrition.mealIdeas('menstrual', veg).every((m) => m.foods.every((f) => nutrition.FOOD_BY_ID.get(f).diet === 'vegan')));
});
