# Sleep Tracker BD — স্লিপ ট্র্যাকার বিডি

A free, fully offline bilingual sleep log. Record bedtime and wake time,
rate each night 1–5 stars, and see 7/30-day stats plus a pure-SVG bar chart —
in English or বাংলা. No accounts, no servers, no network requests.

## Problem

Poor sleep creeps up on people: irregular bedtimes, short nights, and no
memory of what "normal" even looks like. Paper diaries get abandoned, and
most sleep apps demand accounts, subscriptions, and cloud sync. This app is a
simple, private, always-available night log that lives entirely in the
browser.

## Features

- **Bedtime / wake-time entry** (time inputs, date-stamped) with automatic
  duration calculation. Crossing midnight is handled correctly:
  23:30 → 06:30 = 7h 00m.
- **Midnight rule, documented in the UI:** if wake time is earlier than
  bedtime, it is counted as the *next morning*. Equal times are rejected
  (duration would be 0) with a visible error.
- **Sleep quality rating** (1–5 stars, tappable) per night + optional note.
- **7-day and 30-day stats:** average duration, average quality, consistency
  (population standard deviation of nightly durations), nights logged.
- **Bar chart** of the last 7/14 nights' durations (hand-built inline SVG,
  no libraries), with a shaded 7–9h healthy band and missing-night markers.
- **Full EN/বাংলা UI toggle** with Bengali digits in Bangla mode
  (e.g. `৬h ০০m`) and Bengali month names in dates.
- **localStorage persistence**, **JSON export/import** (malformed imports are
  rejected without touching your data), **entry edit/delete** (two-step
  delete), mobile-responsive ≤640px, empty states, inline validation.

## Stack

Vanilla HTML/CSS/JS. No build step, no dependencies, no frameworks,
no network requests. All sleep math lives in `js/sleep.js` as pure functions
(no DOM, no hidden `Date.now()`), shared by the app and the Node unit tests.
i18n strings live in `js/i18n.js`; UI wiring in `js/app.js`.

## Prerequisites

Any modern browser (Chrome, Firefox, Safari, Edge). Nothing to install.

## Install

No install. Open `index.html` directly, or serve the folder:

```bash
cd sleep-tracker-bd
python3 -m http.server 8000
# then open http://localhost:8000
```

## Dev commands

None — there is no build. Edit the files and reload.

## Environment

None. There are no API keys, backends, or `.env` files. The app makes
zero network requests (verified by scanning all source files); all data stays
in the browser's localStorage.

## Testing

Two real suites, both run green:

```bash
# unit tests (no dependencies) — 35 checks
node tests/unit.test.js

# headless-Chrome smoke tests (needs puppeteer-core resolvable
# and Chromium at /opt/meta-chromium/chrome, or set CHROME=...)
NODE_PATH=/path/to/dir/containing/puppeteer-core node tests/browser.test.js
```

22 browser checks, real runs: zero console/page errors. Covered: add entry
(23:30→06:30 shows 7h 00m + midnight badge), live duration preview, edit
(06:30→07:30 becomes 8h 00m), same-day 01:00→07:00 = 6h 00m without badge,
stats (avg 7h 00m, quality 4.5, ±60m std-dev), 7/30-day tabs, chart renders,
two-step delete, persistence across reload, BN toggle with Bengali digits,
export produces a valid JSON envelope, import round-trip, malformed import
rejected with data unchanged, equal bed/wake times rejected, 390px mobile
no horizontal overflow.

A `?asof=YYYY-MM-DD` query param freezes "today" for deterministic tests.

## Deployment

Static files — deploy anywhere. GitHub Pages compatible:
repo Settings → Pages → Deploy from branch → `main` / `/ (root)`.

## Limitations

- **Not medical advice.** This is a personal organizer, not a sleep
  diagnosis tool. Talk to a doctor about real sleep problems.
- Data lives in one browser's localStorage (no sync); JSON export is the
  backup path. Clearing site data deletes everything.
- Duration is computed from the two times you enter — there is no
  automatic sleep detection and no wearable integration.
- "Nights" are grouped by bedtime date; a nap logged the same calendar day
  would need its own date entry.

## Status

Built and tested 2026-10-12. 35/35 unit checks and 22/22 headless-Chrome
checks pass. Ready for GitHub Pages deployment.
