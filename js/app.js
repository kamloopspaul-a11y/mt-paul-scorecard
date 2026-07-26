// A Bit of Bogey — app shell, state, router, and the round-capture pipeline.
// Pass 1 scope: onboarding -> setup -> home -> live 18-hole scoring -> final
// score -> save. Pass 2 scope: Reports/Analytics screen wired to real
// rounds-history data (see js/stats.js). Pass 3 scope: full Settings screen
// (dark mode, membership/green fee inputs, weather, export placeholder) and
// PWA/offline plumbing (service worker registration — see sw.js). See Design
// Handoff/README.md for the full spec this implements.

import { buildRoundRecord, buildNineHoleRecord, resolvePendingNine } from './round-record.js';
import { buildSettingsRecord } from './settings-record.js';
import { loadCourseData, getHolesForTee, getPar, getStrokeIndex } from './course-data.js';
import { KEYS, readJSON, writeJSON, remove, appendToArray } from './storage.js';
import { buildAnalytics, loadHandicapRatings, markWeekAnimated, withSeasonSettings, withGreenFeeChange, currentGreenFee, seasonYear, withOffSeasonRounds } from './stats.js';
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
// or Start Round screen loads. Never blocks the UI: on fetch failure both
// fields go back to null and the readout just renders blank (no error
// surfaced to the user). Pass 7: stores raw numbers rather than a
// pre-formatted string — Setup ("Temp: 18°C · Wind: 8 km/h") and Start
// Round ("18°C | 8 km/h") each format it differently.
let weatherState = { tempC: null, windKmh: null };

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
  front9Continue: true, // Pass 6 Fix 6: Front 9 Score screen's Continue/Post Now toggle (Case A only)
  front9Posting: false, // Pass 7: true while the post-save spinner is showing (UI delay only — the
                         // actual write already happened before the spinner started)
  front9Posted: false,  // Pass 7: true once Post Now has completed — swaps toggle/Back/Next for
                         // "Round Saved." and removes them; Menu is the only way forward from there
  front9Snapshot: null  // Pass 7: { front, totalScore, parTotal, playerName, isStandaloneNine }
                         // captured from currentRound right before Post Now clears it, so the
                         // scorecard table can keep rendering through the spinner/saved states
};

function pad2(n) { return n < 10 ? '0' + n : String(n); }

// "JUL 24, 2026" — Start Round screen's date line.
function todayLabel() {
  return new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
}

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
  // TEMP (local edit-review cycle, see JOURNAL.md): skipped on localhost so
  // the cache-first SW can't mask live edits while testing against
  // `python3 -m http.server`. Remove this hostname guard before shipping —
  // it must register normally on the real GitHub Pages deploy.
  const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  try {
    if ('serviceWorker' in navigator && !isLocalDev) {
      navigator.serviceWorker.register('./sw.js').catch((e) => {
        console.warn('Service worker registration failed', e);
      });
    } else if ('serviceWorker' in navigator && isLocalDev) {
      // Self-healing: a SW registered before this guard existed (or from an
      // earlier local session) would otherwise keep intercepting fetches
      // cache-first and masking live edits forever. Kill it and its caches
      // on every local boot so localhost always reflects disk.
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      });
      if (window.caches) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
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
    state.front9Posting = false;
    state.front9Posted = false;
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
    // Pass 7: nothing to resume — a normal launch lands on Start Round, per
    // Paul ("once installed as a PWA, the app, when launched will go to the
    // Start Round screen"). The crash-resilience branches above this one
    // (finalscore/front9score/mid-flight resume) still take priority.
    state.screen = 'startround';
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
    weatherState.tempC = Math.round(data.current.temperature_2m);
    weatherState.windKmh = Math.round(data.current.wind_speed_10m);
  } catch (e) {
    weatherState.tempC = null;
    weatherState.windKmh = null;
  }
  updateWeatherReadout();
}

// Setup's own format: "Temp: 18°C · Wind: 8 km/h".
function formatWeatherForSetup() {
  if (weatherState.tempC == null) return '';
  return 'Temp: ' + weatherState.tempC + '°C · Wind: ' + weatherState.windKmh + ' km/h';
}

// Start Round's format: "18°C | 8 km/h".
function formatWeatherForStartRound() {
  if (weatherState.tempC == null) return '';
  return weatherState.tempC + '°C | ' + weatherState.windKmh + ' km/h';
}

function updateWeatherReadout() {
  const setupEl = document.getElementById('weather-readout');
  if (setupEl) setupEl.textContent = formatWeatherForSetup();
  const startEl = document.getElementById('start-weather-readout');
  if (startEl) startEl.textContent = formatWeatherForStartRound();
}

// ===================== Round lifecycle =====================

function startRound({ startHoleNum, sessionLength }) {
  const tee = (state.settings && state.settings.teePref) || 'blue';
  const playerName = (state.settings && state.settings.playerName) || '';
  // Rating set is snapshotted onto the round at start, not read live from
  // Settings when Analytics renders — so changing the Settings switch later
  // never rewrites the differentials of rounds already played (2026-07-25).
  const ratingSet = (state.settings && state.settings.ratingSet) === 'female' ? 'female' : 'male';
  // Snapshot conditions at tee-off. weatherState is refreshed by fetchWeather()
  // when the Start Round screen renders; if that failed both stay null.
  const { tempC, windKmh } = weatherState;
  state.currentRound = {
    tee, playerName, ratingSet, tempC, windKmh, startHoleNum, sessionLength, holes: []
  };
  writeJSON(KEYS.CURRENT_ROUND, state.currentRound);
  goToHoleScreen();
}

function resumeIntoHoleScreen() {
  goToHoleScreen();
}

// Pass 7: replaces the old standalone "Home" dashboard (Play 18/Play 9,
// Resume, pending-nine card) entirely — per Design Handoff/README.md's own
// onboarding-flow line ("Setup -> Home (Hole 1, live scoring begins)"), Home
// was never meant to be a separate landing screen; it's just shorthand for
// "back into the game." Every former "go to Home" callsite now calls this
// instead, and it always lands on a hole screen (never a dashboard):
//   1. Round already in progress -> resume it exactly where it left off.
//   2. Otherwise -> always start a fresh 18-hole round at Hole 1.
//
// Pass 7 revision: this used to also auto-detect a waiting pending-nine
// widow (see resolveNineAndSave()) and silently start its complementary
// half at Hole 10 instead, on the theory that it'd pair into a full 18 the
// moment it's completed. Removed per Paul: a widow has no expiry, so this
// made "Start Round" hijack a brand-new outing into "finish some old
// unrelated round" with zero indication why — surfaced by a real scenario
// (rain delay ends Tuesday's round after the front 9 is posted; Thursday's
// [sic] fresh 18-hole round then opened on Hole 10 instead of Hole 1, no
// explanation given). Start Round is now unconditional: always Hole 1.
// Pairing (resolvePendingNine()) still exists and still runs whenever a
// standalone nine is saved — it just isn't fished for here anymore. A
// widow only pairs if its complementary half happens to get played and
// saved on its own later, whenever that is, if ever — that's an accepted
// outcome now, not a bug.
function goToPlayRound() {
  const cr = state.currentRound;
  if (cr && Array.isArray(cr.holes) && cr.holes.length < (cr.sessionLength || 18)) {
    resumeIntoHoleScreen();
    return;
  }
  startRound({ startHoleNum: 1, sessionLength: 18 });
}

