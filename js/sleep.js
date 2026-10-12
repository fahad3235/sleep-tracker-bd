/*
 * sleep-tracker-bd — pure sleep math and data logic.
 * No DOM, no localStorage, no Date.now() inside logic functions.
 * Shared by the browser app (via window.SleepLogic) and the Node unit tests.
 */
'use strict';

var BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/** "23:30" -> 1410. Returns NaN for anything that is not HH:MM. */
function toMinutes(hhmm) {
  if (typeof hhmm !== 'string') return NaN;
  var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  var h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return NaN;
  return h * 60 + mi;
}

/**
 * True when the wake time is EARLIER than bedtime, i.e. the sleep crosses
 * midnight and the wake moment belongs to the NEXT calendar day.
 * Equal times do not cross midnight (they are a zero-length, invalid entry).
 */
function crossesMidnight(bedtime, wake) {
  return toMinutes(wake) < toMinutes(bedtime);
}

/**
 * Sleep duration in whole minutes.
 * If wake < bedtime the wake moment is treated as next-day morning
 * (e.g. 23:30 -> 06:30 = 420). If wake === bedtime the result is 0.
 * Returns NaN when either input is not a valid HH:MM.
 */
function durationMinutes(bedtime, wake) {
  var b = toMinutes(bedtime), w = toMinutes(wake);
  if (Number.isNaN(b) || Number.isNaN(w)) return NaN;
  if (w === b) return 0;
  return w > b ? w - b : (w - b) + 1440;
}

