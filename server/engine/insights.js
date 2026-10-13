'use strict';
const { addDays, diffDays } = require('./dates');
const { phaseFor, mean } = require('./cycle');
const { SYMPTOM_LABEL, RELIEF } = require('./constants');

const PHASE_ORDER = ['menstrual', 'follicular', 'ovulatory', 'luteal'];
const MIN_SUPPORT = 3;

function parseSymptoms(log) {
  if (Array.isArray(log.symptoms)) return log.symptoms;
  try { return JSON.parse(log.symptoms || '[]'); } catch { return []; }
}

/** Place each log within its cycle: cycle day, days-before-period, phase. */
function annotate(analysis, logs) {
  const cycles = analysis.cycles;
  return logs.map((log) => {
    const cyc = [...cycles].reverse().find((c) => c.start <= log.date && (!c.end || log.date <= c.end));
    const out = { ...log, symptoms: parseSymptoms(log), cycleDay: null, daysBefore: null, phase: null };
    if (!cyc) return out;
    out.cycleDay = diffDays(cyc.start, log.date) + 1;
    out.phase = phaseFor(log.date, cyc);
    out.cycleStart = cyc.start;
    if (cyc.complete) out.daysBefore = diffDays(log.date, addDays(cyc.end, 1));
    return out;
  });
}

function symptomPatterns(annotated) {
  const daysPerPhase = Object.fromEntries(PHASE_ORDER.map((p) => [p, 0]));
  const counts = {};
  const timing = {};
  for (const l of annotated) {
    if (!l.phase) continue;
    daysPerPhase[l.phase]++;
    for (const s of l.symptoms) {
      counts[s] ??= Object.fromEntries(PHASE_ORDER.map((p) => [p, 0]));
      counts[s][l.phase]++;
      timing[s] ??= { daysBefore: [], cycleDay: [] };
      if (l.daysBefore != null && l.daysBefore <= 14) timing[s].daysBefore.push(l.daysBefore);
      timing[s].cycleDay.push(l.cycleDay);
    }
  }
  const totalDays = Object.values(daysPerPhase).reduce((a, b) => a + b, 0);
  const patterns = [];
  for (const [s, byPhase] of Object.entries(counts)) {
    const total = Object.values(byPhase).reduce((a, b) => a + b, 0);
    if (total < MIN_SUPPORT) continue;
    let best = null;
    for (const p of PHASE_ORDER) {
      if (!daysPerPhase[p]) continue;
      const rate = byPhase[p] / daysPerPhase[p];
      const otherDays = totalDays - daysPerPhase[p];
      // Laplace-smoothed rate ratio keeps rare symptoms from producing huge lifts.
      const lift = ((byPhase[p] + 1) / (daysPerPhase[p] + 2)) / ((total - byPhase[p] + 1) / (otherDays + 2));
      if (!best || rate > best.rate) best = { phase: p, rate, lift, count: byPhase[p] };
    }
    if (!best || best.count < MIN_SUPPORT) continue;
    const t = timing[s];
    let when = null;
    if (best.phase === 'luteal' && t.daysBefore.length >= 2) {
      const med = median(t.daysBefore);
      when = med <= 1 ? 'the day before your period' : `about ${med} days before your period`;
    } else if (t.cycleDay.length) {
      when = `around cycle day ${median(t.cycleDay)}`;
    }
    patterns.push({
      symptom: s,
      label: SYMPTOM_LABEL[s] || s,
      total,
      phase: best.phase,
      phaseRate: Math.round(best.rate * 100),
      lift: Math.min(10, Math.round(best.lift * 10) / 10),
      cyclical: best.lift >= 1.5,
      when,
      byPhase: Object.fromEntries(PHASE_ORDER.map((p) => [p, daysPerPhase[p] ? Math.round((byPhase[p] / daysPerPhase[p]) * 100) : 0])),
    });
  }
  return patterns.sort((a, b) => (b.cyclical - a.cyclical) || (b.lift * b.total - a.lift * a.total));
}

