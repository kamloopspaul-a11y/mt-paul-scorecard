// A Bit of Bogey — app shell, state, router, and the round-capture pipeline.
// Pass 1 scope: onboarding -> setup -> home -> live 18-hole scoring -> final
// score -> save. Pass 2 scope: Reports/Analytics screen wired to real
// rounds-history data (see js/stats.js). Pass 3 scope: full Settings screen
// (dark mode, membership/green fee inputs, weather, export placeholder) and
// PWA/offline plumbing (service worker registration — see sw.js). See Design
// Handoff/README.md for the full spec this implements.

import { buildRoundRecord, buildNineHoleRecord, resolvePendingNine } from './round-record.js';
import { buildSettingsRecord } from './settings-record.js';
import { loadCourseData, getHolesForTee, getPar } from './course-data.js';
import { KEYS, readJSON, writeJSON, remove, appendToArray } from './storage.js';
import { buildAnalytics, loadHandicapRatings, markWeekAnimated } from './stats.js';
import {
  TOGGLE_ON_GRADIENT, TOGGLE_OFF_GRADIENT,
  TOGGLE_ON_SHADOW, TOGGLE_OFF_SHADOW,
  TOGGLE_KNOB_ON_POS, TOGGLE_KNOB_OFF_POS
} from './stats-defaults.js';

const appEl = document.getElementById('app');

let courseData = null;
let handicapData = null;

// Kamloops BC — same lat/long used by the sibling Golf project's weather
// pattern (Open-Meteo, free, no API key required). See js/app.js's
// fetchWeather() below for the graceful-failure contract.
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=50.6745&longitude=-120.3273&current=temperature_2m,wind_speed_10m&temperature_unit=celsius&wind_speed_unit=kmh';

// Module-level weather readout state — refreshed each time the Setup/Settings
// screen loads. Never blocks the UI: on fetch failure both fields go back to
// '' and the readout just renders blank (no error surfaced to the user).
let weatherState = { temp: '', wind: '' };

// --- App state (module-level, single source of truth for the UI) ---
const state = {
  screen: 'loading', // loading | onboarding | setup | settings | home | hole | finalscore | front9score | reports
  settings: null,     // settings-record.js shape (+ app-shell-only `onboarded` flag)
  currentRound: null, // { tee, playerName, startHoleNum, sessionLength, holes: [] }
  draft: null,        // in-progress edits for the hole currently on screen
  toastMsg: null,
  toastTimer: null,
  fromSettings: false, // whether Setup screen was opened from Home > Settings (vs first run)
  menuOpen: false,     // Pass 6 Fix 3: hamburger slide-out menu, available from every topbar
  front9Continue: true // Pass 6 Fix 6: Front 9 Score screen's Continue/Quit toggle (Case A only)
};

function pad2(n) { return n < 10 ? '0' + n : String(n); }

// ===================== Init =====================

async function init() {
  try {
    courseData = await loadCourseData();
  } catch (e) {
    console.error('Could not load course data', e);
  }

  try {
    handicapData = await loadHandicapRatings();
  } catch (e) {
    console.error('Could not load handicap ratings', e);
  }

  state.settings = readJSON(KEYS.SETTINGS, null);
  state.currentRound = readJSON(KEYS.CURRENT_ROUND, null);

  // Apply light/dark theme on every boot, before first render, so there's no
  // flash of the wrong theme. Default (no settings yet, or lightMode !== false)
  // is Light Mode per settings-record.js.
  applyDarkModeClass(!!(state.settings && state.settings.lightMode === false));

  // Register the service worker for offline/app-shell caching (see sw.js).
  // Guarded so a lack of SW support, an insecure context, or a registration
  // failure never throws or blocks app boot.
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((e) => {
        console.warn('Service worker registration failed', e);
      });
    }
  } catch (e) {
    console.warn('Service worker registration threw', e);
  }

  if (!state.settings || !state.settings.onboarded) {
    state.screen = 'onboarding';
  } else if (
    state.currentRound &&
    Array.isArray(state.currentRound.holes) &&
    state.currentRound.sessionLength === 18 &&
    state.currentRound.holes.length >= 18
  ) {
    // Bug fix (Pass 5): all 18 holes were recorded (write-before-navigate
    // already persisted them) but the round was never tapped "Save" from the
    // Final Score screen when the app closed/crashed. The old check below
    // only resumed when holes.length < sessionLength, so a completed-but-
    // unsaved round fell through to Home and sat orphaned in `currentRound`
    // — the next Play 18/Play 9 tap's startRound() then silently overwrote
    // and permanently lost it. Resume straight into Final Score instead.
    state.screen = 'finalscore';
  } else if (
    state.currentRound &&
    Array.isArray(state.currentRound.holes) &&
    state.currentRound.startHoleNum === 1 &&
    state.currentRound.holes.length === 9
  ) {
    // Pass 6: the front nine just finished (write-before-navigate already
    // persisted all 9 holes) but the app closed/crashed before the new
    // Front 9 Score screen's Continue/Quit (18-hole session) or Post Now
    // (standalone 9-hole session) action was taken. Resume straight into
    // that review screen — same crash-resilience contract as the completed-
    // 18-hole-round case above, just one screen earlier in the flow.
    state.front9Continue = true;
    state.screen = 'front9score';
    render();
    return;
  } else if (
    state.currentRound &&
    Array.isArray(state.currentRound.holes) &&
    state.currentRound.holes.length < (state.currentRound.sessionLength || 18)
  ) {
    // Crash/reload resilience: a round was mid-flight in localStorage — resume it.
    resumeIntoHoleScreen();
    return;
  } else {
    state.screen = 'home';
  }
  render();
}

// ===================== Theme (Pass 3) =====================
//
// No dark-mode mockup exists; CSS overrides live in css/styles.css under
// `body.dark-mode` (background/text flip, CTA gradient stays identical in
// both modes). This just toggles the class — applied on boot (init, above)
// and immediately on toggle tap (see attachHandlers' 'setup' case), not
// deferred until Save.
function applyDarkModeClass(isDark) {
  document.body.classList.toggle('dark-mode', !!isDark);
}

// ===================== Weather (Pass 3) =====================
//
// Ported from the sibling Golf project's fetchWeather() — same Open-Meteo
// endpoint, same Kamloops coordinates, same graceful-failure contract (blank
// strings on any error, never blocks or surfaces an error to the user).
async function fetchWeather() {
  try {
    const res = await fetch(WEATHER_URL);
    const data = await res.json();
    weatherState.temp = 'Temp: ' + Math.round(data.current.temperature_2m) + '°C';
    weatherState.wind = 'Wind: ' + Math.round(data.current.wind_speed_10m) + ' km/h';
  } catch (e) {
    weatherState.temp = '';
    weatherState.wind = '';
  }
  updateWeatherReadout();
}

function updateWeatherReadout() {
  const el = document.getElementById('weather-readout');
  if (!el) return; // user navigated away before the fetch resolved — no-op
  el.textContent = [weatherState.temp, weatherState.wind].filter(Boolean).join(' · ');
}

// ===================== Round lifecycle =====================

function startRound({ startHoleNum, sessionLength }) {
  const tee = (state.settings && state.settings.teePref) || 'blue';
  const playerName = (state.settings && state.settings.playerName) || '';
  state.currentRound = { tee, playerName, startHoleNum, sessionLength, holes: [] };
  writeJSON(KEYS.CURRENT_ROUND, state.currentRound);
  goToHoleScreen();
}

function resumeIntoHoleScreen() {
  goToHoleScreen();
}