// Builds a fresh editable draft for whichever hole comes next in currentRound,
// and shows the hole screen.
function goToHoleScreen() {
  const cr = state.currentRound;
  const holesPlayed = cr.holes.length;
  const holeNum = cr.startHoleNum + holesPlayed;
  const par = courseData ? getPar(courseData, cr.tee, holeNum) : 4;
  // Stroke index travels with the hole (2026-07-25). Analytics needs it for the
  // net double bogey adjustment (WHS Rule 3.1b); capturing it here rather than
  // looking it up later means a round stays correct even if the course file is
  // re-rated, and stays correct once rounds from more than one course share a
  // history. stats.js prefers this over the ratings file, and tolerates null.
  const si = courseData ? getStrokeIndex(courseData, cr.tee, holeNum) : null;
  state.draft = {
    holeNum,
    par,
    si,
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
    state.front9Posting = false;
    state.front9Posted = false;
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
    state.front9Posting = false;
    state.front9Posted = false;
    state.screen = 'front9score';
    render();
    return;
  }
  popPreviousHoleIntoDraft();
}

// Shared by the Front 9 Score screen's Post Now path in both Case A (18-hole
// session) and Case B (standalone 9-hole session) — the exact same save-as-
// widow-or-paired flow finishSession() already ran silently for a completed
// standalone 9-hole session; now triggered explicitly from the reviewable
// Front 9 Score screen instead of automatically on hole 9's commit.
// opts.skipNavigate: true keeps the caller on the current screen instead of
// jumping straight to goToPlayRound() — see postFrontNineNow() below, which
// uses this to hold the Front 9 Score screen in place through the spinner/
// "Round Saved." confirmation instead of navigating away immediately.
function finishFrontNineNow(opts = {}) {
  const cr = state.currentRound;
  const nine = buildNineHoleRecord({
    date: new Date().toISOString(),
    playerName: cr.playerName,
    tee: cr.tee,
    ratingSet: cr.ratingSet,
    tempC: cr.tempC,
    windKmh: cr.windKmh,
    half: 'front',
    holes: cr.holes
  });
  resolveNineAndSave(nine, opts);
}

// Pass 7: the Front 9 Score screen's Post Now action (Case A toggle set off
// Continue, or Case B's always-Post-Now). The actual save happens
// immediately/synchronously here (write-before-navigate, same contract as
// commitHoleAndAdvance's per-hole writes) — the spinner that follows is a
// pure UI delay to reassure the player something happened, not a gate on the
// write itself. If the app were closed mid-spinner, the round is already
// safely in rounds-history (or pending-nine) by that point.
//
// Once the delay elapses, front9Posted flips on and renderFront9Score() swaps
// the toggle/Back/Next row for a "Round Saved." message with nothing but the
// hamburger Menu left to navigate onward — Back has nothing left to edit
// (currentRound is already cleared) and Next has nothing left to do (the
// save already ran), so both are removed rather than left dangling.
function postFrontNineNow() {
  if (state.front9Posting || state.front9Posted) return; // guard against a stray double-tap
  const cr = state.currentRound;
  const front = cr.holes.slice(0, 9);
  state.front9Snapshot = {
    front,
    totalScore: front.reduce((s, h) => s + h.score, 0),
    parTotal: front.reduce((s, h) => s + h.par, 0),
    playerName: cr.playerName,
    isStandaloneNine: cr.sessionLength === 9
  };

  finishFrontNineNow({ skipNavigate: true }); // real save, happens now

  state.front9Posting = true;
  render();

  setTimeout(() => {
    state.front9Posting = false;
    state.front9Posted = true;
    render();
  }, 2400);
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
function resolveNineAndSave(justPlayedNine, opts = {}) {
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
  if (!opts.skipNavigate) {
    goToPlayRound();
  }
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
  if (!cr) { goToPlayRound(); return; }

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
    goToPlayRound();
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
    goToPlayRound();
    return;
  }

  const nine = buildNineHoleRecord({
    date: new Date().toISOString(),
    playerName: cr.playerName,
    tee: cr.tee,
    ratingSet: cr.ratingSet,
    tempC: cr.tempC,
    windKmh: cr.windKmh,
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
    ratingSet: cr.ratingSet,
    tempC: cr.tempC,
    windKmh: cr.windKmh,
    holes: cr.holes
  });
  appendToArray(KEYS.ROUNDS_HISTORY, record);
  remove(KEYS.CURRENT_ROUND);
  state.currentRound = null;
  goToPlayRound();
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

// Offer to restamp already-posted rounds when the rating set changes
// (2026-07-25). Every round stores the rating set it was played under, so
// flipping the Settings switch normally leaves history alone — that is what
// stops a stray tap silently moving the Handicap Index.
//
// The one case that needs an escape hatch: the switch defaults to Men's, so a
// ladies' player who plays a few rounds before noticing has those rounds locked
// to the wrong set with no way back. This offers the correction explicitly —
// only when there is history to correct, never silently, and stating exactly
// how many rounds it will rewrite and that it will move the Index.
//
// Returns the number of rounds restamped (0 if declined or nothing to do).
function offerRestampExistingRounds(previousSet, nextSet) {
  if (previousSet === nextSet) return 0;
  const history = readJSON(KEYS.ROUNDS_HISTORY, []);
  if (!Array.isArray(history) || !history.length) return 0;

  const label = (s) => (s === 'female' ? "Ladies'" : "Men's");
  const n = history.length;
  const ok = window.confirm(
    `Also apply ${label(nextSet)} Ratings to your ${n} existing round${n === 1 ? '' : 's'}?\n\n` +
    `Choose OK only if those rounds were played on ${label(nextSet)} Ratings and the setting was ` +
    `wrong. This recalculates their Score Differentials and will change your Handicap Index.\n\n` +
    `Choose Cancel to leave them on ${label(previousSet)} Ratings — new rounds will use ` +
    `${label(nextSet)} Ratings either way.`
  );
  if (!ok) return 0;

  writeJSON(KEYS.ROUNDS_HISTORY, history.map((r) => ({ ...r, ratingSet: nextSet })));
  return n;
}

function saveSetup(values) {
  const previousSet = (state.settings && state.settings.ratingSet) === 'female' ? 'female' : 'male';
  const nextSet = values.ratingSet === 'female' ? 'female' : 'male';
  const rec = buildSettingsRecord({
    playerName: values.playerName,
    teePref: values.teePref,
    ratingSet: nextSet,
    statsTrackingEnabled: values.statsTrackingEnabled,
    lightMode: values.lightMode !== false,
    membershipFee: values.membershipFee || 0,
    greenFee: values.greenFee || 0,
    // Preserved across a Settings save — there is no input for it yet, so a
    // save would otherwise wipe a seeded/entered value.
    roundsToDate: (state.settings && state.settings.roundsToDate) || 0,
    seasons: (state.settings && state.settings.seasons) || {}
  });
  const restamped = offerRestampExistingRounds(previousSet, nextSet);
  // `onboarded` is an app-shell-only flag (not part of settings-record.js's
  // documented schema) so returning users skip Onboarding/Setup on future
  // loads, per the README's own suggested fix for the "no welcome-back path"
  // gap.
  rec.onboarded = true;
  // Fees are filed under the CURRENT CALENDAR YEAR, stamped silently from the
  // clock (2026-07-25). Fees change season to season, so one flat pair can only
  // ever be right for one year; the player is asked what they paid, never which
  // year it belongs to. Past seasons keep the fees they were actually charged,
  // so an old season's ROI stays correct forever.
  let withSeason = withSeasonSettings(rec, {
    membershipFee: rec.membershipFee,
    roundsToDate: rec.roundsToDate
  });
  // A green fee EDIT is a rate change effective today, not a correction of the
  // past: rounds already played keep the rate they were played under, and the
  // ledger stays stable. Only recorded when the figure actually differs from
  // the rate currently in effect, so re-saving Settings never stacks duplicates.
  const newFee = Number(rec.greenFee) || 0;
  if (newFee > 0 && newFee !== currentGreenFee(withSeason)) {
    // The FIRST rate of a season is dated to 1 January, not to today. "The
    // green fee is $45" means it applies to the season, not from the moment it
    // was typed — and dating it today would leave earlier rounds priced by
    // greenFeeOn()'s back-fill rather than by an explicit entry that says so.
    // Every later change is a real change, dated the day it is entered.
    const hasRate = currentGreenFee(withSeason) !== null;
    const effectiveFrom = hasRate ? new Date() : `${seasonYear()}-01-01`;
    withSeason = withGreenFeeChange(withSeason, newFee, effectiveFrom);
  }
  Object.assign(rec, { seasons: withSeason.seasons });
  state.settings = rec;
  writeJSON(KEYS.SETTINGS, rec);
  applyDarkModeClass(rec.lightMode === false);
  if (restamped) {
    showToast(`${restamped} round${restamped === 1 ? '' : 's'} updated to ${nextSet === 'female' ? "Ladies'" : "Men's"} Ratings`);
  }
  // Pass 7: first-run Setup -> Save advances to Start Round, per Paul
  // ("Once Setup is completed then Save advances the user to the Start
  // Round screen"). A mid-game Settings revisit (state.fromSettings, opened
  // via the menu) keeps the prior behavior of dropping straight back into
  // play — not explicitly addressed yet, so left as-is rather than guessed.
  const wasFromSettings = state.fromSettings;
  state.fromSettings = false;
  if (wasFromSettings) {
    goToPlayRound();
  } else {
    state.screen = 'startround';
    render();
  }
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
    case 'startround': html = renderStartRound(); break;
    case 'hole': html = renderHole(); break;
    case 'finalscore': html = renderFinalScore(); break;
    case 'front9score': html = renderFront9Score(); break;
    case 'reports': html = renderReports(); break;
    default: html = '<div class="screen"><p>Loading…</p></div>';
  }
  appEl.innerHTML = html + menuOverlayHTML();
  attachHandlers();
  syncNavRowHeight();
}

