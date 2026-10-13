'use strict';
// All calendar dates are ISO "YYYY-MM-DD" strings; arithmetic is done in UTC
// so that daylight-saving changes never shift a day.

const DAY_MS = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toUtc(s) {
  return Date.parse(s + 'T00:00:00Z');
}

function addDays(s, n) {
  return new Date(toUtc(s) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
function diffDays(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date + clock time for a timezone at instant `now`. */
function localParts(tz, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: isValidTimeZone(tz) ? tz : 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function todayIn(tz, now) {
  return localParts(tz, now).date;
}

/** "HH:MM" -> minutes after midnight, or null if malformed. */
function parseHm(hm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hm || '');
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

module.exports = { DAY_MS, isIsoDate, addDays, diffDays, isValidTimeZone, localParts, todayIn, parseHm };