/** Convert Latin digits in a string to Bengali digits. Non-digits untouched. */
function bnDigits(s) {
  return String(s).replace(/[0-9]/g, function (d) { return BN_DIGITS[+d]; });
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** 420 -> "7h 00m"; with useBn -> "৭h ০০m" (units stay Latin per factory convention). */
function formatDuration(min, useBn) {
  var h = Math.floor(min / 60), m = min % 60;
  var s = h + 'h ' + pad2(m) + 'm';
  return useBn ? bnDigits(s) : s;
}

/** "7h 00m" short label used in the chart; same digit convention. */
function formatDurationShort(min, useBn) {
  var h = Math.floor(min / 60), m = min % 60;
  var s = m === 0 ? h + 'h' : h + 'h' + pad2(m);
  return useBn ? bnDigits(s) : s;
}

/** Local YYYY-MM-DD for a Date object (no UTC shifting). */
function dateToISO(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** Shift a YYYY-MM-DD by n days, returning YYYY-MM-DD. */
function isoAddDays(iso, n) {
  var p = iso.split('-');
  var d = new Date(+p[0], +p[1] - 1, +p[2]);
  d.setDate(d.getDate() + n);
  return dateToISO(d);
}

/**
 * Entries whose bedtime date falls in the trailing `days` calendar days
 * ending at `asof` (inclusive on both ends). Entries are plain objects with
 * at least {date: 'YYYY-MM-DD', bedtime, wake, quality}.
 */
function entriesInWindow(entries, days, asof) {
  var start = isoAddDays(asof, -(days - 1));
  return entries.filter(function (e) {
    return e.date >= start && e.date <= asof;
  });
}

/**
 * Aggregate stats for a list of entries (each needs durationMin + quality).
 * Returns:
 *   count, avgMin, avgQuality, sdMin (population std-dev, minutes),
 *   minMin, maxMin. avgMin/avgQuality are null when no data; sdMin is
 *   null when fewer than 2 entries.
 */
function stats(list) {
  var out = { count: list.length, avgMin: null, avgQuality: null, sdMin: null, minMin: null, maxMin: null };
  if (list.length === 0) return out;
  var sum = 0, qSum = 0, qN = 0, min = Infinity, max = -Infinity;
  list.forEach(function (e) {
    sum += e.durationMin;
    if (e.durationMin < min) min = e.durationMin;
    if (e.durationMin > max) max = e.durationMin;
    if (typeof e.quality === 'number' && e.quality >= 1 && e.quality <= 5) {
      qSum += e.quality; qN += 1;
    }
  });
  out.avgMin = sum / list.length;
  out.avgQuality = qN > 0 ? qSum / qN : null;
  out.minMin = min; out.maxMin = max;
  if (list.length >= 2) {
    var mean = out.avgMin, acc = 0;
    list.forEach(function (e) { acc += Math.pow(e.durationMin - mean, 2); });
    out.sdMin = Math.sqrt(acc / list.length);
  }
  return out;
}

/**
 * Build the per-night data for the bar chart: one slot per calendar day for
 * the trailing `nights` days ending at `asof`. A slot with no entry has
 * minutes === null. Result is chronological (oldest first).
 */
function chartData(entries, nights, asof) {
  var byDate = {};
  entries.forEach(function (e) {
    var m = durationMinutes(e.bedtime, e.wake);
    byDate[e.date] = Number.isNaN(m) ? null : m;
  });
  var out = [];
  for (var i = nights - 1; i >= 0; i--) {
    var iso = isoAddDays(asof, -i);
    out.push({ date: iso, minutes: byDate.hasOwnProperty(iso) ? byDate[iso] : null });
  }
  return out;
}

/**
 * Validate a new/edited entry. Returns an array of error codes:
 *  'bad-date' | 'bad-bedtime' | 'bad-wake' | 'zero-duration' | 'bad-quality'
 * NOTE: wake EARLIER than bedtime is NOT an error — it is treated as a
 * next-day wake (crossing midnight), which durationMinutes() handles.
 */
function validateEntry(e) {
  var errs = [];
  if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) errs.push('bad-date');
  if (Number.isNaN(toMinutes(e.bedtime))) errs.push('bad-bedtime');
  if (Number.isNaN(toMinutes(e.wake))) errs.push('bad-wake');
  if (!Number.isNaN(toMinutes(e.bedtime)) && !Number.isNaN(toMinutes(e.wake)) && toMinutes(e.bedtime) === toMinutes(e.wake)) errs.push('zero-duration');
  if (!(typeof e.quality === 'number' && e.quality >= 1 && e.quality <= 5)) errs.push('bad-quality');
  return errs;
}

/** Normalize an entry object (used before save). */
function normalizeEntry(e) {
  return {
    id: String(e.id),
    date: String(e.date),
    bedtime: String(e.bedtime),
    wake: String(e.wake),
    quality: +e.quality,
    note: typeof e.note === 'string' ? e.note.slice(0, 500) : '',
    updatedAt: e.updatedAt || null
  };
}

/** Build the JSON export envelope. */
function buildExport(entries) {
  return { app: 'sleep-tracker-bd', version: 1, exportedAt: new Date().toISOString(), entries: entries.map(normalizeEntry) };
}

/**
 * Parse an imported JSON string. Returns {ok:true, entries:[...]} or
 * {ok:false, error:'malformed'|'bad-schema'|'no-entries'}. Never throws.
 */
function parseImport(text) {
  var data;
  try { data = JSON.parse(text); } catch (err) { return { ok: false, error: 'malformed' }; }
  if (!data || typeof data !== 'object') return { ok: false, error: 'bad-schema' };
  if (!Array.isArray(data.entries)) return { ok: false, error: 'no-entries' };
  var good = [];
  for (var i = 0; i < data.entries.length; i++) {
    var e = data.entries[i];
    if (!e || typeof e !== 'object') return { ok: false, error: 'bad-schema' };
    if (typeof e.id !== 'string' || validateEntry(e).length > 0) return { ok: false, error: 'bad-schema' };
    good.push(normalizeEntry(e));
  }
  return { ok: true, entries: good };
}

/* ---- exports for both environments ---- */
var SleepLogic = {
  toMinutes: toMinutes,
  crossesMidnight: crossesMidnight,
  durationMinutes: durationMinutes,
  bnDigits: bnDigits,
  formatDuration: formatDuration,
  formatDurationShort: formatDurationShort,
  dateToISO: dateToISO,
  isoAddDays: isoAddDays,
  entriesInWindow: entriesInWindow,
  stats: stats,
  chartData: chartData,
  validateEntry: validateEntry,
  normalizeEntry: normalizeEntry,
  buildExport: buildExport,
  parseImport: parseImport
};

if (typeof module !== 'undefined' && module.exports) module.exports = SleepLogic;
if (typeof window !== 'undefined') window.SleepLogic = SleepLogic;