// The photo above the nav row must clear it by exactly the 2px .hole-photo
// asks for. .screen-scroll reserves that space with padding-bottom, and the
// gap only comes out right when that padding equals the nav row's real
// height -- see the long note on .screen-scroll in css/styles.css for the
// arithmetic. Measured rather than hardcoded because the buttons render in
// Hanken Grotesk loaded with font-display:swap: the row is one height in the
// fallback stack and another once the webfont lands, so any fixed number is
// wrong on one side of that swap. Cheap -- one offsetHeight read on screens
// that have a nav row, nothing at all on those that don't.
function syncNavRowHeight() {
  const nav = document.querySelector('.screen.pinned-nav .nav-row');
  if (!nav) return;
  const h = nav.offsetHeight;
  if (h) document.documentElement.style.setProperty('--nav-row-h', h + 'px');
}

// Re-measure on the two events that legitimately change the row's height:
// the webfont swapping in, and the viewport changing width (buttons are
// flex:1, so their text can rewrap). Guarded because document.fonts is
// absent on older engines, where the CSS fallback simply stands.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(syncNavRowHeight);
}
window.addEventListener('resize', syncNavRowHeight);

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
// Clubhouse phone, read from mt-paul-course-data.json rather than hardcoded so
// it travels with the course file (2026-07-25). Returns null when course data
// hasn't loaded or carries no number, in which case the menu item is omitted
// entirely rather than rendering a dead link.
//
// `tel:` is normalised to E.164 (+1 for Canada) because a raw "250-374-4653"
// is dialled inconsistently across platforms; the DISPLAYED text keeps the
// human formatting from the data file.
function clubhousePhone() {
  const raw = courseData && courseData.phone;
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  const e164 = digits.length === 10 ? '+1' + digits : '+' + digits;
  // `display` is not shown in the menu (2026-07-25: Paul — the label alone is
  // enough) but is returned for any future caller that wants the readable form.
  return { display: String(raw), href: 'tel:' + e164 };
}

function menuOverlayHTML() {
  if (!state.menuOpen) return '';
  const phone = clubhousePhone();
  return `
    <div class="menu-scrim" id="menu-scrim"></div>
    <div class="menu-flyout" id="menu-flyout">
      <div class="menu-header">
        <span class="menu-label">Menu</span>
        <button class="menu-close" id="menu-close" aria-label="Close menu">&times;</button>
      </div>
      <button class="menu-item" id="menu-item-analytics">Analytics</button>
      <button class="menu-item" id="menu-item-play">Play Round</button>
      <button class="menu-item${phone ? '' : ' menu-item-last'}" id="menu-item-settings">Settings</button>
      ${phone
        ? `<a class="menu-item menu-item-last menu-item-call" id="menu-item-call" href="${phone.href}">Call Clubhouse</a>`
        : ''}
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
    <div class="screen onboarding-screen" style="background-image: linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.75)), url('assets/00-Bogey-Screen.png'); background-size: cover; background-position: center;">
      <div class="onboarding-title-block">
        <div class="subtitle">SOMETIMES</div>
        <h1>Bogey</h1>
        <div class="onboarding-credits">
          <div class="credit-line" style="grid-column:1;grid-row:1">Starring&nbsp;&nbsp;Pat Morgan</div>
          <div class="credit-line" style="grid-column:1;grid-row:2">Dave May&nbsp;&nbsp;Mike Titley</div>
          <div class="credit-divider" style="grid-column:2;grid-row:1/3"></div>
          <div class="credit-line" style="grid-column:3;grid-row:1">An Out of Bounds Film</div>
          <div class="credit-line" style="grid-column:3;grid-row:2">Music Score by Birdie</div>
          <div class="credit-divider" style="grid-column:4;grid-row:1/3"></div>
          <div class="credit-line" style="grid-column:5;grid-row:1">Les Putts Director</div>
          <div class="credit-line" style="grid-column:5;grid-row:2">An 18 Hole Production</div>
        </div>
      </div>
      <div class="onboarding-cta">
        <button class="btn" id="btn-start">Start</button>
      </div>
    </div>
  `;
}

