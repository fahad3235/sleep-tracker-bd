/*
 * sleep-tracker-bd — headless-Chrome smoke tests.
 * Needs puppeteer-core resolvable and a Chromium binary.
 *
 *   node tests/browser.test.js
 *   CHROME=/path/to/chrome NODE_PATH=/path/to/puppeteer-core-parent node tests/browser.test.js
 *
 * Loads the app over file:// (Chrome in this VM blocks CDP-driven navigation
 * to http://127.0.0.1) and drives the real UI with
 * ?asof=2026-10-12 so stats/charts are deterministic.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/opt/meta-chromium/chrome';
const ASOF = '2026-10-12';
// NOTE: Chrome in this VM blocks CDP-driven navigation to http://127.0.0.1
// (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS), so the harness loads the app
// over file:// — the app itself makes zero network requests either way.

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + (e.message || e).split('\n')[0]); }
}

(async () => {
  const URL = 'file://' + path.join(ROOT, 'index.html') + '?asof=' + ASOF;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  const consoleErrors = [], pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'networkidle0' });

  const text = sel => page.$eval(sel, el => el.textContent.trim());
  const setTime = async (sel, val) => page.$eval(sel, (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, val);
  const rows = () => page.$$('#entryList .entry');

  console.log('sleep-tracker-bd browser tests\n');

  await check('page title is Sleep Tracker BD', async () => {
    const t = await page.title();
    if (t !== 'Sleep Tracker BD') throw new Error('got: ' + t);
  });
  await check('empty state visible with no entries', async () => {
    const vis = await page.$eval('#historyEmpty', el => !el.classList.contains('hidden'));
    if (!vis) throw new Error('empty block hidden');
    if ((await rows()).length !== 0) throw new Error('rows present');
  });

  // --- add entry 1: 2026-10-11, 23:30 -> 06:30 ---
  await page.$eval('#entryDate', (el, v) => { el.value = v; }, '2026-10-11');
  await setTime('#bedtime', '23:30');
  await setTime('#wakeTime', '06:30');
  await check('live preview shows 7h 00m for 23:30 -> 06:30', async () => {
    if ((await text('#durationPreview')) !== '7h 00m') throw new Error(await text('#durationPreview'));
  });
  await check('midnight hint shown when wake < bedtime', async () => {
    const vis = await page.$eval('#midnightHint', el => !el.classList.contains('hidden'));
    if (!vis) throw new Error('hint hidden');
  });
  await page.click('#stars [data-star="4"]');
  await page.$eval('#note', el => { el.value = 'test night one'; });
  await page.click('#saveBtn');
  await check('entry saved: 1 row, 7h 00m, +1d badge, 4 stars', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#entryList .entry').length === 1);
    const dur = await text('#entryList .entry .entry-dur');
    if (dur !== '7h 00m') throw new Error('dur=' + dur);
    const badge = await page.$('#entryList .entry .mid-badge');
    if (!badge) throw new Error('no +1d badge');
    const on = await page.$$eval('#entryList .entry .mini-star.on', els => els.length);
    if (on !== 4) throw new Error('stars on=' + on);
    const note = await text('#entryList .entry .entry-note');
    if (note !== 'test night one') throw new Error('note=' + note);
  });
  await check('stats update: 1 night logged, avg 7h 00m', async () => {
    if ((await text('#statCount')) !== '1') throw new Error('count=' + await text('#statCount'));
    if ((await text('#statAvgDur')) !== '7h 00m') throw new Error('avg=' + await text('#statAvgDur'));
  });
  await check('chart renders 1 bar', async () => {
    const n = await page.$$eval('#chart rect.chart-bar', els => els.length);
    if (n !== 1) throw new Error('bars=' + n);
  });

  // --- edit: wake 06:30 -> 07:30 ---
  await page.click('#entryList .entry [data-act="edit"]');
  await check('edit pre-fills form', async () => {
    const w = await page.$eval('#wakeTime', el => el.value);
    if (w !== '06:30') throw new Error('wake=' + w);
    if ((await text('#saveBtn')) !== 'Update entry') throw new Error('save label wrong');
  });
  await setTime('#wakeTime', '07:30');
  await page.click('#saveBtn');
  await check('edit updates duration to 8h 00m + toast', async () => {
    await page.waitForFunction(() => document.querySelector('#entryList .entry .entry-dur').textContent.trim() === '8h 00m');
    const t = await text('#toast');
    if (t !== 'Entry updated.') throw new Error('toast=' + t);
  });

  // --- add entry 2: 2026-10-10, 01:00 -> 07:00 (no midnight crossing) ---
  await page.$eval('#entryDate', (el, v) => { el.value = v; }, '2026-10-10');
  await setTime('#bedtime', '01:00');
  await setTime('#wakeTime', '07:00');
  await check('no midnight badge for same-day 01:00 -> 07:00', async () => {
    const vis = await page.$eval('#midnightHint', el => !el.classList.contains('hidden'));
    if (vis) throw new Error('hint should be hidden');
  });
  await page.click('#stars [data-star="5"]');
  await page.click('#saveBtn');
  await check('two entries; avg duration 7h 00m; avg quality 4.5; sd ±60m', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#entryList .entry').length === 2);
    if ((await text('#statCount')) !== '2') throw new Error('count');
    if ((await text('#statAvgDur')) !== '7h 00m') throw new Error('avgDur=' + await text('#statAvgDur'));
    if ((await text('#statAvgQual')) !== '4.5') throw new Error('avgQual=' + await text('#statAvgQual'));
    if ((await text('#statSd')) !== '± 60m') throw new Error('sd=' + await text('#statSd'));
  });
  await check('30-day tab also aggregates both nights', async () => {
    await page.click('[data-stats-range="30"]');
    if ((await text('#statCount')) !== '2') throw new Error('count30');
    await page.click('[data-stats-range="7"]');
  });

  // --- two-step delete ---
  await check('delete arms on first click, deletes on second', async () => {
    const btn = await page.$('#entryList .entry [data-act="delete"]');
    await btn.click();
    const armed = await page.$eval('#entryList .entry [data-act="delete"]', el => el.textContent.trim());
    if (armed !== 'Tap again to confirm delete') throw new Error('armed text=' + armed);
    await page.click('#entryList .entry [data-act="delete"]');
    await page.waitForFunction(() => document.querySelectorAll('#entryList .entry').length === 1);
    if ((await text('#toast')) !== 'Entry deleted.') throw new Error('no toast');
  });

  // --- persistence ---
  await check('entries persist across reload', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelectorAll('#entryList .entry').length === 1);
    if ((await text('#entryList .entry .entry-dur')) !== '6h 00m') throw new Error('dur after reload');
  });

  // --- BN toggle ---
  await page.click('#langToggle');
  await check('BN toggle: title in Bengali, Bengali digits in duration', async () => {
    await page.waitForFunction(() => document.title === 'স্লিপ ট্র্যাকার বিডি');
    const dur = await text('#entryList .entry .entry-dur');
    if (dur !== '৬h ০০m') throw new Error('dur=' + dur);
    if ((await text('#statCount')) !== '১') throw new Error('count bn');
    if ((await text('#statAvgQual')) !== '৫.০') throw new Error('qual bn=' + await text('#statAvgQual'));
  });
  await page.click('#langToggle');
  await check('toggle back to EN restores English', async () => {
    await page.waitForFunction(() => document.title === 'Sleep Tracker BD');
  });

  // --- export: capture the blob the app creates ---
  await check('export produces valid JSON envelope with the entry', async () => {
    const json = await page.evaluate(async () => {
      let captured = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = blob => { captured = blob; return orig.call(URL, blob); };
      document.getElementById('exportBtn').click();
      URL.createObjectURL = orig;
      return captured ? captured.text() : null;
    });
    if (!json) throw new Error('no blob captured');
    const data = JSON.parse(json);
    if (data.app !== 'sleep-tracker-bd' || !Array.isArray(data.entries)) throw new Error('bad envelope');
    if (data.entries.length !== 1) throw new Error('entries=' + data.entries.length);
  });

  // --- import round-trip ---
  const importPayload = JSON.stringify({
    app: 'sleep-tracker-bd', version: 1,
    entries: [{ id: 'imp1', date: '2026-10-09', bedtime: '22:30', wake: '06:00', quality: 3, note: 'imported' }]
  });
  fs.writeFileSync('/tmp/sleep-import-ok.json', importPayload);
  fs.writeFileSync('/tmp/sleep-import-bad.json', '{not json');
  await check('import adds the new entry (round-trip)', async () => {
    const input = await page.$('#importFile');
    await input.uploadFile('/tmp/sleep-import-ok.json');
    await page.waitForFunction(() => document.querySelectorAll('#entryList .entry').length === 2);
    const dates = await page.$$eval('#entryList .entry .entry-date', els => els.map(e => e.textContent));
    if (!dates.some(d => d.includes('Oct 9'))) throw new Error('imported row missing: ' + dates.join('|'));
  });
  await check('malformed import rejected, data unchanged', async () => {
    const before = (await rows()).length;
    const input = await page.$('#importFile');
    await input.uploadFile('/tmp/sleep-import-bad.json');
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'));
    const t = await text('#toast');
    if (!t.includes('Import failed')) throw new Error('toast=' + t);
    if ((await rows()).length !== before) throw new Error('data changed');
  });

  // --- validation: equal times rejected ---
  await check('equal bedtime/wake rejected with visible error', async () => {
    const before = (await rows()).length;
    await setTime('#bedtime', '22:00');
    await setTime('#wakeTime', '22:00');
    await page.click('#saveBtn');
    const vis = await page.$eval('#formError', el => !el.classList.contains('hidden'));
    if (!vis) throw new Error('error hidden');
    if ((await rows()).length !== before) throw new Error('row added');
    // reset the form fields so later steps start clean
    await page.$eval('#bedtime', el => { el.value = ''; });
    await page.$eval('#wakeTime', el => { el.value = ''; });
  });

  // --- mobile ---
  await check('390px viewport: no horizontal overflow', async () => {
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.reload({ waitUntil: 'networkidle0' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error('overflow=' + overflow);
    await page.setViewport({ width: 1280, height: 900 });
  });

  await check('zero console errors and zero page errors', async () => {
    if (consoleErrors.length) throw new Error('console: ' + consoleErrors.join(' | ').slice(0, 200));
    if (pageErrors.length) throw new Error('page: ' + pageErrors.join(' | ').slice(0, 200));
  });

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
