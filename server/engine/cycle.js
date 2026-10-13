'use strict';
const { addDays, diffDays } = require('./dates');

// Cycle lengths outside this range are almost certainly missed logs or
// anovulatory outliers; they are reported but excluded from averages.
const MIN_VALID_CYCLE = 15;
const MAX_VALID_CYCLE = 90;
const RECENT_CYCLES = 6;
const BBT_SHIFT_C = 0.2;

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function stdDev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Recency-weighted mean: the most recent cycle counts most. */
function weightedMean(xs) {
  if (!xs.length) return null;
  let num = 0, den = 0;
  xs.forEach((x, i) => { const w = i + 1; num += x * w; den += w; });
  return num / den;
}

function logsByDate(logs) {
  const map = new Map();
  for (const l of logs || []) map.set(l.date, l);
  return map;
}

/**
 * Detect ovulation inside [start, end] from fertility signs.
 * Priority: BBT thermal shift (confirms ovulation after the fact) >
 * LH surge (predicts ovulation ~1 day later) > peak cervical mucus.
 */
function detectOvulation(start, end, byDate) {
  const temps = [];
  let lhDay = null;
  let lastEggWhite = null;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const log = byDate.get(d);
    if (!log) continue;
    if (typeof log.bbt === 'number' && log.bbt > 30 && log.bbt < 45) temps.push({ date: d, t: log.bbt });
    if (!lhDay && (log.lh === 'peak' || log.lh === 'positive')) lhDay = d;
    if (log.mucus === 'eggwhite') lastEggWhite = d;
  }

  // "Three over six" rule: three consecutive readings above the highest of
  // the previous six, the third at least 0.2°C above that coverline.
  for (let i = 6; i + 2 < temps.length; i++) {
    const coverline = Math.max(...temps.slice(i - 6, i).map((x) => x.t));
    const [a, b, c] = temps.slice(i, i + 3);
    if (a.t > coverline && b.t > coverline && c.t >= coverline + BBT_SHIFT_C) {
      return { date: addDays(a.date, -1), method: 'bbt', confirmed: true, coverline };
    }
  }
  if (lhDay) return { date: addDays(lhDay, 1), method: 'lh', confirmed: true };
  if (lastEggWhite) return { date: lastEggWhite, method: 'mucus', confirmed: false };
  return null;
}

function phaseFor(date, cycle) {
  const day = diffDays(cycle.start, date) + 1;
  if (day < 1) return null;
  if (day <= cycle.periodLength) return 'menstrual';
  if (cycle.ovulation) {
    const rel = diffDays(cycle.ovulation, date);
    if (rel >= -1 && rel <= 1) return 'ovulatory';
    return rel < -1 ? 'follicular' : 'luteal';
  }
  return 'follicular';
}

/**
 * Core analysis. `periods` are {start_date, end_date|null}; `logs` are daily
 * logs; `profile` supplies fallback averages for new users.
 */