// ===================== TEMPORARY: Analytics test data (2026-07-24) =====================
// Paul asked for a disposable, random 20-round dataset to test the upcoming
// Analytics work against, to be deleted once that work is confirmed. This
// whole block — this function, loadTestData/clearTestData below, the
// "Testing" card in renderSetup(), and their handlers in attachHandlers()'s
// 'setup' case — should come out together when that's done. Nothing here is
// meant to ship. See also KEYS.ROUNDS_HISTORY_TEST_BACKUP in storage.js.
//
// Replaced the earlier random generator (2026-07-25) with a FIXED fixture:
// wip/test-rounds-20.json, built by wip/make-test-rounds.py. The random version
// rolled each field independently, so it emitted holes that cannot exist —
// 8 with score − putts < 1, and 43 flagged `ud` without a 1-putt — which made
// every Scrambling & Putting figure impossible to check by hand. A fixed set
// means the same numbers load every time, so each stat can be verified once
// and re-checked after every edit.
//
// The fixture is pinned to Handicap Index 20.0 on Mt. Paul blue
// (CR 59.0 / slope 86): best 8 of 20 differentials
// [9.2, 14.5, 18.4, 21.0, 23.7, 25.0, 26.3, 28.9], mean 20.875, × 0.96 = 20.0.
// Profile is a streaky player — scores 66 to 94, good and bad holes clustered
// into runs rather than sprinkled evenly. Every hole satisfies:
//   score = strokesToGreen + putts (strokesToGreen >= 1)
//   gir  <=> score === par - 2 + putts
//   ud   <=> !gir && putts === 1
//   fir  === null on every par 3; pen only on holes played over par
//
// Lives in /wip/ (gitignored) because, like the rest of this block, it must
// never ship — so this fetch 404s on GitHub Pages by design. Holes are fed
// back through buildRoundRecord() rather than trusting the file's own totals,
// keeping round-record.js the single place those sums are computed.
const TEST_FIXTURE_URL = './wip/test-rounds-20.json';

async function fetchTestRounds() {
  const res = await fetch(TEST_FIXTURE_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${TEST_FIXTURE_URL} → ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw) || !raw.length) throw new Error('fixture is empty or not an array');
  const playerName = (state.settings && state.settings.playerName) || 'Dave';
  return raw
    .map((r) => buildRoundRecord({
      date: r.date, playerName, tee: r.tee || 'blue', ratingSet: r.ratingSet, holes: r.holes
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date)); // oldest-first, as appendToArray() accumulates
}

// TEMPORARY (2026-07-25) — membership figures seeded alongside the test rounds
// so the ROI section has something to compute from. Paul's numbers:
// $1,450 annual, $45 green fee, 54 rounds to date. RTD is deliberately NOT the
// fixture's 20 logged rounds — rounds on a membership can predate the app, and
// roundsToDate() treats the settings value as authoritative when present.
// Remove with the rest of the testing block.
const TEST_MEMBERSHIP = { membershipFee: 1450, greenFee: 45, roundsToDate: 54 };

async function loadTestData() {
  let rounds;
  try {
    rounds = await fetchTestRounds();
  } catch (e) {
    console.error('Test fixture failed to load', e);
    showToast('Test data unavailable — see console');
    return;
  }
  const existing = readJSON(KEYS.ROUNDS_HISTORY, []);
  // Only back up once — a second Load tap must not overwrite Paul's real
  // backup with the first batch of test data.
  if (Array.isArray(existing) && existing.length && !readJSON(KEYS.ROUNDS_HISTORY_TEST_BACKUP, null)) {
    writeJSON(KEYS.ROUNDS_HISTORY_TEST_BACKUP, existing);
  }
  writeJSON(KEYS.ROUNDS_HISTORY, rounds);
  const settings = readJSON(KEYS.SETTINGS, null);
  if (settings) {
    const seeded = withSeasonSettings(
      Object.assign({}, settings, TEST_MEMBERSHIP), TEST_MEMBERSHIP
    );
    writeJSON(KEYS.SETTINGS, seeded);
    state.settings = seeded;
  }
  showToast(`Test data loaded — ${rounds.length} rounds`);
}

