/*
 * sleep-tracker-bd — Node unit tests for js/sleep.js (pure logic, no DOM).
 * Run: node tests/unit.test.js
 */
'use strict';
const assert = require('node:assert');
const L = require('../js/sleep.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

console.log('sleep-tracker-bd unit tests\n');

/* --- duration math --- */
check('midnight crossing 23:30 -> 06:30 = 420 min', () =>
  assert.strictEqual(L.durationMinutes('23:30', '06:30'), 420));
check('same-day 01:00 -> 07:00 = 360 min', () =>
  assert.strictEqual(L.durationMinutes('01:00', '07:00'), 360));
check('same-day 22:00 -> 23:30 = 90 min', () =>
  assert.strictEqual(L.durationMinutes('22:00', '23:30'), 90));
check('late evening 21:00 -> 05:00 = 480 min (next day rule)', () =>
  assert.strictEqual(L.durationMinutes('21:00', '05:00'), 480));
check('crossesMidnight true for 23:30 -> 06:30', () =>
  assert.strictEqual(L.crossesMidnight('23:30', '06:30'), true));
check('crossesMidnight false for 01:00 -> 07:00', () =>
  assert.strictEqual(L.crossesMidnight('01:00', '07:00'), false));
check('equal times -> 0 min', () =>
  assert.strictEqual(L.durationMinutes('22:00', '22:00'), 0));
check('equal times do NOT count as midnight crossing', () =>
  assert.strictEqual(L.crossesMidnight('22:00', '22:00'), false));
check('invalid input -> NaN', () =>
  assert.ok(Number.isNaN(L.durationMinutes('25:00', '06:30'))));
check('toMinutes rejects bad values', () => {
  assert.ok(Number.isNaN(L.toMinutes('12:60')));
  assert.ok(Number.isNaN(L.toMinutes('abc')));
  assert.ok(Number.isNaN(L.toMinutes('')));
  assert.strictEqual(L.toMinutes('09:05'), 545);
});
check('00:10 -> 00:20 (early morning same day) = 10 min', () =>
  assert.strictEqual(L.durationMinutes('00:10', '00:20'), 10));

/* --- validation --- */
check('validateEntry flags zero-duration for equal times', () =>
  assert.ok(L.validateEntry({ date: '2026-10-11', bedtime: '22:00', wake: '22:00', quality: 3 }).includes('zero-duration')));
check('validateEntry accepts wake < bedtime (next-day rule, no error)', () =>
  assert.deepStrictEqual(L.validateEntry({ date: '2026-10-11', bedtime: '23:30', wake: '06:30', quality: 4 }), []));
check('validateEntry flags bad quality', () => {
  assert.ok(L.validateEntry({ date: '2026-10-11', bedtime: '23:00', wake: '06:00', quality: 0 }).includes('bad-quality'));
  assert.ok(L.validateEntry({ date: '2026-10-11', bedtime: '23:00', wake: '06:00', quality: 6 }).includes('bad-quality'));
});
check('validateEntry flags bad date/times', () => {
  const e = L.validateEntry({ date: 'nope', bedtime: 'xx', wake: 'yy', quality: 3 });
  assert.ok(e.includes('bad-date') && e.includes('bad-bedtime') && e.includes('bad-wake'));
});

/* --- formatting --- */
check('formatDuration 420 EN = "7h 00m"', () =>
  assert.strictEqual(L.formatDuration(420, false), '7h 00m'));
check('formatDuration 420 BN = Bengali digits', () =>
  assert.strictEqual(L.formatDuration(420, true), '৭h ০০m'));
check('formatDuration 90 EN = "1h 30m"', () =>
  assert.strictEqual(L.formatDuration(90, false), '1h 30m'));
check('bnDigits leaves non-digits untouched', () =>
  assert.strictEqual(L.bnDigits('abc 123'), 'abc ১২৩'));

/* --- date helpers --- */
check('isoAddDays crosses month boundary', () =>
  assert.strictEqual(L.isoAddDays('2026-10-01', -1), '2026-09-30'));
check('isoAddDays crosses year boundary', () =>
  assert.strictEqual(L.isoAddDays('2026-01-01', -1), '2025-12-31'));

/* --- stats aggregation --- */
const fixture = [
  { durationMin: 420, quality: 4 },
  { durationMin: 480, quality: 5 },
  { durationMin: 360, quality: 3 }
];
check('stats avg duration = 420', () => assert.ok(approx(L.stats(fixture).avgMin, 420)));
check('stats avg quality = 4.0', () => assert.ok(approx(L.stats(fixture).avgQuality, 4.0)));
check('stats population std-dev = sqrt(2400)', () =>
  assert.ok(approx(L.stats(fixture).sdMin, Math.sqrt(2400))));
check('stats min/max', () => {
  const s = L.stats(fixture);
  assert.strictEqual(s.minMin, 360); assert.strictEqual(s.maxMin, 480); assert.strictEqual(s.count, 3);
});
check('stats empty -> nulls', () => {
  const s = L.stats([]);
  assert.strictEqual(s.count, 0); assert.strictEqual(s.avgMin, null);
  assert.strictEqual(s.avgQuality, null); assert.strictEqual(s.sdMin, null);
});
check('stats single entry -> sdMin null', () =>
  assert.strictEqual(L.stats([{ durationMin: 400, quality: 4 }]).sdMin, null));

/* --- windows & chart data --- */
const dated = [
  { date: '2026-10-11', bedtime: '23:30', wake: '06:30', quality: 4 },
  { date: '2026-10-05', bedtime: '23:00', wake: '06:00', quality: 3 },
  { date: '2026-10-04', bedtime: '22:00', wake: '05:00', quality: 5 }
];
check('entriesInWindow 7-day covers Oct 06..12 from asof Oct 12', () => {
  const w = L.entriesInWindow(dated, 7, '2026-10-12');
  assert.strictEqual(w.length, 1); // only 2026-10-11; Oct 05 is outside
  assert.strictEqual(w[0].date, '2026-10-11');
});
check('entriesInWindow 30-day keeps all three', () =>
  assert.strictEqual(L.entriesInWindow(dated, 30, '2026-10-12').length, 3));
check('chartData 7 nights chronological, missing -> null', () => {
  const c = L.chartData(dated, 7, '2026-10-12');
  assert.strictEqual(c.length, 7);
  assert.strictEqual(c[0].date, '2026-10-06');
  assert.strictEqual(c[6].date, '2026-10-12');
  const oct11 = c.find(d => d.date === '2026-10-11');
  assert.strictEqual(oct11.minutes, 420);
  assert.strictEqual(c.find(d => d.date === '2026-10-10').minutes, null);
});

/* --- export / import --- */
check('buildExport -> parseImport round-trip preserves entries', () => {
  const entries = [{ id: 'e1', date: '2026-10-11', bedtime: '23:30', wake: '06:30', quality: 4, note: 'ok' }];
  const res = L.parseImport(JSON.stringify(L.buildExport(entries)));
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.entries.length, 1);
  assert.strictEqual(res.entries[0].bedtime, '23:30');
  assert.strictEqual(L.durationMinutes(res.entries[0].bedtime, res.entries[0].wake), 420);
});
check('parseImport rejects malformed JSON', () =>
  assert.deepStrictEqual(L.parseImport('{nope'), { ok: false, error: 'malformed' }));
check('parseImport rejects missing entries array', () =>
  assert.strictEqual(L.parseImport('{"app":"x"}').error, 'no-entries'));
check('parseImport rejects invalid entry (zero duration)', () =>
  assert.strictEqual(L.parseImport(JSON.stringify({ entries: [{ id: 'e1', date: '2026-10-11', bedtime: '22:00', wake: '22:00', quality: 3 }] })).error, 'bad-schema'));
check('normalizeEntry truncates note to 500 chars', () =>
  assert.strictEqual(L.normalizeEntry({ id: 'e1', date: '2026-10-11', bedtime: '23:00', wake: '06:00', quality: 3, note: 'x'.repeat(600) }).note.length, 500));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