// Builds a fresh editable draft for whichever hole comes next in currentRound,
// and shows the hole screen.
function goToHoleScreen() {
  const cr = state.currentRound;
  const holesPlayed = cr.holes.length;
  const holeNum = cr.startHoleNum + holesPlayed;
  const par = courseData ? getPar(courseData, cr.tee, holeNum) : 4;
  state.draft = {
    holeNum,
    par,
    score: par,
    fir: false, // shown on every hole including par-3s per mockups — no more null special-casing (Pass 5 Fix 1)
    gir: false,
    pen: false,
    ud: false,
    putts: 2 // Pass 6 Fix 4: realistic default — most holes are 2-putt (was 0)
  };
  state.screen = 'hole';
  render();
}

// Tapping "Next"/"Play It <Name>" on a hole screen: write immediately to
// localStorage BEFORE navigating (crash/battery resilience), then advance.
function commitHoleAndAdvance() {
  const cr = state.currentRound;
  const holeEntry = { ...state.draft };
  cr.holes.push(holeEntry);
  writeJSON(KEYS.CURRENT_ROUND, cr); // <-- write-before-navigate, per spec
  state.draft = null;

  // Pass 6 Fix 6: the front nine (holes 1-9) just completed — show the
  // Front 9 Score review screen instead of silently continuing. This covers
  // both an 18-hole session mid-flight (sessionLength 18) and a deliberate
  // standalone 9-hole session (sessionLength 9), which previously went
  // straight into Hole 10 or straight into resolveNineAndSave() with no
  // interstitial. Back-nine sessions (startHoleNum 10) are untouched — they
  // still fall through to the finishSession()/goToHoleScreen() logic below.
  if (cr.startHoleNum === 1 && cr.holes.length === 9) {
    state.front9Continue = true; // default toggle position — Continue active
    state.screen = 'front9score';
    render();
    return;
  }

  if (cr.holes.length >= cr.sessionLength) {
    finishSession();
  } else {
    goToHoleScreen();
  }
}

// Pops the most recently committed hole back into the editable draft and
// returns to the hole screen — the same pattern the Final Score screen's
// Back button already used, generalized (Pass 6 Fix 5) so every hole
// screen's Back button and the Front 9 Score screen's Back button can share
// it too.
function popPreviousHoleIntoDraft() {
  const cr = state.currentRound;
  if (cr && cr.holes.length) {
    state.draft = cr.holes.pop();
    writeJSON(KEYS.CURRENT_ROUND, cr);
  }
  state.screen = 'hole';
  render();
}

// Hole screen Back button handler (Pass 6 Fix 5). Every hole 2-18 pops the
// previous hole back into the draft — EXCEPT Hole 10, whose Back must return
// to the new Front 9 Score screen instead (Fix 5's documented exception):
// Hole 9's entry stays committed/untouched in currentRound.holes, since the
// Front 9 Score screen already shows the full front-9 card for review.
function goBackFromHole() {
  const d = state.draft;
  const cr = state.currentRound;
  if (d.holeNum === 10 && cr.startHoleNum === 1) {
    state.draft = null;
    state.front9Continue = true;
    state.screen = 'front9score';
    render();
    return;
  }
  popPreviousHoleIntoDraft();
}

// Shared by the Front 9 Score screen's Quit path (Case A, 18-hole session)
// and its Post Now path (Case B, standalone 9-hole session) — the exact same
// save-as-widow-or-paired flow finishSession() already ran silently for a
// completed standalone 9-hole session; now triggered explicitly from the
// reviewable Front 9 Score screen instead of automatically on hole 9's commit.
function finishFrontNineNow() {
  const cr = state.currentRound;
  const nine = buildNineHoleRecord({
    date: new Date().toISOString(),
    playerName: cr.playerName,
    tee: cr.tee,
    half: 'front',
    holes: cr.holes
  });
  resolveNineAndSave(nine);
}

// A session (9 or 18 holes) just reached its target length by natural play
// (not via Quit).
function finishSession() {
  const cr = state.currentRound;
  if (cr.sessionLength === 18) {
    // Full 18 in one sitting — go to the Final Score preview/Save screen.
    state.screen = 'finalscore';
    render();
    return;
  }
  // sessionLength === 9: this nine is done. Save it as a nine-hole record and
  // resolve it against any pending widow (pairing logic).
  const half = cr.startHoleNum === 1 ? 'front' : 'back';
  const nine = buildNineHoleRecord({
    date: new Date().toISOString(),
    playerName: cr.playerName,
    tee: cr.tee,
    half,
    holes: cr.holes
  });
  resolveNineAndSave(nine);
}

// Given a just-completed nine-hole record, check for a pending widow and
// either pair it into a full round (append to rounds-history) or store it as
// the new pending nine. Always clears currentRound afterward.
function resolveNineAndSave(justPlayedNine) {
  const pending = readJSON(KEYS.PENDING_NINE, null);
  const { pairedRound, newPendingNine } = resolvePendingNine(pending, justPlayedNine);
  if (pairedRound) {
    appendToArray(KEYS.ROUNDS_HISTORY, pairedRound);
    remove(KEYS.PENDING_NINE);
    showToast('Round complete — saved to your device (' + pairedRound.totalScore + ')');
  } else {
    writeJSON(KEYS.PENDING_NINE, newPendingNine);
    const halfLabel = newPendingNine.half === 'front' ? 'front' : 'back';
    showToast('Nine holes saved — play the ' + (halfLabel === 'front' ? 'back' : 'front') + ' 9 later to complete the round.');
  }
  remove(KEYS.CURRENT_ROUND);
  state.currentRound = null;
  state.screen = 'home';
  render();
}

// Which contiguous nine-hole chunk of the current round counts as "complete",
// for the Quit-with->=9-holes case. Only the first 9 holes of the session are
// ever considered a completed nine — anything played beyond that without
// reaching a full 18 is an in-progress fragment with no defined home, and is
// discarded when quitting (see final report deviations).
function getCompletedNineChunk(cr) {
  if (cr.startHoleNum === 1 && cr.holes.length >= 9) {
    return { half: 'front', holes: cr.holes.slice(0, 9) };
  }
  if (cr.startHoleNum === 10 && cr.holes.length >= 9) {
    return { half: 'back', holes: cr.holes.slice(0, 9) };
  }
  return null;
}

// Reachable from every hole screen. Behavior depends on holes completed.
function quitCurrentRound() {
  const cr = state.currentRound;
  if (!cr) { state.screen = 'home'; render(); return; }

  const completedCount = cr.holes.length;

  if (completedCount < 9) {
    const ok = window.confirm(
      'Discard this round? You’ve completed ' + completedCount +
      ' hole' + (completedCount === 1 ? '' : 's') + ' — not enough to save.'
    );
    if (!ok) return;
    remove(KEYS.CURRENT_ROUND);
    state.currentRound = null;
    state.draft = null;
    state.screen = 'home';
    render();
    return;
  }

  const chunk = getCompletedNineChunk(cr);
  const ok = window.confirm('End round here? Your completed nine holes will be saved.');
  if (!ok) return;

  if (!chunk) {
    // Defensive fallback — shouldn't happen given completedCount >= 9 above.
    remove(KEYS.CURRENT_ROUND);
    state.currentRound = null;
    state.draft = null;
    state.screen = 'home';
    render();
    return;
  }

  const nine = buildNineHoleRecord({
    date: new Date().toISOString(),
    playerName: cr.playerName,
    tee: cr.tee,
    half: chunk.half,
    holes: chunk.holes
  });
  resolveNineAndSave(nine);
}

// Final Score -> Save (straight 18-hole round, one sitting).
function saveFinalRound() {
  const cr = state.currentRound;
  if (!cr || !Array.isArray(cr.holes) || cr.holes.length !== 18) {
    showToast('Could not save — round is incomplete.');
    return;
  }
  const record = buildRoundRecord({
    date: new Date().toISOString(),
    playerName: cr.playerName,
    tee: cr.tee,
    holes: cr.holes
  });
  appendToArray(KEYS.ROUNDS_HISTORY, record);
  remove(KEYS.CURRENT_ROUND);
  state.currentRound = null;
  state.screen = 'home';
  render();
  showToast('Saved to your device');
}