/**
 * Personal symptom forecast. A future day is aligned with past days either by
 * distance to the next period (luteal side — more consistent) or by cycle day.
 */
function forecast(analysis, annotated, today, days = 3) {
  const cur = analysis.current;
  if (!cur) return [];
  const history = annotated.filter((l) => l.cycleDay != null);
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const until = diffDays(d, cur.nextStart);
    const cycleDay = diffDays(cur.start, d) + 1;
    const useBefore = until > 0 && until <= 12;
    const matches = history.filter((l) => (useBefore
      ? l.daysBefore != null && Math.abs(l.daysBefore - until) <= 1
      : Math.abs(l.cycleDay - (until <= 0 && !cur.isLate ? 1 - until : cycleDay)) <= 1));
    const day = { date: d, support: matches.length, symptoms: [], mood: null, energy: null, pain: null };
    if (matches.length >= MIN_SUPPORT) {
      const freq = {};
      for (const m of matches) for (const s of m.symptoms) freq[s] = (freq[s] || 0) + 1;
      day.symptoms = Object.entries(freq)
        .map(([s, n]) => ({ symptom: s, label: SYMPTOM_LABEL[s] || s, probability: Math.round(((n + 0.5) / (matches.length + 1)) * 100), relief: RELIEF[s] || null }))
        .filter((x) => x.probability >= 45)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 5);
      day.mood = avgField(matches, 'mood');
      day.energy = avgField(matches, 'energy');
      day.pain = avgField(matches, 'pain');
    }
    out.push(day);
  }
  return out;
}

function curves(annotated, maxDay = 35) {
  const rows = [];
  for (let day = 1; day <= maxDay; day++) {
    const ls = annotated.filter((l) => l.cycleDay === day);
    rows.push({ day, n: ls.length, mood: avgField(ls, 'mood'), energy: avgField(ls, 'energy'), pain: avgField(ls, 'pain'), sleep: avgField(ls, 'sleep_hours') });
  }
  return rows;
}

const FACTORS = [
  { id: 'sleep', label: 'sleep', field: 'sleep_hours', low: (v) => v < 7, high: (v) => v >= 7, lowLabel: 'under 7 h sleep', highLabel: '7 h+ sleep' },
  { id: 'water', label: 'hydration', field: 'water_ml', low: (v) => v < 1500, high: (v) => v >= 2000, lowLabel: 'under 1.5 L water', highLabel: '2 L+ water' },
  { id: 'exercise', label: 'exercise', field: 'exercise_min', low: (v) => v < 15, high: (v) => v >= 20, lowLabel: 'little/no exercise', highLabel: '20+ min exercise' },
  { id: 'stress', label: 'stress', field: 'stress', low: (v) => v >= 4, high: (v) => v <= 2, lowLabel: 'high-stress days', highLabel: 'low-stress days' },
];
const OUTCOMES = [
  { id: 'pain', label: 'pain', field: 'pain', kind: 'num', worseIsHigher: true, min: 1 },
  { id: 'mood', label: 'mood', field: 'mood', kind: 'num', worseIsHigher: false, min: 0.5 },
  { id: 'energy', label: 'energy', field: 'energy', kind: 'num', worseIsHigher: false, min: 0.5 },
  { id: 'headache', label: 'headaches', symptom: 'headache', kind: 'rate' },
  { id: 'bloating', label: 'bloating', symptom: 'bloating', kind: 'rate' },
  { id: 'cramps', label: 'cramps', symptom: 'cramps', kind: 'rate' },
];

