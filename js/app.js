/*
 * sleep-tracker-bd — UI wiring (depends on js/sleep.js and js/i18n.js).
 * All data persists in localStorage. Supports ?asof=YYYY-MM-DD to freeze
 * "today" (used by the headless tests for deterministic stats/charts).
 */
'use strict';

(function () {
  var L = window.SleepLogic;
  var LS_ENTRIES = 'sleep-tracker-bd.entries.v1';
  var LS_LANG = 'sleep-tracker-bd.lang.v1';

  var asof = (function () {
    var m = /[?&]asof=(\d{4}-\d{2}-\d{2})/.exec(window.location.search);
    return m ? m[1] : L.dateToISO(new Date());
  })();

  var state = {
    lang: 'en',
    entries: [],
    statsRange: 7,
    chartNights: 7,
    editingId: null,
    quality: 3,
    deleteArmed: null,
    deleteTimer: null
  };

  function $(id) { return document.getElementById(id); }

  function t(key) {
    var dict = window.SleepI18n[state.lang] || window.SleepI18n.en;
    return dict[key] !== undefined ? dict[key] : window.SleepI18n.en[key];
  }
  function useBn() { return state.lang === 'bn'; }
  function num(v) { return useBn() ? L.bnDigits(String(v)) : String(v); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- storage ---------- */
  function loadEntries() {
    try {
      var raw = localStorage.getItem(LS_ENTRIES);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (e) {
        return e && typeof e === 'object' && typeof e.id === 'string' &&
          L.validateEntry(e).length === 0;
      }).map(L.normalizeEntry);
    } catch (e) { return []; }
  }
  function saveEntries() {
    localStorage.setItem(LS_ENTRIES, JSON.stringify(state.entries));
  }
  function loadLang() {
    var v = null;
    try { v = localStorage.getItem(LS_LANG); } catch (e) {}
    return v === 'bn' ? 'bn' : 'en';
  }

  function durationOf(e) { return L.durationMinutes(e.bedtime, e.wake); }

  /* ---------- toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ---------- date formatting ---------- */
  function fmtDate(iso) {
    var p = iso.split('-');
    var y = +p[0], mo = +p[1], d = +p[2];
    if (useBn()) return L.bnDigits(String(d)) + ' ' + window.BN_MONTHS[mo - 1] + ', ' + L.bnDigits(String(y));
    return window.EN_MONTHS[mo - 1] + ' ' + d + ', ' + y;
  }

  /* ---------- stars widget ---------- */
  function renderStars() {
    var box = $('stars');
    box.innerHTML = '';
    for (var i = 1; i <= 5; i++) {
      (function (v) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'star' + (v <= state.quality ? ' on' : '');
        b.setAttribute('data-star', String(v));
        b.setAttribute('aria-label', t('starSet').replace('{n}', String(v)));
        b.textContent = '★';
        b.addEventListener('click', function () {
          state.quality = v;
          renderStars();
          $('qualityHint').textContent = t('starSet').replace('{n}', num(v));
        });
        box.appendChild(b);
      })(i);
    }
  }

  /* ---------- live duration preview ---------- */
  function updatePreview() {
    var bed = $('bedtime').value, wake = $('wakeTime').value;
    var prev = $('durationPreview'), hint = $('midnightHint');
    if (!bed || !wake) { prev.textContent = '–'; hint.classList.add('hidden'); return; }
    var mins = L.durationMinutes(bed, wake);
    if (Number.isNaN(mins)) { prev.textContent = '–'; hint.classList.add('hidden'); return; }
    prev.textContent = L.formatDuration(mins, useBn());
    if (mins === 0) {
      hint.textContent = t('errZero');
      hint.classList.remove('hidden');
    } else if (L.crossesMidnight(bed, wake)) {
      hint.textContent = t('midnightNote');
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
    }
  }

  /* ---------- form ---------- */
  function resetForm() {
    state.editingId = null;
    state.quality = 3;
    $('entryDate').value = asof;
    $('bedtime').value = '';
    $('wakeTime').value = '';
    $('note').value = '';
    $('formError').classList.add('hidden');
    $('formTitle').textContent = t('addEntry');
    $('saveBtn').textContent = t('saveEntry');
    $('cancelEditBtn').classList.add('hidden');
    renderStars();
    updatePreview();
  }

  function startEdit(id) {
    var e = state.entries.find(function (x) { return x.id === id; });
    if (!e) return;
    state.editingId = id;
    state.quality = e.quality;
    $('entryDate').value = e.date;
    $('bedtime').value = e.bedtime;
    $('wakeTime').value = e.wake;
    $('note').value = e.note || '';
    $('formTitle').textContent = t('edit');
    $('saveBtn').textContent = t('updateEntry');
    $('cancelEditBtn').classList.remove('hidden');
    renderStars();
    updatePreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function submitForm() {
    var entry = {
      id: state.editingId || ('e' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)),
      date: $('entryDate').value,
      bedtime: $('bedtime').value,
      wake: $('wakeTime').value,
      quality: state.quality,
      note: $('note').value.trim()
    };
    var errs = L.validateEntry(entry);
    var errBox = $('formError');
    if (errs.indexOf('zero-duration') !== -1) {
      errBox.textContent = t('errZero');
      errBox.classList.remove('hidden');
      return;
    }
    if (errs.length > 0) {
      errBox.textContent = t('errInvalid');
      errBox.classList.remove('hidden');
      return;
    }
    entry.updatedAt = new Date().toISOString();
    if (state.editingId) {
      var i = state.entries.findIndex(function (x) { return x.id === state.editingId; });
      if (i !== -1) state.entries[i] = L.normalizeEntry(entry);
      toast(t('entryUpdated'));
    } else {
      state.entries.push(L.normalizeEntry(entry));
      toast(t('entrySaved'));
    }
    saveEntries();
    resetForm();
    render();
  }

  /* ---------- history list ---------- */
  function sortedEntries() {
    return state.entries.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.bedtime < b.bedtime ? 1 : -1;
    });
  }

  function renderHistory() {
    var list = $('entryList');
    var items = sortedEntries();
    $('historyEmpty').classList.toggle('hidden', items.length > 0);
    list.innerHTML = '';
    items.forEach(function (e) {
      var li = document.createElement('li');
      li.className = 'entry';
      li.setAttribute('data-id', e.id);
      var stars = '';
      for (var s = 1; s <= 5; s++) stars += '<span class="mini-star' + (s <= e.quality ? ' on' : '') + '">★</span>';
      li.innerHTML =
        '<div class="entry-main">' +
          '<div class="entry-top"><span class="entry-date">' + esc(fmtDate(e.date)) + '</span>' +
          '<span class="entry-dur">' + esc(L.formatDuration(durationOf(e), useBn())) + '</span></div>' +
          '<div class="entry-times">' + esc(e.bedtime) + ' → ' + esc(e.wake) +
          (L.crossesMidnight(e.bedtime, e.wake) ? ' <span class="mid-badge">+1d</span>' : '') + '</div>' +
          '<div class="entry-qual" aria-label="' + esc(t('starSet').replace('{n}', String(e.quality))) + '">' + stars + '</div>' +
          (e.note ? '<div class="entry-note">' + esc(e.note) + '</div>' : '') +
        '</div>' +
        '<div class="entry-actions">' +
          '<button class="btn small" data-act="edit">' + esc(t('edit')) + '</button>' +
          '<button class="btn small danger" data-act="delete">' + esc(t('del')) + '</button>' +
        '</div>';
      var delBtn = li.querySelector('[data-act="delete"]');
      delBtn.addEventListener('click', function () {
        if (state.deleteArmed === e.id) {
          disarmDelete();
          state.entries = state.entries.filter(function (x) { return x.id !== e.id; });
          saveEntries();
          toast(t('entryDeleted'));
          render();
        } else {
          disarmDelete();
          state.deleteArmed = e.id;
          delBtn.textContent = t('confirmDelete');
          delBtn.classList.add('armed');
          state.deleteTimer = setTimeout(disarmDelete, 4000);
        }
      });
      li.querySelector('[data-act="edit"]').addEventListener('click', function () { startEdit(e.id); });
      list.appendChild(li);
    });
  }

  function disarmDelete() {
    state.deleteArmed = null;
    clearTimeout(state.deleteTimer);
    var armed = document.querySelector('.btn.armed');
    if (armed) { armed.classList.remove('armed'); armed.textContent = t('del'); }
  }

  /* ---------- stats ---------- */
  function renderStats() {
    var rows = L.entriesInWindow(state.entries, state.statsRange, asof)
      .map(function (e) { return { durationMin: durationOf(e), quality: e.quality }; });
    var s = L.stats(rows);
    $('statCount').textContent = num(s.count);
    $('statAvgDur').textContent = s.avgMin === null ? '–' : L.formatDuration(Math.round(s.avgMin), useBn());
    $('statAvgQual').textContent = s.avgQuality === null ? '–' : num(s.avgQuality.toFixed(1));
    $('statSd').textContent = s.sdMin === null ? '–' :
      (useBn() ? '± ' + L.bnDigits(String(Math.round(s.sdMin))) + t('min')
               : '± ' + Math.round(s.sdMin) + 'm');
    var btns = document.querySelectorAll('[data-stats-range]');
    btns.forEach(function (b) {
      b.classList.toggle('active', +b.getAttribute('data-stats-range') === state.statsRange);
    });
    $('statsEmpty').classList.toggle('hidden', s.count > 0);
  }

  /* ---------- chart (pure inline SVG, no libraries) ---------- */
  function renderChart() {
    var data = L.chartData(state.entries, state.chartNights, asof);
    var any = data.some(function (d) { return d.minutes !== null; });
    $('chartEmpty').classList.toggle('hidden', any);
    var svg = $('chart');
    svg.innerHTML = '';
    if (!any) { svg.setAttribute('aria-hidden', 'true'); return; }
    svg.removeAttribute('aria-hidden');

    var NS = 'http://www.w3.org/2000/svg';
    var W = 560, H = 260, ml = 46, mr = 10, mt = 14, mb = 34;
    var maxY = 600; // 10h
    var pw = W - ml - mr, ph = H - mt - mb;
    var n = data.length;
    var slot = pw / n, barW = Math.min(44, slot * 0.62);

    function el(name, attrs) {
      var node = document.createElementNS(NS, name);
      for (var k in attrs) node.setAttribute(k, attrs[k]);
      return node;
    }
    function yFor(mins) { return mt + ph - (mins / maxY) * ph; }

    // healthy band 7h–9h (420–540 min)
    svg.appendChild(el('rect', {
      x: ml, y: yFor(540), width: pw, height: yFor(420) - yFor(540),
      fill: 'rgba(74,222,128,0.14)'
    }));
    var bandLabel = el('text', { x: ml + 4, y: yFor(540) - 5, 'class': 'chart-note' });
    bandLabel.textContent = t('targetBand');
    svg.appendChild(bandLabel);

    // gridlines + y labels
    for (var g = 0; g <= 600; g += 120) {
      svg.appendChild(el('line', { x1: ml, x2: W - mr, y1: yFor(g), y2: yFor(g), 'class': 'grid' }));
      var lab = el('text', { x: ml - 8, y: yFor(g) + 4, 'class': 'chart-axis', 'text-anchor': 'end' });
      lab.textContent = L.formatDurationShort(g, useBn());
      svg.appendChild(lab);
    }

    // bars
    data.forEach(function (d, i) {
      var cx = ml + slot * i + slot / 2;
      if (d.minutes === null) {
        var miss = el('circle', { cx: cx, cy: yFor(0) + 8, r: 3, 'class': 'chart-missing' });
        var tt = el('title', {});
        tt.textContent = d.date;
        miss.appendChild(tt);
        svg.appendChild(miss);
      } else {
        var h = (d.minutes / maxY) * ph;
        var r = el('rect', {
          x: cx - barW / 2, y: yFor(d.minutes), width: barW, height: h,
          rx: 5, 'class': 'chart-bar'
        });
        var title = el('title', {});
        title.textContent = fmtDate(d.date) + ': ' + L.formatDuration(d.minutes, useBn());
        r.appendChild(title);
        svg.appendChild(r);
      }
      var xl = el('text', { x: cx, y: H - 12, 'class': 'chart-axis', 'text-anchor': 'middle' });
      xl.textContent = num(+d.date.split('-')[2]);
      svg.appendChild(xl);
    });

    var rangeBtns = document.querySelectorAll('[data-chart-nights]');
    rangeBtns.forEach(function (b) {
      b.classList.toggle('active', +b.getAttribute('data-chart-nights') === state.chartNights);
    });
  }

  /* ---------- export / import ---------- */
  function doExport() {
    var blob = new Blob([JSON.stringify(L.buildExport(state.entries), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sleep-tracker-bd-export.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function doImport(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var res = L.parseImport(String(reader.result));
      if (!res.ok) {
        var key = res.error === 'malformed' ? 'errMalformed' :
                  res.error === 'no-entries' ? 'errNoEntries' : 'errBadSchema';
        toast(t('importErr').replace('{err}', t(key)));
        return;
      }
      var byId = {};
      state.entries.forEach(function (e) { byId[e.id] = true; });
      var added = 0, replaced = 0;
      res.entries.forEach(function (e) {
        var i = state.entries.findIndex(function (x) { return x.id === e.id; });
        if (i !== -1) { state.entries[i] = e; replaced++; } else { state.entries.push(e); added++; }
        byId[e.id] = true;
      });
      saveEntries();
      render();
      toast(t('importDup').replace('{n}', num(replaced)).replace('{m}', num(added)));
    };
    reader.readAsText(file);
  }

  /* ---------- language ---------- */
  function setLang(lang) {
    state.lang = lang;
    try { localStorage.setItem(LS_LANG, lang); } catch (e) {}
    document.documentElement.lang = lang === 'bn' ? 'bn' : 'en';
    applyI18n();
    resetForm();
    render();
  }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (node) {
      node.placeholder = t(node.getAttribute('data-i18n-ph'));
    });
    $('langToggle').textContent = t('langName');
    document.title = t('title');
  }

  /* ---------- master render ---------- */
  function render() {
    disarmDelete();
    renderHistory();
    renderStats();
    renderChart();
  }

  /* ---------- init ---------- */
  function init() {
    state.lang = loadLang();
    state.entries = loadEntries();
    document.documentElement.lang = state.lang === 'bn' ? 'bn' : 'en';

    applyI18n();
    resetForm();

    $('langToggle').addEventListener('click', function () {
      setLang(state.lang === 'en' ? 'bn' : 'en');
    });
    ['bedtime', 'wakeTime'].forEach(function (id) {
      $(id).addEventListener('input', updatePreview);
      $(id).addEventListener('change', updatePreview);
    });
    $('saveBtn').addEventListener('click', submitForm);
    $('cancelEditBtn').addEventListener('click', resetForm);
    document.querySelectorAll('[data-stats-range]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.statsRange = +b.getAttribute('data-stats-range');
        renderStats();
      });
    });
    document.querySelectorAll('[data-chart-nights]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.chartNights = +b.getAttribute('data-chart-nights');
        renderChart();
      });
    });
    $('exportBtn').addEventListener('click', doExport);
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function (ev) {
      if (ev.target.files && ev.target.files[0]) doImport(ev.target.files[0]);
      ev.target.value = '';
    });

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* exposed for the headless test harness */
  window.SleepApp = { state: state, asof: asof, t: t, render: render };
})();