function discardPendingNine() {
  const ok = window.confirm('Discard the unfinished nine-hole round? This can’t be undone.');
  if (!ok) return;
  remove(KEYS.PENDING_NINE);
  render();
}

// ===================== Settings / Setup =====================

// Strips currency formatting ($, commas, stray whitespace) from a fee input's
// raw string value and returns a plain number, defaulting to 0 on anything
// unparsable (empty string, just "$", etc.) — never NaN.
function parseFeeInput(raw) {
  if (raw === undefined || raw === null) return 0;
  const cleaned = String(raw).replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// Inverse of parseFeeInput, for populating the input on screen load — plain
// number in, "$1,450"-style string out (blank if there's nothing to show yet,
// so the placeholder example text shows through instead).
function formatFeeForInput(n) {
  const num = Number(n) || 0;
  if (!num) return '';
  return '$' + num.toLocaleString('en-CA');
}

function saveSetup(values) {
  const rec = buildSettingsRecord({
    playerName: values.playerName,
    teePref: values.teePref,
    statsTrackingEnabled: values.statsTrackingEnabled,
    lightMode: values.lightMode !== false,
    membershipFee: values.membershipFee || 0,
    greenFee: values.greenFee || 0
  });
  // `onboarded` is an app-shell-only flag (not part of settings-record.js's
  // documented schema) so returning users skip Onboarding/Setup on future
  // loads, per the README's own suggested fix for the "no welcome-back path"
  // gap.
  rec.onboarded = true;
  state.settings = rec;
  writeJSON(KEYS.SETTINGS, rec);
  applyDarkModeClass(rec.lightMode === false);
  state.fromSettings = false;
  state.screen = 'home';
  render();
}

// ===================== Toast =====================

function showToast(msg) {
  state.toastMsg = msg;
  clearTimeout(state.toastTimer);
  renderToastOnly();
  state.toastTimer = setTimeout(() => {
    state.toastMsg = null;
    renderToastOnly();
  }, 3000);
}

function renderToastOnly() {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  if (!state.toastMsg) return;
  const div = document.createElement('div');
  div.id = 'toast';
  div.className = 'toast visible';
  div.textContent = state.toastMsg;
  document.body.appendChild(div);
}

// ===================== Render dispatcher =====================

function render() {
  let html = '';
  switch (state.screen) {
    case 'onboarding': html = renderOnboarding(); break;
    case 'setup': html = renderSetup(); break;
    case 'home': html = renderHome(); break;
    case 'hole': html = renderHole(); break;
    case 'finalscore': html = renderFinalScore(); break;
    case 'front9score': html = renderFront9Score(); break;
    case 'reports': html = renderReports(); break;
    default: html = '<div class="screen"><p>Loading…</p></div>';
  }
  appEl.innerHTML = html + menuOverlayHTML();
  attachHandlers();
}

// Shared topbar markup (logo + hamburger menu button) — every screen except
// Onboarding uses this exact markup (Pass 6 Fix 3 wires the ⋮ button up to a
// real slide-out menu; previously decorative/non-interactive, per Session 7).
function topbarHTML() {
  return `
    <div class="topbar"><img class="brand-logo" src="assets/Logos/mt_paul_logo_vector.svg" alt="Mt. Paul Golf Course" />
      <button class="icon-btn" id="btn-menu" aria-label="Menu">&#8942;</button></div>
  `;
}

// Pass 6 Fix 3: real slide-out hamburger menu — a fixed backdrop + panel
// rendered on top of whatever screen is currently showing, toggled via
// state.menuOpen. Appended alongside (not instead of) the current screen's
// html in render() above, so it's available from every screen with a
// topbar without making the menu screen-specific. Closing it (✕ or backdrop
// tap) without picking a nav item leaves state.screen/state.draft/
// state.currentRound completely untouched — it's purely an overlay.
function menuOverlayHTML() {
  if (!state.menuOpen) return '';
  return `
    <div class="menu-scrim" id="menu-scrim"></div>
    <div class="menu-flyout" id="menu-flyout">
      <div class="menu-header">
        <span class="menu-label">Menu</span>
        <button class="menu-close" id="menu-close" aria-label="Close menu">&times;</button>
      </div>
      <button class="menu-item" id="menu-item-analytics">Analytics</button>
      <button class="menu-item" id="menu-item-play">Play Round</button>
      <button class="menu-item menu-item-last" id="menu-item-settings">Settings</button>
    </div>
  `;
}

// Pass 6 Fix 7: shared birdie/bogey/double-bogey+ scorecard cell styling —
// the ONE place these thresholds live, used by both renderFinalScore() and
// renderFront9Score() so neither can drift out of sync with the other.
//   score < par        -> birdie: circled digit
//   score === par + 1   -> bogey: boxed/squared digit
//   score >= par + 2    -> double-bogey-or-worse: tinted cell background
//   score === par       -> plain, no decoration
function scoreCellHTML(score, par) {
  if (par == null) return `<td>${score}</td>`;
  if (score < par) return `<td><span class="score-circle">${score}</span></td>`;
  if (score === par + 1) return `<td><span class="score-square">${score}</span></td>`;
  if (score >= par + 2) return `<td class="score-tint">${score}</td>`;
  return `<td>${score}</td>`;
}

// ===================== Screen: Onboarding =====================

function renderOnboarding() {
  return `
    <div class="screen onboarding-screen" style="background-image: linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.75)), url('assets/00-Start.png'); background-size: cover; background-position: center;">
      <div class="onboarding-title-block">
        <div class="subtitle">SOMETIMES</div>
        <h1>Bogey</h1>
        <div class="onboarding-credits">
          <div>Starring Pat,<br>Dave, May, Mike,<br>Morgan, Titley</div>
          <div>An Out of Bounds Film<br>Music Score by Birdie</div>
          <div>Les Putts Director<br>An 18 Hole Production</div>
        </div>
      </div>
      <div class="onboarding-cta">
        <button class="btn" id="btn-start">Start</button>
      </div>
    </div>
  `;
}

// ===================== Screen: Setup / Settings (Pass 3) =====================
//
// Same screen either way (mockup itself is titled "SETTINGS" — see Design
// Handoff/Design-Screens/02-setup.png); `state.screen === 'setup'` covers both
// first-run onboarding entry and Home > Settings entry (state.fromSettings
// just distinguishes intent, not layout).

function renderSetup() {
  const s = state.settings || {};
  const name = s.playerName || '';
  const tee = s.teePref || 'blue';
  const statsOn = s.statsTrackingEnabled !== false;
  const lightOn = s.lightMode !== false; // default true (Light Mode), per settings-record.js
  const membershipFeeVal = formatFeeForInput(s.membershipFee);
  const greenFeeVal = formatFeeForInput(s.greenFee);
  const weatherText = [weatherState.temp, weatherState.wind].filter(Boolean).join(' · ');

  return `
    <div class="screen">
      ${topbarHTML()}
      <h1 style="margin-bottom:6px;">Settings</h1>
      <div class="weather-readout" id="weather-readout">${weatherText}</div>
      <div class="card">
        <div class="field">
          <label for="input-name">Name</label>
          <input type="text" id="input-name" value="${escapeAttr(name)}" placeholder="Your name" />
        </div>
        <div class="row-toggle">
          <span class="toggle-label ${lightOn ? 'dim' : ''}">Dark Mode</span>
          <div class="switch mode ${lightOn ? 'state-b' : 'state-a'}" id="toggle-mode">
            <div class="knob"></div>
          </div>
          <span class="toggle-label ${lightOn ? '' : 'dim'}">Light Mode</span>
        </div>
        <div class="row-toggle">
          <span class="toggle-label ${tee === 'blue' ? '' : 'dim'}">Blue Tees</span>
          <div class="switch tee ${tee === 'blue' ? 'state-a' : 'state-b'}" id="toggle-tee">
            <div class="knob"></div>
          </div>
          <span class="toggle-label ${tee === 'red' ? '' : 'dim'}">Red Tees</span>
        </div>
        <div class="row-toggle">
          <span class="toggle-label ${statsOn ? '' : 'dim'}">Show Stats</span>
          <div class="switch ${statsOn ? 'state-a' : 'state-b'}" id="toggle-stats">
            <div class="knob"></div>
          </div>
          <span class="toggle-label ${!statsOn ? '' : 'dim'}">Hide Stats</span>
        </div>
        <div class="field" style="margin-top:8px;">
          <label for="input-membership-fee">Membership Fee</label>
          <input type="text" inputmode="decimal" id="input-membership-fee" value="${escapeAttr(membershipFeeVal)}" placeholder="$1,450" />
          <p class="field-help">Used to calculate your break-even point and savings in Reports.</p>
        </div>
        <div class="field" style="margin-bottom:6px;">
          <label for="input-green-fee">Green Fees</label>
          <input type="text" inputmode="decimal" id="input-green-fee" value="${escapeAttr(greenFeeVal)}" placeholder="$45" />
          <p class="field-help">Per-round rate for 18 holes, used as the non-member comparison in Reports.</p>
        </div>
        <div class="export-row">
          <div class="export-row-text">
            <span class="toggle-label">Export Scores</span>
            <p class="field-help">Creates a CSV File to import into Numbers, ideal for iCloud backup.</p>
          </div>
          <button class="icon-square-btn" id="btn-export-scores" aria-label="Export scores (coming soon)" title="Coming soon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3v12"/><path d="M6 11l6 6 6-6"/><path d="M5 21h14"/>
            </svg>
          </button>
        </div>
      </div>
      <div style="margin-top:auto;">
        <button class="btn" id="btn-save-setup">Save</button>
      </div>
    </div>
  `;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ===================== Screen: Home =====================

function renderHome() {
  const settings = state.settings || {};
  const cr = state.currentRound;
  const resuming = cr && Array.isArray(cr.holes) && cr.holes.length < cr.sessionLength;
  const pending = readJSON(KEYS.PENDING_NINE, null);

  let mainAction = '';
  if (resuming) {
    const nextHoleNum = cr.startHoleNum + cr.holes.length;
    mainAction = `
      <button class="btn" id="btn-resume">Resume Round — Hole ${nextHoleNum}</button>
      <button class="btn ghost" id="btn-discard-inprogress" style="margin-top:10px;">End / discard round in progress</button>
    `;
  } else if (pending) {
    const otherHalf = pending.half === 'front' ? 'back' : 'front';
    const otherHalfLabel = otherHalf === 'front' ? 'Front 9 (holes 1-9)' : 'Back 9 (holes 10-18)';
    const dateLabel = new Date(pending.date).toLocaleDateString('en-CA');
    mainAction = `
      <div class="pending-card">
        <div class="pending-title">Unfinished ${pending.half === 'front' ? 'Front' : 'Back'} 9</div>
        <p>Played ${dateLabel} — score ${pending.nineScore}. Play the ${otherHalfLabel} to complete this round.</p>
        <button class="btn" id="btn-play-other-nine">Play ${otherHalf === 'front' ? 'Front' : 'Back'} 9 to Finish</button>
        <button class="btn ghost" id="btn-discard-pending" style="margin-top:8px;">Discard this nine</button>
      </div>
      <div class="btn-row" style="margin-top:6px;">
        <button class="btn secondary" id="btn-play-18">Play 18 Holes</button>
        <button class="btn secondary" id="btn-play-9">Play 9 Holes</button>
      </div>
    `;
  } else {
    mainAction = `
      <button class="btn" id="btn-play-18">Play 18 Holes</button>
      <button class="btn secondary" id="btn-play-9" style="margin-top:10px;">Play 9 Holes</button>
    `;
  }

  return `
    <div class="screen">
      ${topbarHTML()}
      <div class="home-hero">
        <h1>A Bit of Bogey</h1>
        ${settings.playerName ? `<div class="player-name">Welcome back, ${escapeAttr(settings.playerName)}</div>` : ''}
      </div>
      ${mainAction}
      <div class="home-links">
        <a href="#" id="link-reports">Reports</a>
        <a href="#" id="link-settings">Settings</a>
      </div>
    </div>
  `;
}

// ===================== Screen: Hole =====================

function renderHole() {
  const d = state.draft;
  const cr = state.currentRound;
  const blueHoles = courseData ? getHolesForTee(courseData, 'blue') : [];
  const redHoles = courseData ? getHolesForTee(courseData, 'red') : [];
  const blueInfo = blueHoles.find((h) => h.holeNum === d.holeNum) || {};
  const redInfo = redHoles.find((h) => h.holeNum === d.holeNum) || {};
  const isLastOfSession = (cr.holes.length + 1) >= cr.sessionLength;
  const playerName = cr.playerName || '';
  const nextLabel = isLastOfSession ? 'Finish' : ('Play It' + (playerName ? ' ' + playerName.split(' ')[0] : ''));
  // Pass 6 Fix 5: every hole 2-18 gets a Back button alongside Next — except
  // the very first hole played in this session (nothing committed yet in
  // currentRound.holes, so there's nothing to go back to). This is based on
  // holes played this session, not literally holeNum === 1, so a standalone
  // back-9 session (starts at Hole 10 with zero holes committed) also
  // correctly gets no Back button on its first hole.
  const showBack = cr.holes.length > 0;

  const photoNum = pad2(d.holeNum);

  return `
    <div class="screen">
      ${topbarHTML()}
      <div class="hole-top-row">
        <div class="hole-header">
          <h1>Hole ${d.holeNum} · Par ${d.par}</h1>
        </div>
        <div class="hole-yardages">
          <span class="yard"><span class="dot blue"></span>${blueInfo.yardage || ''}</span>
          <span class="yard"><span class="dot red"></span>${redInfo.yardage || ''}</span>
        </div>
      </div>
      <div class="score-row">
        <button class="score-btn" id="score-minus" aria-label="Decrease score">−</button>
        <div class="score-value" id="score-value">${d.score}</div>
        <button class="score-btn" id="score-plus" aria-label="Increase score">+</button>
      </div>
      <div class="rockers-row">
        ${rockerHTML('fir', 'FIR', d.fir)}
        ${rockerHTML('gir', 'GIR', d.gir)}
        ${rockerHTML('pen', 'PEN', d.pen)}
        ${rockerHTML('ud', 'UD', d.ud)}
        ${puttsColumnHTML(d.putts)}
      </div>
      <div class="hole-photo" style="background-image:url('assets/${photoNum}-Hole.png');"></div>
      <div class="btn-row">
        ${showBack ? '<button class="btn secondary" id="btn-back-hole">Back</button>' : ''}
        <button class="btn" id="btn-next-hole">${nextLabel}</button>
      </div>
      <div class="quit-link"><button id="btn-quit">Quit</button></div>
    </div>
  `;
}

// Pass 6 Fix 1: Stats Console rebuild — ported field-for-field from the
// reference component (Design Handoff/Stats Counter.dc.html). The track
// (.rocker-pill) is ALWAYS rgba(0,0,0,.4) regardless of on/off state; only
// the knob moves (top: TOGGLE_KNOB_ON_POS/OFF_POS) and recolors (TOGGLE_ON_
// GRADIENT/OFF_GRADIENT + matching shadow), all four constants imported
// directly from js/stats-defaults.js — the one place they're allowed to
// live, per the standing "don't touch stats-defaults.js" instruction; this
// file only ever reads them. The label itself dims/brightens with the same
// on/off state (full-strength when achieved, rgba(...,.45) when not) via the
// `.rocker-label.on` / plain `.rocker-label` CSS rule in styles.css, which
// also branches on body.dark-mode for the two color pairs the reference's
// `light` prop selects between.
function rockerHTML(key, label, on) {
  const knobTop = on ? TOGGLE_KNOB_ON_POS : TOGGLE_KNOB_OFF_POS;
  const knobBg = on ? TOGGLE_ON_GRADIENT : TOGGLE_OFF_GRADIENT;
  const knobShadow = on ? TOGGLE_ON_SHADOW : TOGGLE_OFF_SHADOW;
  return `
    <div class="rocker-col">
      <div class="rocker-lift">
        <button class="rocker-pill" data-key="${key}" id="rocker-${key}" aria-label="${label}" aria-pressed="${on ? 'true' : 'false'}">
          <span class="knob" style="top:${knobTop};background:${knobBg};box-shadow:${knobShadow};"></span>
        </button>
        <span class="rocker-label${on ? ' on' : ''}">${label}</span>
      </div>
    </div>
  `;
}

// Putts column (Fix 1): up-arrow -> white rounded value box (Spline Sans Mono
// digit) -> "PUTTS" label -> down-arrow, all CSS-triangle arrows in #6B7C85,
// occupying the 5th equal grid column alongside the four rockers above so
// every column (including this one) bottom-aligns its label on the same
// shared baseline (see .rockers-row's `align-items: end` + each column's
// height:100%/justify-content:flex-end wrapper in styles.css) — the "label
// baseline rule" the reference component encodes via two different
// translateY lift amounts (rockers lift further than the shorter Putts
// stepper) so both groups' labels land on the exact same line despite very
// different internal column heights.
function puttsColumnHTML(putts) {
  return `
    <div class="rocker-col">
      <div class="putts-lift">
        <button class="putts-arrow" id="putts-plus" aria-label="Increase putts">
          <span class="tri tri-up"></span>
        </button>
        <div class="putts-box"><span class="putts-value">${putts}</span></div>
        <span class="rocker-label on">Putts</span>
        <button class="putts-arrow putts-arrow-down" id="putts-minus" aria-label="Decrease putts">
          <span class="tri tri-down"></span>
        </button>
      </div>
    </div>
  `;
}

// ===================== Screen: Final Score =====================

function renderFinalScore() {
  const cr = state.currentRound;
  const preview = buildRoundRecord({
    date: new Date().toISOString(),
    playerName: cr.playerName,
    tee: cr.tee,
    holes: cr.holes
  });
  const front = preview.holes.slice(0, 9);
  const back = preview.holes.slice(9, 18);

  const holeRowCells = (arr) => arr.map((h) => `<th>${h.holeNum}</th>`).join('');
  const parRowCells = (arr) => arr.map((h) => `<td>${h.par}</td>`).join('');
  const scoreRowCells = (arr) => arr.map((h) => scoreCellHTML(h.score, h.par)).join('');

  return `
    <div class="screen">
      ${topbarHTML()}
      <div class="final-score-header">
        <h1>Final Score</h1>
        <div class="total-score">${preview.totalScore}</div>
      </div>
      <table class="scorecard">
        <thead><tr class="holes-row"><th>H</th>${holeRowCells(front)}<th class="total">Out</th></tr></thead>
        <tbody>
          <tr class="par-row"><td>Par</td>${parRowCells(front)}<td class="total">${preview.front9Score != null ? front.reduce((s, h) => s + h.par, 0) : ''}</td></tr>
          <tr class="score-row-data"><td>${escapeAttr((cr.playerName || 'You').split(' ')[0])}</td>${scoreRowCells(front)}<td class="total">${preview.front9Score}</td></tr>
        </tbody>
        <thead><tr class="holes-row"><th>H</th>${holeRowCells(back)}<th class="total">In</th></tr></thead>
        <tbody>
          <tr class="par-row"><td>Par</td>${parRowCells(back)}<td class="total">${back.reduce((s, h) => s + h.par, 0)}</td></tr>
          <tr class="score-row-data"><td>${escapeAttr((cr.playerName || 'You').split(' ')[0])}</td>${scoreRowCells(back)}<td class="total">${preview.back9Score}</td></tr>
        </tbody>
      </table>
      <div class="hole-photo" style="background-image:url('assets/00-Bogey-Screen.png'); min-height:200px;"></div>
      <div class="btn-row">
        <button class="btn secondary" id="btn-back-to-hole18">Back</button>
        <button class="btn" id="btn-save-final">Save</button>
      </div>
    </div>
  `;
}

// ===================== Screen: Front 9 Score (Pass 6 Fix 6) =====================
//
// Shown after Hole 9 completes, in BOTH an 18-hole session mid-flight and a
// deliberate standalone 9-hole session — see commitHoleAndAdvance() for the
// routing. Two cases, distinguished by cr.sessionLength:
//   Case A (sessionLength === 18): a real Continue/Quit toggle. Continue
//     advances into Hole 10; Quit runs the same save-as-widow flow a mid-
//     round Quit already uses (half: 'front').
//   Case B (sessionLength === 9): a deliberate standalone nine has nothing to
//     "continue" to, so no toggle is shown — Next is relabeled "Post Now" and
//     always runs the save flow (this is exactly today's finishSession()
//     behavior for a 9-hole session, just shown as a reviewable scorecard
//     first instead of happening silently).
// Back (either case) pops Hole 9 back into the draft for editing — the
// Hole-10-only Back exception lives in goBackFromHole(), not here.
function renderFront9Score() {
  const cr = state.currentRound;
  const front = cr.holes.slice(0, 9); // exactly the 9 just-committed entries
  const totalScore = front.reduce((s, h) => s + h.score, 0);
  const parTotal = front.reduce((s, h) => s + h.par, 0);

  const holeRowCells = front.map((h) => `<th>${h.holeNum}</th>`).join('');
  const parRowCells = front.map((h) => `<td>${h.par}</td>`).join('');
  const scoreRowCells = front.map((h) => scoreCellHTML(h.score, h.par)).join('');

  const isStandaloneNine = cr.sessionLength === 9;
  const continueOn = state.front9Continue !== false;

  const toggleOrPostNowHTML = isStandaloneNine
    ? `<div class="row-toggle" style="border-bottom:none; justify-content:center;">
        <span class="toggle-label">Post Now</span>
      </div>`
    : `<div class="row-toggle" style="border-bottom:none; justify-content:center; gap:14px;">
        <span class="toggle-label ${continueOn ? '' : 'dim'}">Continue</span>
        <div class="switch ${continueOn ? 'state-a' : 'state-b'}" id="toggle-front9">
          <div class="knob"></div>
        </div>
        <span class="toggle-label ${continueOn ? 'dim' : ''}">Quit</span>
      </div>`;

  return `
    <div class="screen">
      ${topbarHTML()}
      <div class="final-score-header">
        <h1>Front 9 Score</h1>
        <div class="total-score">${totalScore}</div>
      </div>
      <table class="scorecard">
        <thead><tr class="holes-row"><th>H</th>${holeRowCells}<th class="total">Out</th></tr></thead>
        <tbody>
          <tr class="par-row"><td>Par</td>${parRowCells}<td class="total">${parTotal}</td></tr>
          <tr class="score-row-data"><td>${escapeAttr((cr.playerName || 'You').split(' ')[0])}</td>${scoreRowCells}<td class="total">${totalScore}</td></tr>
        </tbody>
      </table>
      ${toggleOrPostNowHTML}
      <div class="hole-photo" style="background-image:url('assets/09-Score-Card.png'); min-height:200px;"></div>
      <div class="btn-row">
        <button class="btn secondary" id="btn-front9-back">Back</button>
        <button class="btn" id="btn-front9-next">${isStandaloneNine ? 'Post Now' : 'Next'}</button>
      </div>
    </div>
  `;
}

// ===================== Screen: Reports / Analytics (Pass 2) =====================
//
// Every number here comes from buildAnalytics() in js/stats.js, recomputed
// fresh from `rounds-history` on every render — nothing is a stored running
// total. See Design Handoff/README.md section 4/5 for the stat table and
// empty-state rules this implements.

function renderReports() {
  const roundsHistory = readJSON(KEYS.ROUNDS_HISTORY, []);
  const settings = state.settings || {};
  const a = buildAnalytics(roundsHistory, settings, handicapData);
  // Use weeklyNewSlotIndex to render this render's grow-in animation (if
  // any), then mark it seen so a later re-render/re-visit doesn't replay it.
  if (a.weeklyVisible && a.weeklyNewSlotIndex !== -1) {
    markWeekAnimated(a.weekly.birdie[a.weeklyNewSlotIndex].weekStart);
  }

  const body = a.hasAnyRounds ? reportsFullHTML(a) : reportsEmptyHTML();
  // "Jul 23 2026" style — matches Design-Screens/06-analytics.png's dateline
  // under the title (no comma). Presentation-only; not read back anywhere.
  const now = new Date();
  const monthAbbrev = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][now.getMonth()];
  const asOfDate = `${monthAbbrev} ${now.getDate()} ${now.getFullYear()}`;

  return `
    <div class="screen reports-screen">
      ${topbarHTML()}
      <h1 style="margin-bottom:4px;">Analytics</h1>
      <div class="report-date">${asOfDate}</div>
      ${body}
      <div style="margin-top:24px;">
        <button class="btn secondary" id="btn-reports-home">Home</button>
      </div>
    </div>
  `;
}

// --- Small formatting helpers ---
function fmtNum(v, decimals = 1, fallback = '—') {
  return v === null || v === undefined ? fallback : v.toFixed(decimals);
}
function fmtSigned(v, decimals = 1, fallback = '—') {
  if (v === null || v === undefined) return fallback;
  return (v >= 0 ? '+' : '') + v.toFixed(decimals);
}

// A simple 4-column bar chart (Birdie/Par/Bogey/Bogey+ style), pct-driven.
function barRowHTML(items) {
  const max = Math.max(1, ...items.map((i) => i.pct));
  return `<div class="bar-row">${items.map((i) => `
    <div class="bar-col">
      <div class="bar" style="height:${Math.max(4, Math.round((i.pct / max) * 100))}px;"></div>
      <div class="bar-value">${i.pct}%</div>
      <div class="bar-label">${i.label}</div>
    </div>`).join('')}</div>`;
}

// Score-differential bars for Best 8 of Last 20.
function diffBarRowHTML(diffs) {
  const maxAbs = Math.max(1, ...diffs.map((d) => Math.abs(d)));
  return `<div class="bar-row scroll">${diffs.map((d) => `
    <div class="bar-col">
      <div class="bar" style="height:${Math.max(4, Math.round((Math.abs(d) / maxAbs) * 90))}px;"></div>
      <div class="bar-value">${d.toFixed(1)}</div>
    </div>`).join('')}</div>`;
}

// 18-hole "avg strokes over par" bar chart, horizontally scrollable.
function holeRatingBarsHTML(holeRatings) {
  const maxAbs = Math.max(0.1, ...holeRatings.map((h) => Math.abs(h.avgOverPar || 0)));
  return `<div class="bar-row scroll">${holeRatings.map((h) => {
    const v = h.avgOverPar;
    const label = v === null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1);
    const height = v === null ? 4 : Math.max(4, Math.round((Math.abs(v) / maxAbs) * 90));
    const goodCls = v !== null && v < 0 ? ' bar-good' : '';
    const emptyCls = v === null ? ' bar-empty' : '';
    return `
      <div class="bar-col">
        <div class="bar${goodCls}${emptyCls}" style="height:${height}px;"></div>
        <div class="bar-value">${label}</div>
        <div class="bar-label">${h.holeNum}</div>
      </div>`;
  }).join('')}</div>`;
}

// Design-Screens/06-analytics.png ("BIRDIES EACH WEEK" etc, see also 18-23
// "Weekly Reveal") shows each metric as its own full-width titled chart, not
// a single "Weekly Trends" card with four compact rows (Pass 2's original
// layout) — Pass 4 restructured the markup to match, reusing the same
// gated/derived-fresh data from js/stats.js untouched.
const WEEKLY_METRIC_LABELS = { birdie: 'Birdies', par: 'Pars', bogey: 'Bogeys', bogeyPlus: 'Bogey+' };

function weeklySectionHTML(weekly, newSlotIndex) {
  return ['birdie', 'par', 'bogey', 'bogeyPlus'].map((key) => {
    const slots = weekly[key];
    const max = Math.max(1, ...slots.map((s) => (s.hasData ? s.count : 0)));
    const bars = slots.map((s, i) => `
      <div class="bar-col">
        <div class="bar${s.hasData ? '' : ' bar-empty'}${i === newSlotIndex ? ' bar-new' : ''}" style="height:${s.hasData ? Math.max(4, Math.round((s.count / max) * 100)) : 4}px;"></div>
        <div class="bar-value">${s.hasData ? s.count : '—'}</div>
        <div class="bar-label">${s.label}</div>
      </div>`).join('');
    return `
      <div class="report-section">
        <h2 class="report-heading">${WEEKLY_METRIC_LABELS[key]} Each Week</h2>
        <div class="bar-row">${bars}</div>
      </div>`;
  }).join('');
}

function todaysStatsHTML(t) {
  const dateLabel = new Date(t.date).toLocaleDateString('en-CA');
  return `
    <div class="report-section">
      <h2 class="report-heading">Today's Stats <span class="report-sub">${dateLabel} · Score ${t.totalScore}</span></h2>
      ${barRowHTML([
        { label: 'Birdie', pct: t.birdie.pct },
        { label: 'Par', pct: t.par.pct },
        { label: 'Bogey', pct: t.bogey.pct },
        { label: 'Bogey+', pct: t.bogeyPlus.pct }
      ])}
      <table class="stat-table">
        <tr><td>FIR</td><td>${t.fir.pct}%</td></tr>
        <tr><td>GIR</td><td>${t.gir.pct}%</td></tr>
        <tr><td>Putts</td><td>${t.putts}</td></tr>
      </table>
    </div>`;
}

function membershipROIHTML(roi) {
  const savedLabel = roi.cumulativeSavings >= 0 ? 'Saved So Far' : 'Behind By';
  return `
    <div class="report-section">
      <h2 class="report-heading">Membership ROI</h2>
      <table class="stat-table">
        <tr><td>Rounds Played</td><td>${roi.roundsPlayed}</td></tr>
        <tr><td>${savedLabel}</td><td>$${Math.abs(roi.cumulativeSavings).toFixed(2)}</td></tr>
        <tr><td>Rounds to Break Even</td><td>${roi.roundsToBreakEven}</td></tr>
      </table>
    </div>`;
}

function reportsEmptyHTML() {
  return `
    <div class="empty-state">Play your first round to see stats here.</div>
    <div class="report-section">
      <h2 class="report-heading">Season Stats</h2>
      <p class="section-empty">Play your first round to see stats.</p>
    </div>
    <div class="report-section">
      <h2 class="report-heading">Score Distribution</h2>
      <p class="section-empty">Play your first round to see stats.</p>
    </div>
    <div class="report-section">
      <h2 class="report-heading">Handicap Index</h2>
      <p class="section-empty">Play your first round to calculate your Handicap Index.</p>
    </div>
    <div class="report-section">
      <h2 class="report-heading">Hole Ratings</h2>
      <p class="section-empty">Play a round to see hole-by-hole ratings.</p>
    </div>
    <div class="report-section">
      <h2 class="report-heading">Scrambling &amp; Putting</h2>
      <p class="section-empty">No PEN, putts, or scrambling data logged yet.</p>
    </div>
  `;
}

function reportsFullHTML(a) {
  const windowLabel = 'Last ' + Math.min(a.roundsCount, 20) + ' round' + (Math.min(a.roundsCount, 20) === 1 ? '' : 's');

  const seasonStats = `
    <div class="report-section">
      <h2 class="report-heading">Season Stats <span class="report-sub">${windowLabel}</span></h2>
      <div class="stat-tile-grid">
        <div class="stat-tile"><div class="stat-tile-value">${fmtNum(a.season.scoringAvg)}</div><div class="stat-tile-label">Scoring Avg</div></div>
        <div class="stat-tile"><div class="stat-tile-value">${a.season.bestRound ?? '—'}</div><div class="stat-tile-label">Best Round</div></div>
        <div class="stat-tile"><div class="stat-tile-value">${a.season.worstRound ?? '—'}</div><div class="stat-tile-label">Worst Round</div></div>
        <div class="stat-tile"><div class="stat-tile-value">${fmtNum(a.season.puttsPerRound)}</div><div class="stat-tile-label">Putts/Rnd</div></div>
        <div class="stat-tile"><div class="stat-tile-value">${a.season.fir.pct}%</div><div class="stat-tile-label">FIR</div></div>
        <div class="stat-tile"><div class="stat-tile-value">${a.season.gir.pct}%</div><div class="stat-tile-label">GIR</div></div>
      </div>
    </div>`;

  const scoreDistribution = `
    <div class="report-section">
      <h2 class="report-heading">Score Distribution <span class="report-sub">${windowLabel}</span></h2>
      ${barRowHTML([
        { label: 'Birdie', pct: a.scoreDistribution.birdie.pct },
        { label: 'Par', pct: a.scoreDistribution.par.pct },
        { label: 'Bogey', pct: a.scoreDistribution.bogey.pct },
        { label: 'Bogey+', pct: a.scoreDistribution.bogeyPlus.pct }
      ])}
    </div>`;

  const handicapSection = `
    <div class="report-section">
      <h2 class="report-heading">Handicap Index</h2>
      <div class="handicap-readout">${a.handicap !== null ? a.handicap.toFixed(1) : '—'}</div>
      <div class="report-sub" style="margin-bottom:8px;">Best 8 Score Differentials of Last 20 Rounds</div>
      ${a.best8Differentials.length
        ? diffBarRowHTML(a.best8Differentials)
        : '<p class="section-empty">No rounds on a recognized tee yet — Score Differential needs Course Rating/Slope from your tee.</p>'}
    </div>`;

  const twentyRoundAvg = `
    <div class="report-section">
      <h2 class="report-heading">20 Round Average</h2>
      <table class="stat-table">
        <tr><td>FIR</td><td>${a.twentyRoundAvg.fir.pct}%</td></tr>
        <tr><td>GIR</td><td>${a.twentyRoundAvg.gir.pct}%</td></tr>
        <tr><td>PEN</td><td>${a.twentyRoundAvg.pen.pct}%</td></tr>
      </table>
    </div>`;

  const holeRatings = `
    <div class="report-section">
      <h2 class="report-heading">Hole Ratings <span class="report-sub">Avg strokes vs par, ${windowLabel.toLowerCase()}</span></h2>
      ${holeRatingBarsHTML(a.holeRatings)}
    </div>`;

  const scramblingPutting = `
    <div class="report-section">
      <h2 class="report-heading">Scrambling &amp; Putting <span class="report-sub">All-time</span></h2>
      <table class="stat-table">
        <tr><td>Scrambling %</td><td>${a.scrambling.pct}%</td></tr>
        <tr><td>Putts per GIR</td><td>${fmtNum(a.puttsSplit.gir)}</td></tr>
        <tr><td>Putts per Missed GIR</td><td>${fmtNum(a.puttsSplit.nonGir)}</td></tr>
        <tr><td>Up-and-Down %</td><td>${a.udOnMissedGir.pct}%</td></tr>
        <tr><td>Penalty Impact</td><td>${a.penaltyImpact.withPen === null ? 'No PEN logged yet' : fmtSigned(a.penaltyImpact.withPen)}</td></tr>
        <tr><td>No-Penalty Avg</td><td>${fmtSigned(a.penaltyImpact.withoutPen)}</td></tr>
        <tr><td>1-Putt %</td><td>${a.puttDistribution.onePutt.pct}%</td></tr>
        <tr><td>2-Putt %</td><td>${a.puttDistribution.twoPutt.pct}%</td></tr>
        <tr><td>3-Putt+ %</td><td>${a.puttDistribution.threePuttPlus.pct}%</td></tr>
      </table>
    </div>`;

  const weeklyTrends = a.weeklyVisible
    ? weeklySectionHTML(a.weekly, a.weeklyNewSlotIndex)
    : ['Birdies', 'Pars', 'Bogeys', 'Bogey+'].map((label) => `
    <div class="report-section">
      <h2 class="report-heading">${label} Each Week</h2>
      <p class="section-empty">Play one more round (2 total) to unlock weekly trends.</p>
    </div>`).join('');

  const todaysStats = a.todaysVisible && a.todaysStats ? todaysStatsHTML(a.todaysStats) : '';

  const membershipRoi = a.roi
    ? membershipROIHTML(a.roi)
    : `
    <div class="report-section">
      <h2 class="report-heading">Membership ROI</h2>
      <p class="section-empty">Set up your membership fee and green fee in Settings to see savings.</p>
    </div>`;

  return seasonStats + todaysStats + scoreDistribution + handicapSection + twentyRoundAvg
    + holeRatings + scramblingPutting + weeklyTrends + membershipRoi;
}

// ===================== Event wiring =====================

function attachHandlers() {
  switch (state.screen) {
    case 'onboarding': {
      const btn = document.getElementById('btn-start');
      if (btn) btn.addEventListener('click', () => { state.screen = 'setup'; render(); });
      break;
    }
    case 'setup': {
      const modeToggle = document.getElementById('toggle-mode');
      const teeToggle = document.getElementById('toggle-tee');
      const statsToggle = document.getElementById('toggle-stats');
      let teePref = (state.settings && state.settings.teePref) || 'blue';
      let statsOn = state.settings ? state.settings.statsTrackingEnabled !== false : true;
      let lightOn = state.settings ? state.settings.lightMode !== false : true;

      if (modeToggle) {
        modeToggle.addEventListener('click', () => {
          lightOn = !lightOn;
          modeToggle.classList.toggle('state-b', lightOn);
          modeToggle.classList.toggle('state-a', !lightOn);
          const labels = modeToggle.parentElement.querySelectorAll('.toggle-label');
          labels[0].classList.toggle('dim', lightOn);  // "Dark Mode" label dims when Light is active
          labels[1].classList.toggle('dim', !lightOn); // "Light Mode" label dims when Dark is active
          // Flip the theme immediately on tap — don't wait for Save/reload.
          applyDarkModeClass(!lightOn);
        });
      }
      if (teeToggle) {
        teeToggle.addEventListener('click', () => {
          teePref = teePref === 'blue' ? 'red' : 'blue';
          teeToggle.classList.toggle('state-a', teePref === 'blue');
          teeToggle.classList.toggle('state-b', teePref === 'red');
          const labels = teeToggle.parentElement.querySelectorAll('.toggle-label');
          labels[0].classList.toggle('dim', teePref !== 'blue');
          labels[1].classList.toggle('dim', teePref !== 'red');
        });
      }
      if (statsToggle) {
        statsToggle.addEventListener('click', () => {
          statsOn = !statsOn;
          statsToggle.classList.toggle('state-a', statsOn);
          statsToggle.classList.toggle('state-b', !statsOn);
          const labels = statsToggle.parentElement.querySelectorAll('.toggle-label');
          labels[0].classList.toggle('dim', !statsOn);
          labels[1].classList.toggle('dim', statsOn);
        });
      }
      const exportBtn = document.getElementById('btn-export-scores');
      if (exportBtn) {
        // CSV import/export is a later phase (per project owner) — this is
        // intentionally non-functional for Pass 3. No CSV logic is wired.
        exportBtn.addEventListener('click', () => {
          showToast('Export coming soon');
        });
      }
      const saveBtn = document.getElementById('btn-save-setup');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const nameInput = document.getElementById('input-name');
          const feeInput = document.getElementById('input-membership-fee');
          const greenInput = document.getElementById('input-green-fee');
          saveSetup({
            playerName: (nameInput && nameInput.value.trim()) || '',
            teePref,
            statsTrackingEnabled: statsOn,
            lightMode: lightOn,
            membershipFee: parseFeeInput(feeInput && feeInput.value),
            greenFee: parseFeeInput(greenInput && greenInput.value)
          });
        });
      }
      // Fire-and-forget: updates #weather-readout in place once it resolves,
      // no-ops silently on failure (see fetchWeather()'s try/catch above).
      fetchWeather();
      break;
    }
    case 'home': {
      const play18 = document.getElementById('btn-play-18');
      const play9 = document.getElementById('btn-play-9');
      const resume = document.getElementById('btn-resume');
      const discardInProgress = document.getElementById('btn-discard-inprogress');
      const playOtherNine = document.getElementById('btn-play-other-nine');
      const discardPending = document.getElementById('btn-discard-pending');
      const reportsLink = document.getElementById('link-reports');
      const settingsLink = document.getElementById('link-settings');

      if (play18) play18.addEventListener('click', () => startRound({ startHoleNum: 1, sessionLength: 18 }));
      if (play9) play9.addEventListener('click', () => startRound({ startHoleNum: 1, sessionLength: 9 }));
      if (resume) resume.addEventListener('click', () => resumeIntoHoleScreen());
      if (discardInProgress) discardInProgress.addEventListener('click', () => quitCurrentRound());
      if (playOtherNine) {
        playOtherNine.addEventListener('click', () => {
          const pending = readJSON(KEYS.PENDING_NINE, null);
          const otherHalf = pending && pending.half === 'front' ? 'back' : 'front';
          startRound({ startHoleNum: otherHalf === 'front' ? 1 : 10, sessionLength: 9 });
        });
      }
      if (discardPending) discardPending.addEventListener('click', () => discardPendingNine());
      if (reportsLink) reportsLink.addEventListener('click', (e) => { e.preventDefault(); state.screen = 'reports'; render(); });
      if (settingsLink) settingsLink.addEventListener('click', (e) => { e.preventDefault(); state.fromSettings = true; state.screen = 'setup'; render(); });
      break;
    }
    case 'hole': {
      const d = state.draft;
      const scoreMinus = document.getElementById('score-minus');
      const scorePlus = document.getElementById('score-plus');
      const puttsMinus = document.getElementById('putts-minus');
      const puttsPlus = document.getElementById('putts-plus');
      const nextBtn = document.getElementById('btn-next-hole');
      const backBtn = document.getElementById('btn-back-hole');
      const quitBtn = document.getElementById('btn-quit');

      if (scoreMinus) scoreMinus.addEventListener('click', () => {
        d.score = Math.max(1, d.score - 1);
        document.getElementById('score-value').textContent = d.score;
      });
      if (scorePlus) scorePlus.addEventListener('click', () => {
        d.score = Math.min(15, d.score + 1);
        document.getElementById('score-value').textContent = d.score;
      });
      if (puttsMinus) puttsMinus.addEventListener('click', () => {
        d.putts = Math.max(0, d.putts - 1);
        renderHoleStatOnly();
      });
      if (puttsPlus) puttsPlus.addEventListener('click', () => {
        d.putts = Math.min(9, d.putts + 1);
        renderHoleStatOnly();
      });
      // Pass 6 Fix 1: toggling a rocker now changes three things at once
      // (knob top/background/shadow inline styles + the label's dim/bright
      // class) rather than a single class flip, so a full re-render is the
      // simplest correct way to keep all three in sync — same pattern the
      // hamburger menu and Front 9 Continue/Quit toggle already use.
      ['fir', 'gir', 'pen', 'ud'].forEach((key) => {
        const el = document.getElementById('rocker-' + key);
        if (el) el.addEventListener('click', () => {
          d[key] = !d[key];
          render();
        });
      });
      if (nextBtn) nextBtn.addEventListener('click', () => commitHoleAndAdvance());
      if (backBtn) backBtn.addEventListener('click', () => goBackFromHole());
      if (quitBtn) quitBtn.addEventListener('click', () => quitCurrentRound());
      break;
    }
    case 'finalscore': {
      const backBtn = document.getElementById('btn-back-to-hole18');
      const saveBtn = document.getElementById('btn-save-final');
      if (backBtn) backBtn.addEventListener('click', () => popPreviousHoleIntoDraft());
      if (saveBtn) saveBtn.addEventListener('click', () => saveFinalRound());
      break;
    }
    case 'front9score': {
      const cr = state.currentRound;
      const isStandaloneNine = cr.sessionLength === 9;
      const toggle = document.getElementById('toggle-front9');
      const backBtn = document.getElementById('btn-front9-back');
      const nextBtn = document.getElementById('btn-front9-next');

      if (toggle) {
        toggle.addEventListener('click', () => {
          state.front9Continue = !state.front9Continue;
          render();
        });
      }
      if (backBtn) backBtn.addEventListener('click', () => popPreviousHoleIntoDraft());
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          if (isStandaloneNine) {
            // Case B: standalone 9-hole session — always the save flow.
            finishFrontNineNow();
          } else if (state.front9Continue !== false) {
            // Case A, Continue: advance into Hole 10.
            goToHoleScreen();
          } else {
            // Case A, Quit: save this front nine as a widow/paired round.
            finishFrontNineNow();
          }
        });
      }
      break;
    }
    case 'reports': {
      const homeBtn = document.getElementById('btn-reports-home');
      if (homeBtn) homeBtn.addEventListener('click', () => { state.screen = 'home'; render(); });
      break;
    }
  }
  attachMenuHandlers();
}