/** Lifestyle ↔ symptom associations from the user's own logs. */
function correlations(annotated) {
  const results = [];
  for (const f of FACTORS) {
    const withF = annotated.filter((l) => typeof l[f.field] === 'number' && (f.field !== 'water_ml' || l[f.field] > 0));
    const low = withF.filter((l) => f.low(l[f.field]));
    const high = withF.filter((l) => f.high(l[f.field]));
    if (low.length < 4 || high.length < 4) continue;
    for (const o of OUTCOMES) {
      let a, b, worse, diffText;
      if (o.kind === 'num') {
        a = avgField(low, o.field); b = avgField(high, o.field);
        if (a == null || b == null) continue;
        const diff = a - b;
        if (Math.abs(diff) < o.min) continue;
        worse = o.worseIsHigher ? diff > 0 : diff < 0;
        diffText = `${o.label} averages ${fmt(a)} on ${f.lowLabel} vs ${fmt(b)} with ${f.highLabel}`;
      } else {
        const ra = low.filter((l) => l.symptoms.includes(o.symptom)).length / low.length;
        const rb = high.filter((l) => l.symptoms.includes(o.symptom)).length / high.length;
        if (Math.abs(ra - rb) < 0.2 || Math.max(ra, rb) / (Math.min(ra, rb) + 0.05) < 1.5) continue;
        a = Math.round(ra * 100); b = Math.round(rb * 100);
        worse = ra > rb;
        diffText = `${o.label} on ${a}% of ${f.lowLabel} vs ${b}% with ${f.highLabel}`;
      }
      if (!worse) continue; // only surface the expected, actionable direction
      results.push({
        factor: f.id,
        outcome: o.id,
        text: capitalise(diffText) + '.',
        tip: tipFor(f.id),
        n: [low.length, high.length],
      });
    }
  }
  return results;
}

function tipFor(factor) {
  return {
    sleep: 'Protecting your sleep looks like one of your strongest levers.',
    water: 'Keep a bottle nearby — your body seems to notice.',
    exercise: 'Even a short walk appears to help you.',
    stress: 'Stress management (breathwork, boundaries) may pay off for your symptoms.',
  }[factor];
}

