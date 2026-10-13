'use strict';
const { isIsoDate, isValidTimeZone, parseHm } = require('./engine/dates');
const C = require('./engine/constants');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

function date(v, name = 'date') {
  if (!isIsoDate(v)) throw bad(`${name} must be a YYYY-MM-DD date`);
  return v;
}

function optNum(v, name, min, max, { integer = false } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw bad(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
  return n;
}

function optEnum(v, name, values) {
  if (v === undefined || v === null || v === '') return null;
  if (!values.includes(v)) throw bad(`${name} must be one of: ${values.join(', ')}`);
  return v;
}

function hm(v, name) {
  if (parseHm(v) == null) throw bad(`${name} must be HH:MM`);
  return v;
}

function str(v, name, max, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  const s = v.trim();
  if (required && !s) throw bad(`${name} is required`);
  if (s.length > max) throw bad(`${name} must be at most ${max} characters`);
  return s;
}

function dailyLog(body) {
  const symptoms = Array.isArray(body.symptoms) ? [...new Set(body.symptoms)] : [];
  for (const s of symptoms) if (!C.SYMPTOM_IDS.has(s)) throw bad(`Unknown symptom: ${s}`);
  let bbt = optNum(body.bbt, 'bbt', 34, 108);
  if (bbt != null && bbt > 45) bbt = Math.round(((bbt - 32) * 5 / 9) * 100) / 100; // accept °F
  if (bbt != null && (bbt < 34 || bbt > 42)) throw bad('bbt is out of range');
  return {
    flow: optNum(body.flow, 'flow', 0, 5, { integer: true }),
    symptoms,
    mood: optNum(body.mood, 'mood', 1, 5, { integer: true }),
    energy: optNum(body.energy, 'energy', 1, 5, { integer: true }),
    pain: optNum(body.pain, 'pain', 0, 10, { integer: true }),
    stress: optNum(body.stress, 'stress', 1, 5, { integer: true }),
    sleep_hours: optNum(body.sleep_hours, 'sleep_hours', 0, 24),
    water_ml: optNum(body.water_ml, 'water_ml', 0, 10000, { integer: true }) ?? 0,
    exercise_min: optNum(body.exercise_min, 'exercise_min', 0, 1440, { integer: true }),
    bbt,
    lh: optEnum(body.lh, 'lh', C.LH_VALUES),
    mucus: optEnum(body.mucus, 'mucus', C.MUCUS_VALUES),
    sex: optEnum(body.sex, 'sex', C.SEX_VALUES),
    notes: str(body.notes, 'notes', 2000),
  };
}

function profile(body) {
  const out = {};
  if (body.birth_year !== undefined) out.birth_year = optNum(body.birth_year, 'birth_year', 1900, new Date().getFullYear() - 8, { integer: true });
  if (body.goal !== undefined) out.goal = optEnum(body.goal, 'goal', C.GOALS) || 'track';
  if (body.diet !== undefined) out.diet = optEnum(body.diet, 'diet', C.DIETS) || 'omnivore';
  if (body.conditions !== undefined) {
    if (!Array.isArray(body.conditions) || body.conditions.some((c) => !C.CONDITIONS.includes(c))) throw bad('Invalid conditions');
    out.conditions = JSON.stringify([...new Set(body.conditions)]);
  }
  if (body.cycle_length !== undefined) out.cycle_length = optNum(body.cycle_length, 'cycle_length', 15, 90, { integer: true }) ?? 28;
  if (body.period_length !== undefined) out.period_length = optNum(body.period_length, 'period_length', 1, 15, { integer: true }) ?? 5;
  if (body.luteal_length !== undefined) out.luteal_length = optNum(body.luteal_length, 'luteal_length', 7, 20, { integer: true }) ?? 14;
  if (body.temp_unit !== undefined) out.temp_unit = optEnum(body.temp_unit, 'temp_unit', ['C', 'F']) || 'C';
  if (body.timezone !== undefined) {
    if (!isValidTimeZone(body.timezone)) throw bad('Unknown timezone');
    out.timezone = body.timezone;
  }
  if (body.onboarded !== undefined) out.onboarded = body.onboarded ? 1 : 0;
  return out;
}

const PREF_BOOLS = ['period_upcoming', 'period_late', 'fertility', 'daily_log', 'hydration', 'medications', 'phase_tips', 'forecasts', 'nutrition', 'health_alerts', 'bbt_reminder', 'discreet'];
function prefs(body) {
  const out = {};
  for (const k of PREF_BOOLS) if (body[k] !== undefined) out[k] = body[k] ? 1 : 0;
  if (body.period_days_before !== undefined) out.period_days_before = optNum(body.period_days_before, 'period_days_before', 1, 7, { integer: true }) ?? 2;
  for (const k of ['daily_log_time', 'bbt_time', 'quiet_start', 'quiet_end']) if (body[k] !== undefined) out[k] = hm(body[k], k);
  return out;
}

module.exports = { HttpError, bad, date, optNum, optEnum, hm, str, dailyLog, profile, prefs };