function analyzeCycles({ periods, logs, profile, today }) {
  const byDate = logsByDate(logs);
  const sorted = [...(periods || [])].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const defaults = {
    cycle: profile?.cycle_length || 28,
    period: profile?.period_length || 5,
    luteal: profile?.luteal_length || 14,
  };

  // Period lengths from logged ends (or the run of flow days when no end).
  const periodLength = (p, nextStart) => {
    if (p.end_date) return diffDays(p.start_date, p.end_date) + 1;
    let len = 0;
    for (let d = p.start_date; len < 12; d = addDays(d, 1)) {
      if (nextStart && d >= nextStart) break;
      const l = byDate.get(d);
      if (l && l.flow >= 2) len = diffDays(p.start_date, d) + 1;
      else if (diffDays(p.start_date, d) > len + 1) break;
    }
    return len || null;
  };

  const cycles = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const next = sorted[i + 1];
    const c = {
      start: p.start_date,
      end: next ? addDays(next.start_date, -1) : null,
      length: next ? diffDays(p.start_date, next.start_date) : null,
      periodLength: periodLength(p, next?.start_date),
      periodEnd: p.end_date || null,
      complete: Boolean(next),
    };
    c.valid = c.length == null || (c.length >= MIN_VALID_CYCLE && c.length <= MAX_VALID_CYCLE);
    const detectEnd = c.end || today;
    c.ovulation = null;
    c.ovulationMethod = null;
    const ov = detectOvulation(c.start, detectEnd, byDate);
    if (ov) {
      c.ovulation = ov.date;
      c.ovulationMethod = ov.method;
      c.ovulationConfirmed = ov.confirmed;
      if (c.complete) c.lutealLength = diffDays(ov.date, next.start_date);
    }
    cycles.push(c);
  }

  const complete = cycles.filter((c) => c.complete && c.valid);
  const recent = complete.slice(-RECENT_CYCLES).map((c) => c.length);
  const avgCycle = recent.length ? weightedMean(recent) : defaults.cycle;
  const sdCycle = stdDev(recent);
  const periodLens = cycles
    .filter((c) => c.complete || c.periodEnd)
    .map((c) => c.periodLength).filter((x) => x && x <= 15).slice(-RECENT_CYCLES);
  const avgPeriod = periodLens.length ? mean(periodLens) : defaults.period;
  const lutealObs = complete
    .filter((c) => c.ovulationConfirmed && c.lutealLength >= 8 && c.lutealLength <= 18)
    .map((c) => c.lutealLength);
  const luteal = lutealObs.length ? mean(lutealObs) : defaults.luteal;

  let regularity = 'unknown';
  if (recent.length >= 2) {
    if (sdCycle <= 2) regularity = 'very regular';
    else if (sdCycle <= 4) regularity = 'regular';
    else if (sdCycle <= 7) regularity = 'somewhat irregular';
    else regularity = 'irregular';
  }
  let confidence = 'low';
  if (recent.length >= 6 && sdCycle <= 3) confidence = 'high';
  else if (recent.length >= 3 && sdCycle <= 6) confidence = 'medium';

  const stats = {
    cyclesTracked: complete.length,
    avgCycle: round1(avgCycle),
    sdCycle: round1(sdCycle),
    minCycle: recent.length ? Math.min(...recent) : null,
    maxCycle: recent.length ? Math.max(...recent) : null,
    avgPeriod: round1(avgPeriod),
    lutealLength: round1(luteal),
    lutealPersonalized: lutealObs.length > 0,
    regularity,
    confidence,
    outliers: cycles.filter((c) => !c.valid).map((c) => ({ start: c.start, length: c.length })),
  };

  // Round once so every downstream date is consistent.
  const cycleLen = Math.round(avgCycle);
  const lutealLen = Math.round(luteal);
  const periodLen = Math.max(1, Math.round(avgPeriod));
  for (const c of cycles) {
    if (!c.periodLength) c.periodLength = periodLen;
    if (!c.ovulation && c.complete) {
      c.ovulation = addDays(c.start, Math.max(c.length - lutealLen, periodLen));
      c.ovulationMethod = 'estimated';
      c.ovulationConfirmed = false;
    }
  }

  const last = cycles[cycles.length - 1];
  // An open period without an end date is assumed to run its usual length.
  if (last && !last.periodEnd) last.periodLength = Math.max(last.periodLength, periodLen);
  let current = null;
  const predictions = [];
  if (last && last.start <= today) {
    let nextStart;
    let windowDays;
    if (last.ovulation && last.ovulationConfirmed) {
      // A confirmed ovulation pins the period to the (stable) luteal phase.
      nextStart = addDays(last.ovulation, lutealLen);
      windowDays = 1;
    } else {
      nextStart = addDays(last.start, cycleLen);
      windowDays = Math.min(7, Math.max(1, Math.ceil(sdCycle || (recent.length ? 1 : 3))));
      last.ovulation = addDays(nextStart, -lutealLen);
      last.ovulationMethod = 'estimated';
      last.ovulationConfirmed = false;
    }
    if (diffDays(last.start, last.ovulation) < periodLen) {
      last.ovulation = addDays(last.start, periodLen);
    }
    const cycleDay = diffDays(last.start, today) + 1;
    const daysUntilNext = diffDays(today, nextStart);
    const isLate = daysUntilNext < 0;
    const fertileStart = addDays(last.ovulation, -5);
    const fertileEnd = addDays(last.ovulation, 1);
    const inPeriod = last.periodEnd ? today <= last.periodEnd : cycleDay <= last.periodLength;
    current = {
      start: last.start,
      cycleDay,
      phase: phaseFor(today, last),
      inPeriod,
      periodLength: last.periodLength,
      nextStart,
      nextWindow: [addDays(nextStart, -windowDays), addDays(nextStart, windowDays)],
      daysUntilNext,
      isLate,
      daysLate: isLate ? -daysUntilNext : 0,
      ovulation: { date: last.ovulation, method: last.ovulationMethod, confirmed: Boolean(last.ovulationConfirmed) },
      fertileWindow: { start: fertileStart, end: fertileEnd },
      inFertileWindow: today >= fertileStart && today <= fertileEnd,
      fertility: fertilityLevel(today, last.ovulation),
    };

    // Project the next three cycles.
    let s = isLate ? addDays(today, 1) : nextStart;
    for (let k = 0; k < 3; k++) {
      const ov = addDays(s, Math.max(cycleLen - lutealLen, periodLen));
      predictions.push({
        start: s,
        end: addDays(s, periodLen - 1),
        ovulation: ov,
        fertileStart: addDays(ov, -5),
        fertileEnd: addDays(ov, 1),
      });
      s = addDays(s, cycleLen);
    }
  }

  return { cycles, stats, current, predictions };
}