/** Evidence-informed screening flags. These prompt a clinician visit; they never diagnose. */
function healthFlags({ analysis, annotated, today, profile, ironIntakeAvg }) {
  const flags = [];
  const { stats, cycles, current } = analysis;
  const complete = cycles.filter((c) => c.complete);
  const recent = complete.slice(-6);
  const conditions = safeArr(profile?.conditions);

  const short = recent.filter((c) => c.length < 21).length;
  const long = recent.filter((c) => c.length > 35 && c.length <= 90).length;
  if (short >= 2) flags.push(flag('short_cycles', 'consult', 'Frequent short cycles',
    `${short} of your last ${recent.length} cycles were shorter than 21 days.`,
    'Cycles under 21 days can relate to thyroid issues, perimenopause or a short luteal phase. Worth discussing with a clinician.'));
  if (long >= 2) flags.push(flag('long_cycles', 'consult', 'Frequent long cycles',
    `${long} of your last ${recent.length} cycles were longer than 35 days.`,
    'Long or infrequent cycles can be linked to PCOS, thyroid conditions, stress or under-fuelling. Consider an evaluation.'));
  if (stats.cyclesTracked >= 4 && stats.sdCycle > 7) flags.push(flag('irregular', 'watch', 'Your cycle length varies a lot',
    `Cycle length varies by ±${stats.sdCycle} days (range ${stats.minCycle}–${stats.maxCycle}).`,
    'Variation of more than 7–9 days between cycles is considered irregular. Keep tracking; share this with a clinician if it continues.'));

  const longPeriods = complete.slice(-6).filter((c) => c.periodLength > 7).length;
  if (longPeriods >= 2) flags.push(flag('long_periods', 'consult', 'Periods lasting more than 7 days',
    `${longPeriods} recent periods lasted longer than a week.`,
    'Prolonged bleeding is a sign of heavy menstrual bleeding and can lead to anaemia. Please mention it to a clinician.'));

  const byCycle = groupBy(annotated.filter((l) => l.cycleStart), 'cycleStart');
  let heavyCycles = 0, severePainCycles = 0, pmddCycles = 0;
  for (const ls of Object.values(byCycle)) {
    const heavyDays = ls.filter((l) => l.flow >= 5 || l.symptoms.includes('clots')).length;
    if (heavyDays >= 2) heavyCycles++;
    if (ls.some((l) => l.pain >= 8)) severePainCycles++;
    const lutealBad = ls.filter((l) => l.phase === 'luteal' && l.daysBefore != null && l.daysBefore <= 7
      && (l.mood != null && l.mood <= 2) && l.symptoms.some((s) => ['anxiety', 'irritability', 'low_mood', 'mood_swings'].includes(s))).length;
    const follicularOk = ls.filter((l) => l.phase === 'follicular' && l.mood != null && l.mood >= 3).length;
    if (lutealBad >= 3 && follicularOk >= 2) pmddCycles++;
  }
  if (heavyCycles >= 2) flags.push(flag('heavy_flow', 'consult', 'Possible heavy menstrual bleeding',
    `You logged very heavy flow or large clots on 2+ days in ${heavyCycles} cycles.`,
    'Soaking a pad/tampon every 1–2 hours, clots larger than a coin, or flooding are worth a check-up (fibroids, bleeding disorders and anaemia are treatable).'));
  if (severePainCycles >= 2) flags.push(flag('severe_pain', 'consult', 'Severe period pain',
    `You logged pain of 8/10 or more in ${severePainCycles} cycles.`,
    'Pain that disrupts daily life is not something you have to just live with. Conditions like endometriosis or adenomyosis are under-diagnosed — bring your pain log to a clinician.'));
  if (pmddCycles >= 2 && !conditions.includes('pmdd')) flags.push(flag('pmdd_pattern', 'watch', 'Strong premenstrual mood pattern',
    `In ${pmddCycles} cycles, low mood with anxiety/irritability clustered in the week before your period and eased afterwards.`,
    'This pattern can fit PMDD, which is treatable. If it affects work or relationships, consider sharing your Lunaria report with a clinician.'));

  // Bleeding between periods.
  const between = annotated.filter((l) => (l.flow >= 1 || l.symptoms.includes('spotting'))
    && l.cycleDay != null && l.cycleDay > (cycles.find((c) => c.start === l.cycleStart)?.periodLength ?? 7) + 1
    && (l.daysBefore == null || l.daysBefore > 2)
    && diffDays(l.date, today) <= 180);
  if (between.length >= 2) flags.push(flag('intermenstrual', 'consult', 'Bleeding between periods',
    `You logged bleeding/spotting on ${between.length} days outside your period in the last 6 months.`,
    'Occasional ovulation spotting is common, but recurring bleeding between periods should be checked by a clinician.'));

  if (current) {
    const lastStart = current.start;
    const sinceLast = diffDays(lastStart, today);
    if (sinceLast > 90 && profile?.goal !== 'perimenopause') flags.push(flag('amenorrhea', 'consult', 'No period for 90+ days',
      `It has been ${sinceLast} days since your last logged period.`,
      'If you are not pregnant, missing periods for 3 months warrants a check (stress, low energy availability, PCOS, thyroid). If you just forgot to log, add your periods.'));
    if (current.isLate && current.daysLate >= 5) {
      const fw = current.fertileWindow;
      const unprotected = annotated.some((l) => l.sex === 'unprotected' && l.date >= addDays(fw.start, -2) && l.date <= addDays(fw.end, 1));
      flags.push(flag('late', unprotected ? 'watch' : 'info', `Period ${current.daysLate} days late`,
        unprotected ? 'You logged unprotected sex around your fertile window.' : 'Stress, illness, travel and changes in sleep or training can delay ovulation.',
        unprotected ? 'Consider taking a pregnancy test — accuracy is best from the day your period was due.' : 'If you could be pregnant, a home test is accurate from the day your period was due.'));
    }
  }

  const heavyRecent = annotated.filter((l) => l.flow >= 4 && diffDays(l.date, today) <= 60).length;
  const tired = annotated.filter((l) => (l.symptoms.includes('fatigue') || l.symptoms.includes('dizziness')) && diffDays(l.date, today) <= 60).length;
  if (heavyRecent >= 3 && tired >= 3 && ironIntakeAvg != null && ironIntakeAvg < 12) {
    flags.push(flag('anemia_risk', 'watch', 'Possible iron-deficiency risk',
      `Heavy flow days, frequent fatigue/dizziness and an average iron intake of ${ironIntakeAvg} mg/day.`,
      'This combination is a common route to iron deficiency. Boost iron + vitamin C foods and ask a clinician about a ferritin blood test.'));
  }
  const order = { consult: 0, watch: 1, info: 2 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** A transparent 0–100 wellbeing score with the reasoning for each part. */
function healthScore({ analysis, annotated, today, nutritionDays }) {
  const recent = annotated.filter((l) => diffDays(l.date, today) <= 30 && diffDays(l.date, today) >= 0);
  const parts = [];
  const { stats } = analysis;
  let reg = 15;
  if (stats.cyclesTracked >= 2) reg = stats.sdCycle <= 4 ? 25 : stats.sdCycle <= 7 ? 18 : 10;
  parts.push({ id: 'regularity', label: 'Cycle regularity', score: reg, max: 25, note: stats.cyclesTracked >= 2 ? `±${stats.sdCycle} days variation` : 'Track 2+ cycles to score' });

  const painVals = recent.map((l) => l.pain).filter((x) => typeof x === 'number');
  const avgPain = painVals.length ? mean(painVals) : null;
  const painScore = avgPain == null ? 15 : Math.round(20 * (1 - Math.min(avgPain, 10) / 10));
  parts.push({ id: 'pain', label: 'Pain load', score: painScore, max: 20, note: avgPain == null ? 'No pain logged' : `Avg pain ${fmt(avgPain)}/10` });

  const sleepVals = recent.map((l) => l.sleep_hours).filter((x) => typeof x === 'number');
  const avgSleep = sleepVals.length ? mean(sleepVals) : null;
  const sleepScore = avgSleep == null ? 10 : Math.round(20 * Math.max(0, 1 - Math.abs(Math.min(avgSleep, 9) - 8) / 4));
  parts.push({ id: 'sleep', label: 'Sleep', score: sleepScore, max: 20, note: avgSleep == null ? 'No sleep logged' : `Avg ${fmt(avgSleep)} h` });

  const nutPct = nutritionDays?.length ? mean(nutritionDays) : null;
  const nutScore = nutPct == null ? 8 : Math.round(15 * Math.min(nutPct, 100) / 100);
  parts.push({ id: 'nutrition', label: 'Nutrient coverage', score: nutScore, max: 15, note: nutPct == null ? 'Log meals to score' : `${Math.round(nutPct)}% of key targets` });

  const waterVals = recent.map((l) => l.water_ml).filter((x) => x > 0);
  const avgWater = waterVals.length ? mean(waterVals) : null;
  const waterScore = avgWater == null ? 5 : Math.round(10 * Math.min(avgWater / 2000, 1));
  parts.push({ id: 'hydration', label: 'Hydration', score: waterScore, max: 10, note: avgWater == null ? 'Log water to score' : `Avg ${Math.round(avgWater)} ml` });

  const consistency = Math.min(10, Math.round((recent.length / 30) * 10));
  parts.push({ id: 'tracking', label: 'Tracking consistency', score: consistency, max: 10, note: `${recent.length}/30 days logged` });

  return { score: parts.reduce((a, p) => a + p.score, 0), parts };
}

function flag(id, severity, title, detail, advice) {
  return { id, severity, title, detail, advice };
}
function avgField(ls, field) {
  const vals = ls.map((l) => l[field]).filter((x) => typeof x === 'number');
  return vals.length ? Math.round(mean(vals) * 10) / 10 : null;
}
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function groupBy(xs, key) {
  const out = {};
  for (const x of xs) (out[x[key]] ??= []).push(x);
  return out;
}
function fmt(x) { return Math.round(x * 10) / 10; }
function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function safeArr(s) {
  if (Array.isArray(s)) return s;
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

module.exports = { annotate, symptomPatterns, forecast, curves, correlations, healthFlags, healthScore };
