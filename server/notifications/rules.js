'use strict';
// Notification rules: which nudges a user should get right now, as a pure
// function of their data and the clock. Shared by the server scheduler and
// the single-file phone build.
const { forecast, healthFlags } = require('../engine/insights');
const { PHASES } = require('../engine/phases');
const { totalsFor } = require('../engine/nutrition');
const { addDays, localParts, parseHm } = require('../engine/dates');
const { phaseFor } = require('../engine/cycle');

const DEFAULT_PREFS = {
  period_upcoming: 1, period_days_before: 2, period_late: 1, fertility: 1, daily_log: 1,
  daily_log_time: '20:00', hydration: 1, medications: 1, phase_tips: 1, forecasts: 1,
  nutrition: 1, health_alerts: 1, bbt_reminder: 0, bbt_time: '06:30',
  quiet_start: '22:00', quiet_end: '07:00', discreet: 0,
};

function inQuietHours(minutes, start, end) {
  const s = parseHm(start), e = parseHm(end);
  if (s == null || e == null || s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** True once the local clock has reached hh:mm today (within the same day). */
const reached = (minutes, hm) => minutes >= parseHm(hm);

/** Storage-independent decision logic (also used by the phone build). */
function decideNotifications({ profile, today, analysis, annotated, now, prefs: prefsRow, todayFoods, untakenMeds, ironAvg }) {
  if (!profile?.onboarded) return [];
  const prefs = { ...DEFAULT_PREFS, ...(prefsRow || {}) };
  const { hour, minute } = localParts(profile.timezone, now);
  const mins = hour * 60 + minute;
  const out = [];
  const add = (type, key, title, body, link = '/') => out.push({ type, dedupe_key: key, title, body, link });
  const discreet = Boolean(prefs.discreet);
  const cur = analysis.current;
  const todayLog = annotated.find((l) => l.date === today);

  if (cur) {
    if (prefs.period_upcoming && !cur.isLate && cur.daysUntilNext > 0 && cur.daysUntilNext <= prefs.period_days_before && reached(mins, '09:00')) {
      add('period', `period_soon:${cur.nextStart}`,
        discreet ? 'Heads up from Lunaria' : `Period expected in ${cur.daysUntilNext} day${cur.daysUntilNext > 1 ? 's' : ''}`,
        discreet ? 'Open the app for your cycle update.' : 'Pack supplies, front-load iron-rich meals and plan some lighter evenings.', '/');
    }
    if (prefs.period_upcoming && cur.daysUntilNext === 0 && reached(mins, '08:00')) {
      add('period', `period_due:${cur.nextStart}`, discreet ? 'Cycle update' : 'Your period may start today',
        discreet ? 'Open Lunaria for details.' : 'Log it with one tap when it arrives — it sharpens next month’s prediction.', '/log');
    }
    if (prefs.period_late && cur.isLate && [2, 5, 10].includes(cur.daysLate) && reached(mins, '10:00')) {
      add('period', `period_late:${cur.nextStart}:${cur.daysLate}`, discreet ? 'Cycle update' : `Period ${cur.daysLate} days late`,
        discreet ? 'Open Lunaria for details.' : 'Forgot to log it? Add it now. Stress, travel and illness can also delay ovulation.', '/log');
    }
    const fertilityRelevant = profile.goal === 'conceive' || profile.goal === 'avoid' || prefs.fertility;
    if (fertilityRelevant && prefs.fertility && today === cur.fertileWindow.start && reached(mins, '08:00')) {
      const body = profile.goal === 'avoid'
        ? 'High-fertility days begin. Predictions are not contraception — use protection.'
        : profile.goal === 'conceive' ? 'Your fertile window opens today — start LH tests and watch for egg-white mucus.' : 'Your estimated fertile window starts today.';
      add('fertility', `fertile_start:${cur.fertileWindow.start}`, discreet ? 'Cycle update' : 'Fertile window starting', discreet ? 'Open Lunaria for details.' : body, '/');
    }
    if (fertilityRelevant && prefs.fertility && today === cur.ovulation.date && reached(mins, '08:00')) {
      add('fertility', `ovulation:${cur.ovulation.date}`, discreet ? 'Cycle update' : 'Estimated ovulation day',
        discreet ? 'Open Lunaria for details.' : 'Energy and confidence often peak now — great day for big conversations.', '/');
    }

    // Phase-change coaching.
    const yesterdayPhase = phaseOn(analysis, addDays(today, -1));
    if (prefs.phase_tips && cur.phase && yesterdayPhase && yesterdayPhase !== cur.phase && reached(mins, '08:30')) {
      const p = PHASES[cur.phase];
      add('phase', `phase:${cur.start}:${cur.phase}`, `${p.emoji} Entering your ${p.name.toLowerCase()} phase`,
        `${p.feel} Focus on ${p.nutrition.focus.slice(0, 3).join(', ').toLowerCase()}; movement: ${p.movement.intensity.toLowerCase()} intensity.`, '/');
    }

    // Personal symptom forecast for tomorrow, sent in the evening.
    if (prefs.forecasts && reached(mins, '18:00')) {
      const [, tomorrow] = forecast(analysis, annotated, today, 2);
      const top = tomorrow?.symptoms?.[0];
      if (top && top.probability >= 60) {
        add('forecast', `forecast:${tomorrow.date}`, `${top.label} likely tomorrow (${top.probability}%)`,
          top.relief ? `Based on your past cycles. Tip: ${top.relief}` : 'Based on your past cycles — plan a gentler day.', '/insights');
      }
    }
  }

  if (prefs.daily_log && !todayLog && reached(mins, prefs.daily_log_time)) {
    add('reminder', `log:${today}`, 'How are you feeling today?', '30-second check-in: mood, energy, symptoms. Your forecasts get smarter with every log.', '/log');
  }
  if (prefs.bbt_reminder && reached(mins, prefs.bbt_time) && !(todayLog && todayLog.bbt)) {
    add('reminder', `bbt:${today}`, 'Take your temperature', 'Measure BBT before getting out of bed for an accurate reading.', '/log');
  }

  if (prefs.hydration) {
    const water = todayLog?.water_ml || 0;
    const goal = cur?.inPeriod ? 2500 : 2000;
    for (const [h, frac] of [[11, 0.25], [15, 0.5], [18, 0.75]]) {
      if (hour >= h && hour < h + 2 && water < goal * frac) {
        add('hydration', `water:${today}:${h}`, '💧 Hydration check', `You've logged ${water} ml of your ${goal} ml goal. ${cur?.phase === 'luteal' ? 'Water helps with luteal bloating.' : 'Even mild dehydration can worsen cramps and headaches.'}`, '/log');
        break;
      }
    }
  }

  if (prefs.nutrition && cur?.inPeriod && reached(mins, '17:00')) {
    const iron = totalsFor(todayFoods).iron;
    if (iron < 9) {
      add('nutrition', `iron:${today}`, 'Iron top-up for dinner?', `You're at ${iron} mg iron today. Lentils, spinach, tofu or lean red meat + a vitamin C source would help replace what you lose.`, '/nutrition');
    }
  }

  if (prefs.medications) {
    for (const m of untakenMeds) {
      if (reached(mins, m.time)) {
        add('medication', `med:${m.id}:${today}`, `Time for ${m.name}`, m.dose ? `Dose: ${m.dose}. Tap to mark as taken.` : 'Tap to mark as taken.', '/notifications');
      }
    }
  }

  if (prefs.health_alerts) {
    const flags = healthFlags({ analysis, annotated, today, profile, ironIntakeAvg: ironAvg });
    for (const f of flags.filter((x) => x.severity !== 'info')) {
      // At most once per flag per cycle.
      add('health', `flag:${f.id}:${cur?.start || 'none'}`, f.title, f.advice, '/insights');
    }
  }

  // Health alerts and medication reminders still break through quiet hours.
  const quiet = inQuietHours(mins, prefs.quiet_start, prefs.quiet_end);
  return out.filter((n) => !quiet || n.type === 'medication');
}

function phaseOn(analysis, date) {
  const { cycles } = analysis;
  const cyc = [...cycles].reverse().find((c) => c.start <= date && (!c.end || date <= c.end));
  return cyc ? phaseFor(date, cyc) : null;
}

module.exports = { decideNotifications, inQuietHours, DEFAULT_PREFS };