function clearTestData() {
  const backup = readJSON(KEYS.ROUNDS_HISTORY_TEST_BACKUP, null);
  if (backup) {
    writeJSON(KEYS.ROUNDS_HISTORY, backup);
    remove(KEYS.ROUNDS_HISTORY_TEST_BACKUP);
  } else {
    writeJSON(KEYS.ROUNDS_HISTORY, []);
  }
  showToast('Test data cleared');
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
  // Which published Course Rating / Slope set applies. Mt. Paul rates the same
  // Blue and Red tees for both — only CR/Slope differ, stroke index is shared.
  const ratingSet = s.ratingSet === 'female' ? 'female' : 'male';
  const statsOn = s.statsTrackingEnabled !== false;
  const lightOn = s.lightMode !== false; // default true (Light Mode), per settings-record.js
  const membershipFeeVal = formatFeeForInput(s.membershipFee);
  const greenFeeVal = formatFeeForInput(s.greenFee);
  const weatherText = formatWeatherForSetup();

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
          <span class="toggle-label ${ratingSet === 'male' ? '' : 'dim'}">Men's Ratings</span>
          <div class="switch rating-set ${ratingSet === 'male' ? 'state-a' : 'state-b'}" id="toggle-rating-set">
            <div class="knob"></div>
          </div>
          <span class="toggle-label ${ratingSet === 'female' ? '' : 'dim'}">Ladies' Ratings</span>
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
          <p class="field-help">Used to calculate your break-even point and savings in Analytics.</p>
        </div>
        <div class="field" style="margin-bottom:6px;">
          <label for="input-green-fee">Green Fees</label>
          <input type="text" inputmode="decimal" id="input-green-fee" value="${escapeAttr(greenFeeVal)}" placeholder="$45" />
          <p class="field-help">Per-round rate for 18 holes, used as the non-member comparison in Analytics.</p>
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
      <div class="card" style="border:1px dashed var(--ink-muted); margin-top:12px;">
        <span class="toggle-label dim" style="display:block; margin-bottom:10px;">Testing (temporary)</span>
        <p class="field-help" style="margin-top:0;">Loads a random 20-round dataset into Analytics for testing. Your real round history (if any) is backed up and restored by Clear — remove this card once we're done.</p>
        <div class="btn-row" style="margin-top:10px;">
          <button class="btn small secondary" id="btn-load-test-data">Load Test Data</button>
          <button class="btn small secondary" id="btn-clear-test-data">Clear Test Data</button>
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

// Pass 7: the old "Screen: Home" dashboard (Play 18/Play 9 buttons, Resume,
// pending-nine card, Reports/Settings links) is gone — it was never part of
// the design spec. Reports and Settings are already reachable from the
// hamburger menu on every screen.

// ===================== Screen: Start Round =====================
//
// The real post-Setup landing screen (per Paul): Setup -> Save -> Start
// Round, and this is also where a launched/installed PWA lands and where
// the hamburger menu's "Play Round" item goes — never straight into Hole 1.
// Only the "Start Round" button actually begins play.
function renderStartRound() {
  const settings = state.settings || {};
  const playerName = (settings.playerName || '').split(' ')[0];

  return `
    <div class="screen pinned-nav">
      <div class="screen-scroll">
        ${topbarHTML()}
        <div class="hole-top-row">
          <div>
            <h1>Ready?</h1>
            <div class="start-round-date">${todayLabel()}</div>
          </div>
          <div class="start-round-weather" id="start-weather-readout">${formatWeatherForStartRound()}</div>
        </div>
        ${playerName ? `<div class="start-round-greeting">Good luck, ${escapeAttr(playerName)}</div>` : ''}
        <div class="start-round-quote">&quot;It takes a lot of balls to play this game.&quot;</div>
        <div class="hole-photo" style="background-image:url('assets/00-Start.png');"></div>
      </div>
      <div class="btn-row nav-row">
        <button class="btn" id="btn-start-round">Start Round</button>
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
  // Pass 6 Fix 5: every hole 2-18 gets a Back button alongside Next — except
  // the very first hole played in this session (nothing committed yet in
  // currentRound.holes, so there's nothing to go back to). This is based on
  // holes played this session, not literally holeNum === 1, so a standalone
  // back-9 session (starts at Hole 10 with zero holes committed) also
  // correctly gets no Back button on its first hole.
  const showBack = cr.holes.length > 0;
  // Pass 7: "Play It [Name]" is only the very first hole's wording (no Back
  // button yet, same condition as showBack) — every other hole says "Next"
  // per spec, regardless of player name. Was wrongly showing "Play It" on
  // every non-final hole.
  const nextLabel = isLastOfSession ? 'Finish' : (showBack ? 'Next' : ('Play It' + (playerName ? ' ' + playerName.split(' ')[0] : '')));

  const photoNum = pad2(d.holeNum);
  // Pass 7 (2026-07-24): Hole 2's photo alone gets a custom crop (bottom-
  // anchored — was losing detail low in the frame at the shared class's
  // default center position). Per Paul: a one-off inline override here,
  // rather than changing .hole-photo's shared background-position for every
  // hole screen (tried that first; it affected other images for the worse).
  // Every other hole keeps the class default untouched.
  const photoPositionStyle = d.holeNum === 2 ? 'background-position:center bottom;' : '';

  return `
    <div class="screen pinned-nav">
      <div class="screen-scroll">
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
        <div class="stroke-panel-wrap">
          <div class="stroke-panel">
            <button class="score-btn" id="score-minus" aria-label="Decrease score">−</button>
            <div class="score-value" id="score-value">${d.score}</div>
            <button class="score-btn" id="score-plus" aria-label="Increase score">+</button>
          </div>
        </div>
        <div class="rockers-row">
          ${rockerHTML('fir', 'FIR', d.fir, d.par === 3 /* Pass 7 (2026-07-24): FIR hidden on every par-3 hole, per Paul — confirmed via a Hole 7 visual test first. Reverses the earlier Pass 5 "FIR shown on every hole including par-3s" owner decision. visibility:hidden (not display:none) so GIR/PEN/UD/Putts keep their exact column positions instead of shifting left. */)}
          ${rockerHTML('gir', 'GIR', d.gir)}
          ${rockerHTML('pen', 'PEN', d.pen)}
          ${rockerHTML('ud', 'UD', d.ud)}
          ${puttsColumnHTML(d.putts)}
        </div>
        <div class="hole-photo" style="background-image:url('assets/${photoNum}-Hole.png');${photoPositionStyle}"></div>
      </div>
      <div class="btn-row nav-row">
        ${showBack ? '<button class="btn" id="btn-back-hole">Back</button>' : ''}
        <button class="btn" id="btn-next-hole">${nextLabel}</button>
      </div>
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
// hidden: keeps the column occupying its grid cell (so the remaining rockers
// don't shift to fill the gap) but renders nothing and isn't clickable —
// visibility:hidden rather than display:none, per Paul's Hole 7 FIR test.
function rockerHTML(key, label, on, hidden = false) {
  const knobTop = on ? TOGGLE_KNOB_ON_POS : TOGGLE_KNOB_OFF_POS;
  const knobBg = on ? TOGGLE_ON_GRADIENT : TOGGLE_OFF_GRADIENT;
  const knobShadow = on ? TOGGLE_ON_SHADOW : TOGGLE_OFF_SHADOW;
  return `
    <div class="rocker-col"${hidden ? ' style="visibility:hidden;"' : ''}>
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
    ratingSet: cr.ratingSet,
    tempC: cr.tempC,
    windKmh: cr.windKmh,
    holes: cr.holes
  });
  const front = preview.holes.slice(0, 9);
  const back = preview.holes.slice(9, 18);

  const holeRowCells = (arr) => arr.map((h) => `<th>${h.holeNum}</th>`).join('');
  const parRowCells = (arr) => arr.map((h) => `<td>${h.par}</td>`).join('');
  const scoreRowCells = (arr) => arr.map((h) => scoreCellHTML(h.score, h.par)).join('');

  return `
    <div class="screen pinned-nav">
      <div class="screen-scroll">
        ${topbarHTML()}
        <div class="final-score-header">
          <h1>Final Score</h1>
          <div class="total-score">${preview.totalScore}</div>
        </div>
        <div class="scorecard-frame">
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
        </div>
        <div class="hole-photo final-score-photo" style="background-image:url('assets/18-Score-Card.png');"></div>
      </div>
      <div class="btn-row nav-row">
        <button class="btn" id="btn-back-to-hole18">Back</button>
        <button class="btn" id="btn-save-final">Save</button>
      </div>
    </div>
  `;
}

// ===================== Screen: Front 9 Score (Pass 6 Fix 6, Pass 7 Post Now) =====================
//
// Shown after Hole 9 completes, in BOTH an 18-hole session mid-flight and a
// deliberate standalone 9-hole session — see commitHoleAndAdvance() for the
// routing. Two cases, distinguished by cr.sessionLength:
//   Case A (sessionLength === 18): a real Continue/Post Now toggle. Continue
//     advances into Hole 10; Post Now runs the same save-as-widow flow a
//     mid-round quit already uses (half: 'front'). ("Quit" was renamed to
//     "Post Now" in Pass 7 — saving is the primary action here, not
//     abandoning anything.)
//   Case B (sessionLength === 9): a deliberate standalone nine has nothing to
//     "continue" to, so no toggle is shown — Next is relabeled "Post Now" and
//     always runs the save flow (this is exactly today's finishSession()
//     behavior for a 9-hole session, just shown as a reviewable scorecard
//     first instead of happening silently).
// Back (either case) pops Hole 9 back into the draft for editing — the
// Hole-10-only Back exception lives in goBackFromHole(), not here. Back is
// only available before Post Now is tapped; see the posting/posted states
// below.
//
// Pass 7: three states once you're on this screen —
//   1. Idle — toggle (Case A) or "Post Now" label (Case B) + Back/Next shown.
//   2. Posting — the real save already ran (see postFrontNineNow()); a
//      spinner shows for ~2.4s as a pure UI delay, toggle/Back/Next hidden.
//   3. Posted — "Round Saved." replaces the toggle, Back/Next stay hidden.
//      Neither has anything left to do: Back has nothing left to edit
//      (currentRound is already cleared) and Next has nothing left to save.
//      Menu (Analytics/Play Round/Settings) is the only way forward from
//      here, or the player just closes the app — the round is already safe.
// currentRound is null during posting/posted, so front9Snapshot (captured
// the instant before Post Now clears it) is what keeps the scorecard table
// on screen through those two states.
function renderFront9Score() {
  const cr = state.currentRound;
  let front, totalScore, parTotal, playerName, isStandaloneNine;

  if (cr) {
    front = cr.holes.slice(0, 9); // exactly the 9 just-committed entries
    totalScore = front.reduce((s, h) => s + h.score, 0);
    parTotal = front.reduce((s, h) => s + h.par, 0);
    playerName = cr.playerName;
    isStandaloneNine = cr.sessionLength === 9;
  } else if (state.front9Snapshot) {
    ({ front, totalScore, parTotal, playerName, isStandaloneNine } = state.front9Snapshot);
  } else {
    // Defensive fallback — shouldn't happen (posting/posted always follow a
    // snapshot capture in postFrontNineNow()).
    front = []; totalScore = 0; parTotal = 0; playerName = ''; isStandaloneNine = false;
  }

  const holeRowCells = front.map((h) => `<th>${h.holeNum}</th>`).join('');
  const parRowCells = front.map((h) => `<td>${h.par}</td>`).join('');
  const scoreRowCells = front.map((h) => scoreCellHTML(h.score, h.par)).join('');

  const continueOn = state.front9Continue !== false;
  const posting = state.front9Posting;
  const posted = state.front9Posted;

  let actionAreaHTML;
  if (posting) {
    actionAreaHTML = `<div class="row-toggle post-status" style="border-bottom:none; justify-content:center;">
        <div class="spinner" role="status" aria-label="Saving round"></div>
      </div>`;
  } else if (posted) {
    actionAreaHTML = `<div class="row-toggle post-status" style="border-bottom:none; justify-content:center;">
        <span class="post-confirm">Round Saved.</span>
      </div>`;
  } else if (isStandaloneNine) {
    actionAreaHTML = `<div class="row-toggle" style="border-bottom:none; justify-content:center;">
        <span class="toggle-label">Post Now</span>
      </div>`;
  } else {
    actionAreaHTML = `<div class="row-toggle" style="border-bottom:none; justify-content:center; gap:14px;">
        <span class="toggle-label ${continueOn ? '' : 'dim'}">Continue</span>
        <div class="switch ${continueOn ? 'state-a' : 'state-b'}" id="toggle-front9">
          <div class="knob"></div>
        </div>
        <span class="toggle-label ${continueOn ? 'dim' : ''}">Post Now</span>
      </div>`;
  }

  const navRowHTML = (posting || posted) ? '' : `
      <div class="btn-row nav-row">
        <button class="btn" id="btn-front9-back">Back</button>
        <button class="btn" id="btn-front9-next">${isStandaloneNine ? 'Post Now' : (continueOn ? 'Next' : 'Post Now')}</button>
      </div>`;

  return `
    <div class="screen pinned-nav">
      <div class="screen-scroll">
        ${topbarHTML()}
        <div class="final-score-header">
          <h1>Front 9 Score</h1>
          <div class="total-score">${totalScore}</div>
        </div>
        <div class="scorecard-frame">
          <table class="scorecard">
            <thead><tr class="holes-row"><th>H</th>${holeRowCells}<th class="total">Out</th></tr></thead>
            <tbody>
              <tr class="par-row"><td>Par</td>${parRowCells}<td class="total">${parTotal}</td></tr>
              <tr class="score-row-data"><td>${escapeAttr((playerName || 'You').split(' ')[0])}</td>${scoreRowCells}<td class="total">${totalScore}</td></tr>
            </tbody>
          </table>
        </div>
        ${actionAreaHTML}
        <div class="hole-photo" style="background-image:url('assets/09-Score-Card.png');"></div>
      </div>
      ${navRowHTML}
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

// A simple 4-column bar chart (<= Birdie/Par/Bogey/Bogey+ style), pct-driven.
//
// Design pass 2026-07-25 (Paul's Analytics mockup): value sits ABOVE its bar
// rather than below, and the columns are wide slabs rather than thin bars.
// Because `.bar-row` bottom-aligns its columns, a value placed first in the
// column floats just above that bar's top edge — so the numbers step up and
// down with the data, which is what the mockup shows.
//
// A true zero draws a thin flat baseline rather than nothing: it anchors the
// column so the four read as a set, and `.bar-zero` removes the top corner
// radius so it reads as a baseline rule and not a stunted bar.
function barRowHTML(items) {
  const max = Math.max(1, ...items.map((i) => i.pct));
  return `<div class="bar-row thick">${items.map((i) => {
    const zero = i.pct === 0;
    const h = zero ? 3 : Math.max(6, Math.round((i.pct / max) * 100));
    return `
    <div class="bar-col">
      <div class="bar-value">${i.pct}%</div>
      <div class="bar${zero ? ' bar-zero' : ''}" style="height:${h}px;"></div>
      <div class="bar-label">${i.label}</div>
    </div>`;
  }).join('')}</div>`;
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
  // Same wide-slab treatment as Today's Round (2026-07-25, per Paul's spec
  // screenshots): `.bar-row.thick`, and the value ABOVE its bar rather than
  // below. Because `.bar-row` bottom-aligns its columns, a value placed first
  // in the column floats just above that bar's top edge, so the numbers step
  // with the data.
  //
  // Three distinct bar states, deliberately kept apart:
  //   no rounds that week -> grey 4px `bar-empty`, value shown as an em dash
  //   played, none scored -> 3px `bar-zero` baseline rule (flat top corners)
  //   otherwise           -> proportional slab
  // "Didn't play" and "played and scored none" must not collapse into the
  // same shape.
  return ['birdie', 'par', 'bogey', 'bogeyPlus'].map((key) => {
    const slots = weekly[key];
    const max = Math.max(1, ...slots.map((s) => (s.hasData ? s.count : 0)));
    const bars = slots.map((s, i) => {
      const isNew = i === newSlotIndex ? ' bar-new' : '';
      let cls;
      let height;
      if (!s.hasData) {
        cls = ' bar-empty';
        height = 4;
      } else if (s.count === 0) {
        cls = ' bar-zero';
        height = 3;
      } else {
        cls = '';
        height = Math.max(6, Math.round((s.count / max) * 100));
      }
      return `
      <div class="bar-col">
        <div class="bar-value">${s.hasData ? s.count : '—'}</div>
        <div class="bar${cls}${isNew}" style="height:${height}px;"></div>
        <div class="bar-label">${s.label}</div>
      </div>`;
    }).join('');
    return `
      <div class="report-section">
        <h2 class="report-heading">${WEEKLY_METRIC_LABELS[key]} Each Week</h2>
        <div class="bar-row thick">${bars}</div>
      </div>`;
  }).join('');
}

function todaysStatsHTML(t, roundsToDate) {
  // "Today's Round" — six equal tiles (3 across x 2 down) with the Actual Score
  // as a hero beside them, per Paul's sketch.
  //
  // RTD (Rounds to Date) holds the sixth slot, and reads the SAME value the
  // Membership ROI section calls Rounds Played — stats.js roundsToDate(), which
  // prefers the membership figure over rounds-history.length. One acronym must
  // mean one number; it previously showed logged rounds here (20) and rounds on
  // the membership there (54), which is exactly the kind of near-duplicate
  // terminology this screen is meant to avoid. CH was only ever there to make
  // the net arithmetic legible, and "Course Handicap" is exactly the kind of
  // near-duplicate term ("handicap" / "Handicap Index" / "Course Handicap")
  // that loses a recreational player. Net is a concept golfers already accept
  // without it being spelled out, so the allowance is not shown. RTD answers
  // something no scorecard shows and anyone building a history cares about:
  // how far along am I.
  const tile = (value, label) =>
    `<div class="today-tile"><div class="today-tile-value">${value}</div>` +
    `<div class="today-tile-label">${label}</div></div>`;
  const dash = (v) => (v === null || v === undefined ? '—' : v);
  return `
    <div class="report-section">
      <h2 class="report-heading">Today's Round</h2>
      <div class="today-round">
        <div class="today-grid">
          ${tile(t.fir.count, 'FIR')}
          ${tile(t.gir.count, 'GIR')}
          ${tile(t.pen.count, 'PEN')}
          ${tile(t.ud.count, 'UD')}
          ${tile(t.putts, 'PUTTS')}
          ${tile(roundsToDate, 'RTD')}
        </div>
        <div class="today-hero">
          <div class="today-hero-score">${t.totalScore}</div>
          <div class="today-hero-net">Net: ${dash(t.net)}</div>
        </div>
      </div>
      ${barRowHTML([
        { label: '\u2264 Birdie', pct: t.birdie.pct },
        { label: 'Par', pct: t.par.pct },
        { label: 'Bogey', pct: t.bogey.pct },
        { label: 'Bogey+', pct: t.bogeyPlus.pct }
      ])}
    </div>`;
}

// Last 10 Rounds — Actual Score per round, oldest left, most recent right.
// Appears once 10 rounds are logged.
//
// Bars are proportional to the highest score in the window, so they sit at
// similar heights by design: ten rounds inside a few strokes of each other
// SHOULD look level. The numbers above carry the detail; the bars carry the
// shape. Scrollable, since ten slabs won't fit a phone width.
function lastTenHTML(lastTen) {
  const max = Math.max(1, ...lastTen.map((r) => r.totalScore));
  const bars = lastTen.map((r) => `
      <div class="bar-col">
        <div class="bar-value">${r.totalScore}</div>
        <div class="bar" style="height:${Math.max(6, Math.round((r.totalScore / max) * 100))}px;"></div>
      </div>`).join('');
  return `
    <div class="report-section">
      <h2 class="report-heading">Last 10 Rounds</h2>
      <div class="bar-row thick scroll">${bars}</div>
      <p class="report-note">Last 10 rounds, most recent on the right.</p>
    </div>`;
}

// Off-season rounds table — the ONLY place these are entered.
//
// Steppers, deliberately, not an "Add" button. The number on screen IS the
// number stored, so revisiting in February shows what January's session
// recorded and a correction is the same gesture as an entry. An Add control
// would store transactions instead of state, and then "did I already enter
// December?" becomes unanswerable without remembering what you did last time —
// which is precisely the failure this replaces.
//
// The `logged` column is the second guard: October and March are months a
// proper round may well have been played and captured live, and showing that
// count stops the same round being tallied on top of itself.
function offSeasonTableHTML(offSeason) {
  // Uses .stat-table so the typography matches the ROI rows directly above —
  // same 14px, muted label left, bold figure right. The stepper sits in the
  // value cell where the dollar amounts sit, so the two tables read as one.
  const rows = offSeason.months.filter((m) => !m.future).map((m) => `
    <tr>
      <td>${m.label}${m.logged ? ` <span class="os-logged">${m.logged} logged</span>` : ''}</td>
      <td class="os-step">
        <button class="os-btn" data-os-key="${m.key}" data-os-delta="-1"
                aria-label="One fewer round in ${m.label}"${m.tally ? '' : ' disabled'}>&minus;</button>
        <span class="os-count">${m.tally}</span>
        <button class="os-btn" data-os-key="${m.key}" data-os-delta="1"
                aria-label="One more round in ${m.label}">+</button>
      </td>
    </tr>`).join('');
  return `
    <h3 class="os-heading">Off-Season Rounds</h3>
    <p class="os-note">Counts toward your membership, not your stats.</p>
    <table class="stat-table os-table">
      ${rows}
    </table>`;
}

function membershipROIHTML(roi, offSeason) {
  // Rounds Played is RTD — rounds on the membership, which can predate the app
  // (stats.js roundsToDate).
  //
  // Two groups, separated by a rule: what the membership COSTS (fee, green fee,
  // break-even, rounds played) above; what it has RETURNED below. Per-round
  // cost falls with every round and crosses under the green fee at break-even,
  // which is the moment "Today's Savings" turns positive.
  //
  // Money renders without trailing .00 — $1,450 and $980 read as figures,
  // $1,450.00 reads as an invoice. Cents show only when there are cents.
  const money = (n) => {
    const v = Number(n);
    const abs = Math.abs(v);
    const body = abs.toLocaleString('en-CA', {
      minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
      maximumFractionDigits: 2
    });
    return (v < 0 ? '-$' : '$') + body;
  };
  return `
    <div class="report-section">
      <h2 class="report-heading">Membership ROI</h2>
      <table class="stat-table">
        <tr><td>Membership</td><td>${money(roi.membershipFee)}</td></tr>
        <tr><td>Green Fee - 18 Holes</td><td>${money(roi.greenFee)}</td></tr>
        <tr><td>Break Even</td><td>${roi.roundsToBreakEven} Rounds</td></tr>
        <tr><td>Rounds Played</td><td>${roi.roundsPlayed}</td></tr>
        <tr class="stat-row-group"><td>Per Round Cost to Date</td><td>${roi.perRoundCostToDate === null ? '—' : money(roi.perRoundCostToDate)}</td></tr>
        <tr><td>Today's Savings</td><td>${roi.todaysSavings === null ? '—' : money(roi.todaysSavings)}</td></tr>
        <tr><td>Savings to Date</td><td>${money(roi.cumulativeSavings)}</td></tr>
      </table>
      ${offSeason && offSeason.visible ? offSeasonTableHTML(offSeason) : ''}
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
  // Every "last 20" label reads off the rounds actually on record, so a player
  // three rounds in isn't told they're looking at 20 (2026-07-25).
  const windowN = Math.min(a.roundsCount, 20);
  const windowLabel = `Last ${windowN} round${windowN === 1 ? '' : 's'}`;
  const windowLabelTitle = `Last ${windowN} Round${windowN === 1 ? '' : 's'}`;

  // Season Stats removed 2026-07-25 (Paul): from install through ~20 rounds it
  // offered nothing useful — scoring average, best and worst are the same
  // number at one round and barely separate for several more, and FIR/GIR
  // percentages duplicate what Today's Round already shows as counts. If it
  // ever returns it should be gated on 20 rounds, not rendered from round one.

  // Score Distribution removed 2026-07-25 (Paul): it drew the identical four
  // buckets with the identical legend as the bar row inside Today's Round —
  // two charts saying the same thing on one screen. The per-round version was
  // kept because it means something from round one; the 20-round version, like
  // Season Stats, says nothing until the history is deep enough to matter.
  // The weekly Birdies/Pars/Bogeys/Bogey+ charts are the deliberate exception:
  // they are the "tweener" content for the ~7 weeks before 20 rounds exist.

  // WHS establishes no Handicap Index below 3 scores (Rule 5.2a), so anything
  // shown before then is the app's own estimate and is labelled as one. The
  // estimate uses the same formula the real Index will use at round 3 (lowest
  // differential − 2.0), so the number doesn't lurch when it becomes official.
  const hs = a.handicapStatus || { status: null };
  const isEstimate = hs.status === 'estimate';
  const handicapSection = `
    <div class="report-section">
      <h2 class="report-heading">${isEstimate ? 'Estimated Handicap' : 'Handicap Index'}</h2>
      <div class="handicap-readout">${a.handicap !== null ? a.handicap.toFixed(1) : '—'}</div>
      ${isEstimate
        ? `<div class="report-sub" style="margin-bottom:8px;">Estimate — ${hs.roundsToEstablish} more round${hs.roundsToEstablish === 1 ? '' : 's'} to establish a Handicap Index</div>`
        : ''}
      <div class="report-sub" style="margin-bottom:8px;">${
        // Not always 8: with fewer than 20 rounds on record, WHS Rule 5.2a
        // counts fewer differentials (e.g. lowest 3 at 9-11 rounds), so the
        // label reads off what was actually used rather than hard-coding "8".
        a.best8Differentials.length
          ? `Lowest ${a.best8Differentials.length} Score Differential${a.best8Differentials.length === 1 ? '' : 's'} of the ${windowLabelTitle}`
          : 'Score Differentials'
      }</div>
      ${a.best8Differentials.length
        ? diffBarRowHTML(a.best8Differentials)
        : (a.handicap === null
            ? '<p class="section-empty">A Handicap Index needs at least 3 rounds (WHS Rule 5.2a).</p>'
            : '<p class="section-empty">No rounds on a recognized tee yet — Score Differential needs Course Rating/Slope from your tee.</p>')}
    </div>`;

  const twentyRoundAvg = `
    <div class="report-section">
      <h2 class="report-heading">${windowN} Round Average</h2>
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

  const todaysStats = a.todaysVisible && a.todaysStats ? todaysStatsHTML(a.todaysStats, a.roundsToDate) : '';

  const membershipRoi = a.roi
    ? membershipROIHTML(a.roi, a.offSeason)
    : `
    <div class="report-section">
      <h2 class="report-heading">Membership ROI</h2>
      <p class="section-empty">Set up your membership fee and green fee in Settings to see savings.</p>
    </div>`;

  // Handicap Index, 20 Round Average, Hole Ratings and Scrambling & Putting are
  // BUILT ABOVE BUT NOT RENDERED (2026-07-25, Paul). They are all 20-round
  // stats and belong further down the page than the weekly charts, which are
  // the "tweener" content for the ~7 weeks before 20 rounds exist. Their exact
  // position and presentation are still being designed.
  //
  // Kept assembled rather than deleted so restoring one is a matter of dropping
  // it back into this return in the right order — nothing needs rebuilding.
  const lastTenSection = a.lastTenVisible && a.lastTen.length ? lastTenHTML(a.lastTen) : '';

  return todaysStats + weeklyTrends + lastTenSection + membershipRoi;
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
      const ratingSetToggle = document.getElementById('toggle-rating-set');
      const statsToggle = document.getElementById('toggle-stats');
      let teePref = (state.settings && state.settings.teePref) || 'blue';
      let ratingSet = (state.settings && state.settings.ratingSet) === 'female' ? 'female' : 'male';
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
      if (ratingSetToggle) {
        ratingSetToggle.addEventListener('click', () => {
          ratingSet = ratingSet === 'male' ? 'female' : 'male';
          ratingSetToggle.classList.toggle('state-a', ratingSet === 'male');
          ratingSetToggle.classList.toggle('state-b', ratingSet === 'female');
          const labels = ratingSetToggle.parentElement.querySelectorAll('.toggle-label');
          labels[0].classList.toggle('dim', ratingSet !== 'male');
          labels[1].classList.toggle('dim', ratingSet !== 'female');
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
      // TEMPORARY (2026-07-24) — see fetchTestRounds()/loadTestData()/
      // clearTestData() above renderSetup(); remove alongside those and the
      // "Testing" card's markup once Analytics work is confirmed.
      const loadTestBtn = document.getElementById('btn-load-test-data');
      if (loadTestBtn) {
        loadTestBtn.addEventListener('click', loadTestData);
      }
      const clearTestBtn = document.getElementById('btn-clear-test-data');
      if (clearTestBtn) {
        clearTestBtn.addEventListener('click', clearTestData);
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
            ratingSet,
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
    case 'startround': {
      const startBtn = document.getElementById('btn-start-round');
      if (startBtn) {
        startBtn.addEventListener('click', () => {
          // Non-destructive by construction: resumes an in-progress round
          // or pairs a waiting nine automatically rather than overwriting
          // it — see goToPlayRound()'s doc comment. The button always reads
          // "Start Round" regardless; this just avoids silent data loss.
          goToPlayRound();
        });
      }
      fetchWeather();
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
      // cr is null once posting/posted (currentRound already cleared) — those
      // states render with no toggle/Back/Next in the DOM anyway, so the
      // isStandaloneNine lookup below only needs to succeed while cr exists.
      const isStandaloneNine = cr ? cr.sessionLength === 9 : false;
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
            postFrontNineNow();
          } else if (state.front9Continue !== false) {
            // Case A, Continue: advance into Hole 10.
            goToHoleScreen();
          } else {
            // Case A, Post Now: save this front nine as a widow/paired round.
            postFrontNineNow();
          }
        });
      }
      break;
    }
    case 'reports': {
      // Off-season steppers. Writes the NEW TOTAL for that month, not a delta —
      // the stored value and the displayed value are the same thing.
      //
      // Scroll position is preserved across the re-render: the table sits near
      // the bottom of a long screen, and jumping to the top after every tap
      // would make entering six months unusable.
      document.querySelectorAll('[data-os-key]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.getAttribute('data-os-key');
          const delta = Number(btn.getAttribute('data-os-delta'));
          const settings = state.settings || {};
          const current = (settings.offSeasonRounds && settings.offSeasonRounds[key]) || 0;
          const next = Math.max(0, current + delta);
          const updated = withOffSeasonRounds(settings, key, next);
          state.settings = updated;
          writeJSON(KEYS.SETTINGS, updated);
          const y = window.scrollY;
          render();
          window.scrollTo(0, y);
        });
      });
      const homeBtn = document.getElementById('btn-reports-home');
      if (homeBtn) homeBtn.addEventListener('click', () => goToPlayRound());
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
  if (itemPlay) itemPlay.addEventListener('click', () => { state.menuOpen = false; state.screen = 'startround'; render(); });
  if (itemSettings) itemSettings.addEventListener('click', () => { state.menuOpen = false; state.fromSettings = true; state.screen = 'setup'; render(); });

  // Call Clubhouse is a real <a href="tel:"> — the OS handles dialling, so no
  // preventDefault and no navigation of our own. The menu is closed on a
  // deferred tick rather than synchronously: re-rendering during event dispatch
  // would tear the anchor out of the DOM before the browser acts on it, which
  // cancels the dial on some platforms. Closing it means returning from the
  // call drops the player back on the hole they were playing, not on the menu.
  const itemCall = document.getElementById('menu-item-call');
  if (itemCall) {
    itemCall.addEventListener('click', () => {
      setTimeout(() => { state.menuOpen = false; render(); }, 0);
    });
  }
}

// Lightweight partial re-render for putts (avoids full re-render on every tap).
function renderHoleStatOnly() {
  const el = document.querySelector('.putts-value');
  if (el) el.textContent = state.draft.putts;
}

// ===================== Boot =====================

init();