// Pass 6 Fix 3: wired unconditionally (not inside the switch above) since
// the ⋮ button + menu overlay are available from every screen with a
// topbar, not just one. No-ops harmlessly on screens without a topbar
// (Onboarding) since getElementById just returns null there.
function attachMenuHandlers() {
  const menuBtn = document.getElementById('btn-menu');
  if (menuBtn) menuBtn.addEventListener('click', () => { state.menuOpen = true; render(); });

  if (!state.menuOpen) return;
  const scrim = document.getElementById('menu-scrim');
  const closeBtn = document.getElementById('menu-close');
  const itemAnalytics = document.getElementById('menu-item-analytics');
  const itemPlay = document.getElementById('menu-item-play');
  const itemSettings = document.getElementById('menu-item-settings');

  const closeMenu = () => { state.menuOpen = false; render(); };
  if (scrim) scrim.addEventListener('click', closeMenu);
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);
  if (itemAnalytics) itemAnalytics.addEventListener('click', () => { state.menuOpen = false; state.screen = 'reports'; render(); });
  if (itemPlay) itemPlay.addEventListener('click', () => { state.menuOpen = false; state.screen = 'home'; render(); });
  if (itemSettings) itemSettings.addEventListener('click', () => { state.menuOpen = false; state.fromSettings = true; state.screen = 'setup'; render(); });
}

// Lightweight partial re-render for putts (avoids full re-render on every tap).
function renderHoleStatOnly() {
  const el = document.querySelector('.putts-value');
  if (el) el.textContent = state.draft.putts;
}

// ===================== Boot =====================

init();