/** Relative chance of conception for a day, by distance to ovulation. */
function fertilityLevel(date, ovulation) {
  if (!ovulation) return 'unknown';
  const rel = diffDays(ovulation, date);
  if (rel === -2 || rel === -1 || rel === 0) return 'peak';
  if (rel >= -5 && rel <= 1) return 'high';
  if (rel >= -7 && rel <= 2) return 'medium';
  return 'low';
}

/**
 * Per-day calendar markers across [from, to] combining logged periods,
 * logged/estimated ovulation and future predictions.
 */
function calendar(analysis, logs, from, to) {
  const byDate = logsByDate(logs);
  const days = [];
  const { cycles, predictions, current } = analysis;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = { date: d, period: null, fertile: false, ovulation: false, phase: null, logged: byDate.has(d) };
    const log = byDate.get(d);
    if (log && log.flow >= 2) day.period = 'logged';
    if (log && log.flow === 1) day.spotting = true;

    const cyc = [...cycles].reverse().find((c) => c.start <= d && (!c.end || d <= c.end));
    const inCurrent = current && cyc && cyc.start === current.start;
    if (cyc && (cyc.complete || inCurrent) && !(inCurrent && d >= current.nextStart && !current.isLate)) {
      const dayN = diffDays(cyc.start, d) + 1;
      const pEnd = cyc.periodEnd || addDays(cyc.start, cyc.periodLength - 1);
      if (d <= pEnd && !day.period) day.period = 'logged';
      if (cyc.ovulation) {
        const rel = diffDays(cyc.ovulation, d);
        day.ovulation = rel === 0;
        day.fertile = rel >= -5 && rel <= 1;
        day.ovulationMethod = rel === 0 ? cyc.ovulationMethod : undefined;
      }
      day.phase = phaseFor(d, cyc);
      day.cycleDay = dayN;
    }
    if (current && d >= current.nextStart) {
      for (let i = predictions.length - 1; i >= 0; i--) {
        const p = predictions[i];
        if (d >= p.start) {
          const next = predictions[i + 1];
          if (next && d >= next.start) break;
          if (d <= p.end && !day.period) day.period = 'predicted';
          const rel = diffDays(p.ovulation, d);
          day.ovulation = rel === 0;
          day.fertile = rel >= -5 && rel <= 1;
          day.predicted = true;
          day.cycleDay = diffDays(p.start, d) + 1;
          day.phase = d <= p.end ? 'menstrual' : rel < -1 ? 'follicular' : rel <= 1 ? 'ovulatory' : 'luteal';
          break;
        }
      }
    }
    days.push(day);
  }
  return days;
}

function round1(x) {
  return x == null ? null : Math.round(x * 10) / 10;
}

module.exports = { analyzeCycles, detectOvulation, phaseFor, fertilityLevel, calendar, mean, stdDev };
