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
import { barMenuHTML } from './bar-menu.js';
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
  settingsReturnTo: null, // screen Settings was opened from, so Save can go back there (see saveSetup)
  menuOpen: false,     // Pass 6 Fix 3: hamburger slide-out menu, available from every topbar
  front9Continue: true, // Pass 6 Fix 6: Front 9 Score screen's Continue/Post Now toggle (Case A only)
  front9Posting: false, // Pass 7: true while the post-save spinner is showing (UI delay only — the
                         // actual write already happened before the spinner started)
  front9Posted: false,  // Pass 7: true once Post Now has completed — swaps toggle/Back/Next for
                         // "Round Saved." and removes them; Menu is the only way forward from there
  front9Snapshot: null, // Pass 7: { front, totalScore, parTotal, playerName }
  savedSnapshot: null   // 2026-07-26: { totalScore, parTotal, playerName, date } captured
                        // at Save, since currentRound is cleared before the
                        // Round Saved screen renders. See saveFinalRound().
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

  // Drop yesterday's abandoned round before any branch below reads it, so a
  // stale round can't resume or be counted. Never touches a complete 18 or a
  // pending widow — see reconcileStaleRound().
  reconcileStaleRound();

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
    // A round is mid-flight. Where to land depends on what the user was doing
    // when the app last rendered (2026-07-26) — this branch used to drag you
    // into a hole screen unconditionally, so reloading from Analytics threw
    // you out of it. See rememberScreen()/readLastScreen() above.
    const last = readLastScreen();
    if (last === 'reports' || last === 'setup' || last === 'startround') {
      // Was reading stats / changing settings — stay there. The round is
      // untouched in localStorage and resumes the moment they navigate back.
      state.screen = last;
      if (last === 'setup') state.fromSettings = true;
    } else {
      // Was on a hole screen, or we have no recent memory (fresh install,
      // cleared storage, or away longer than the TTL) — resume the round,
      // which is the safe default and the original behaviour.
      resumeIntoHoleScreen();
      return;
    }
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

// Start Round's format: "18°C | 8 km/h". This is now the ONLY on-screen
// weather readout — Settings showed a "Temp: 18°C · Wind: 8 km/h" line until
// 2026-07-26, removed at Paul's request. The fetch and the per-round capture
// stay: weatherState is still snapshotted into every round record (see
// buildRoundRecord's tempC/windKmh), and that is the one field that cannot be
// backfilled after the fact.
function formatWeatherForStartRound() {
  if (weatherState.tempC == null) return '';
  return weatherState.tempC + '°C | ' + weatherState.windKmh + ' km/h';
}

function updateWeatherReadout() {
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
    tee, playerName, ratingSet, tempC, windKmh, startHoleNum, sessionLength,
    // When the round was started. Used by reconcileStaleRound() at boot, which
    // compares CALENDAR DAYS, not elapsed time — the rule is "you don't finish
    // yesterday's round today", never a countdown. Stored as a full ISO stamp
    // rather than just the day so a rescued widow can be dated to the day it
    // was actually played instead of the day it was recovered.
    startedAt: new Date().toISOString(),
    holes: []
  };
  writeJSON(KEYS.CURRENT_ROUND, state.currentRound);
  goToHoleScreen();
}

function resumeIntoHoleScreen() {
  goToHoleScreen();
}

// Local calendar day as 'YYYY-MM-DD'. Deliberately local, not UTC — a round
// finished at 9pm on the 26th must not read as the 27th to a player in BC.
function localDayKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// ===================== Stale round reconcile (2026-07-26) =====================
//
// Runs once at boot. A round left in progress on an EARLIER CALENDAR DAY is
// finished with, one way or the other:
//   - 9+ holes recorded -> the first nine is rescued as a Widow.
//   - fewer than 9      -> nothing complete to keep, discarded.
//
// This is a RESCUE, not a policy. Paul: "The key here is the USER DECIDES...
// but in the event of a failure, a system crash, dead battery, mis-swipes,
// etc. an autosave routine rescues the widow."
//
// It can never override a decision, and that falls out of there being no Quit
// button: every deliberate exit goes through Post Now (Front 9 Score) or Save
// (Final Score), and BOTH clear currentRound. So a round still sitting here at
// the day boundary can only mean no decision was ever made — crash, dead
// battery, forgotten app. Nothing to overrule.
//
// A calendar day, not a timer. Paul first proposed 30 minutes of inactivity,
// which would routinely destroy live rounds: 30-minute gaps are normal golf —
// a stop at the turn (Mt. Paul is nine holes played twice, so the turn passes
// the clubhouse), a rain delay, a slow group ahead. A day boundary cannot fire
// mid-round.
//
// Two things this must NOT touch:
//   1. A COMPLETE 18 sitting unsaved on Final Score. Every hole is recorded and
//      only the Save tap is missing — exactly what boot()'s Pass 5 crash-
//      recovery branch protects. Resumable whenever.
//   2. A WIDOW already in pending-nine-holes. Saved data waiting to pair, meant
//      to sit for days or weeks. (Untouched here by construction — this only
//      ever reads currentRound.)
//
// Rounds saved before startedAt existed have no day to compare and are left
// alone — never discard on an assumption.
function reconcileStaleRound() {
  const cr = state.currentRound;
  if (!cr || !Array.isArray(cr.holes)) return;
  if (cr.holes.length >= 18) return;   // complete 18 — see note 1 above
  if (!cr.startedAt) return;           // legacy round, can't prove staleness
  if (localDayKey(new Date(cr.startedAt)) === localDayKey(new Date())) return;

  const chunk = getCompletedNineChunk(cr);
  if (chunk) {
    // Dated to the day it was played, not the day it was found.
    const nine = buildNineHoleRecord({
      date: cr.startedAt,
      playerName: cr.playerName,
      tee: cr.tee,
      ratingSet: cr.ratingSet,
      tempC: cr.tempC,
      windKmh: cr.windKmh,
      holes: chunk.holes
    });
    // skipNavigate: boot() decides the landing screen, not this. resolveNineAndSave
    // clears currentRound itself, and pairs with a waiting widow if there is one.
    resolveNineAndSave(nine, { skipNavigate: true, rescued: true });
    return;
  }

  remove(KEYS.CURRENT_ROUND);
  state.currentRound = null;
}

// ===================== Last-screen memory (2026-07-26) =====================
//
// Why this exists: boot() used to send you to a hole screen on EVERY launch
// while a round was mid-flight, no matter what you were actually doing. Reload
// the page from Analytics and you'd be thrown into Hole 5. Paul: "it's a
// recovery / redundancy measure" — it should cover leaving a hole screen to
// call the clubhouse or check another app, not every reload from anywhere.
//
// So: remember the screen, and come back to it. There is no time limit —
// there was a 30-minute TTL here until 2026-07-26, removed at Paul's request
// as an unexplainable rule. It was only ever deciding "mid-round, resume the
// hole or return to Analytics", because this is consulted ONLY inside the
// mid-flight branch: with no round in progress, boot() lands on Start Round
// regardless of what's remembered. Staleness is handled once, by the day rule
// in reconcileStaleRound() above — a round from a previous day is gone before
// this is ever reached.
//
// Deliberately NOT covered by this: the finalscore/front9score crash-recovery
// branches in boot(). Those exist to stop a completed-but-unsaved round being
// silently overwritten by the next Play 18, which is permanent data loss —
// they must fire regardless of where the user was or how long ago. This is a
// convenience feature and is allowed to fail; those aren't.
// Only screens that can rebuild themselves from localStorage alone. Transient
// review states (finalscore, front9score) are excluded on purpose: they're
// owned by the crash-recovery branches, and restoring them here could show a
// review screen for a round that branch has already resolved. 'onboarding' is
// excluded because the onboarded flag decides that, not history.
const RESTORABLE_SCREENS = ['hole', 'reports', 'setup', 'startround', 'barmenu'];

function rememberScreen(screen) {
  if (!RESTORABLE_SCREENS.includes(screen)) return;
  writeJSON(KEYS.LAST_SCREEN, { screen, at: Date.now() });
}

// Returns the remembered screen name, or null if there isn't one, it's stale,
// or it's not a screen we're willing to restore. Anything malformed reads as
// null — this is navigation state, so the safe failure is "fall through to
// boot()'s normal rules", never a throw.
function readLastScreen() {
  const rec = readJSON(KEYS.LAST_SCREEN, null);
  if (!rec || typeof rec !== 'object') return null;
  if (!RESTORABLE_SCREENS.includes(rec.screen)) return null;
  return rec.screen;
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

  // Pass 6 Fix 6: the first nine just completed — show the Front 9 Score
  // review screen (Continue / Post Now) instead of silently rolling into
  // Hole 10.
  if (cr.holes.length === 9) {
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
  if (d.holeNum === 10) {
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
    playerName: cr.playerName
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

// The round reached 18 holes by natural play (not via Quit).
//
// Every round is 18 holes starting at Hole 1, so this is unconditional. It
// used to branch on sessionLength === 9 to run a standalone-nine save path —
// unreachable, since startRound() only ever creates 18-hole rounds. A nine
// only ever gets saved as a Widow now, via Quit or the Front 9 Score screen's
// Post Now, both of which route through finishFrontNineNow().
function finishSession() {
  state.screen = 'finalscore';
  render();
}

// A Widow was just created. Pair it with a waiting widow into a full round if
// one exists, otherwise store it as the waiting widow. Always clears
// currentRound afterward.
function resolveNineAndSave(justPlayedNine, opts = {}) {
  const pending = readJSON(KEYS.PENDING_NINE, null);
  const { pairedRound, newPendingNine } = resolvePendingNine(pending, justPlayedNine);
  if (pairedRound) {
    appendToArray(KEYS.ROUNDS_HISTORY, pairedRound);
    remove(KEYS.PENDING_NINE);
    showToast(opts.rescued
      ? 'Unfinished round recovered — its front nine paired into a complete round (' + pairedRound.totalScore + ')'
      : 'Round complete — saved to your device (' + pairedRound.totalScore + ')');
  } else {
    writeJSON(KEYS.PENDING_NINE, newPendingNine);
    showToast(opts.rescued
      ? 'Unfinished round recovered — its front nine was saved as a half round.'
      : 'Nine holes saved — play another nine to complete the round.');
  }
  remove(KEYS.CURRENT_ROUND);
  state.currentRound = null;
  if (!opts.skipNavigate) {
    goToPlayRound();
  }
}

// The Widow chunk: which holes get kept when a round is abandoned part-way.
//
// Paul's standing order — save the first nine because it's complete, discard
// whatever was played after it because it isn't. Quit on Hole 16 and holes
// 10-15 are dropped; only holes 1-9 are banked. Returns null below nine holes,
// where there's nothing complete to keep.
//
// Previously also had a `startHoleNum === 10` branch for back-nine sessions,
// which cannot exist — every round starts at Hole 1.
function getCompletedNineChunk(cr) {
  if (cr.holes.length >= 9) {
    return { holes: cr.holes.slice(0, 9) };
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

  // Snapshot before currentRound goes — the Round Saved screen has to render
  // after the round is cleared.
  state.savedSnapshot = {
    totalScore: record.totalScore,
    parTotal: cr.holes.reduce((sum, h) => sum + h.par, 0),
    playerName: cr.playerName,
    date: record.date
  };

  remove(KEYS.CURRENT_ROUND);
  state.currentRound = null;

  // Land on the terminal Round Saved screen (2026-07-26, Paul). This used to
  // call goToPlayRound(), which — with currentRound just cleared — fell
  // through to startRound() and silently created a BRAND NEW empty 18-hole
  // round on disk, dropping the player on Hole 1 of a round they never asked
  // to start. That phantom round also meant currentRound effectively always
  // existed, so boot()'s mid-flight branch always matched and the Pass 7
  // "a launch lands on Start Round" rule was unreachable.
  //
  // A round is now created in exactly one place: the player tapping Start
  // Round. Nothing here navigates onward — the menu is the only way out, by
  // design: "no buttons, no action required".
  state.screen = 'saved';
  render();
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
  // Round screen").
  //
  // A mid-game Settings revisit (state.fromSettings, opened via the menu) now
  // returns to whichever screen Settings was opened FROM (2026-07-26, Paul).
  // It used to call goToPlayRound() unconditionally, which meant opening
  // Settings from the Front 9 Score card and hitting Save dropped you on
  // Hole 10 — the previous comment here flagged this as "not explicitly
  // addressed yet, left as-is rather than guessed". This is the answer.
  //
  // Falling back to goToPlayRound() when there's no recorded origin preserves
  // the old behaviour for any path that reaches Save without going through the
  // menu handler.
  const wasFromSettings = state.fromSettings;
  const returnTo = state.settingsReturnTo;
  state.fromSettings = false;
  state.settingsReturnTo = null;
  if (!wasFromSettings) {
    state.screen = 'startround';
    render();
    return;
  }
  // Review/report screens rebuild themselves from state + localStorage, so
  // returning is just a screen swap. The front-9 review flags (front9Continue
  // /Posting/Posted) are untouched in memory across a Settings visit — no
  // reload happened — so a Continue/Post Now choice made before opening
  // Settings survives the round trip.
  if (returnTo === 'front9score' || returnTo === 'finalscore' || returnTo === 'reports' || returnTo === 'startround') {
    state.screen = returnTo;
    render();
    return;
  }
  goToPlayRound();
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
    case 'barmenu': html = renderBarMenu(); break;
    case 'saved': html = renderSaved(); break;
    default: html = '<div class="screen"><p>Loading…</p></div>';
  }
  appEl.innerHTML = html + menuOverlayHTML();
  attachHandlers();
  syncNavRowHeight();
  // Stamp where we are so a reload/relaunch within the TTL comes back here
  // rather than jumping into the round. Non-restorable screens are ignored by
  // rememberScreen(), which leaves the previous stamp in place — deliberate,
  // so passing through a review screen doesn't erase where you actually were.
  rememberScreen(state.screen);
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
      <button class="menu-item" id="menu-item-barmenu">Bar &amp; Grill Menu</button>
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

  return `
    <div class="screen">
      ${topbarHTML()}
      <h1 style="margin-bottom:20px;">Settings</h1>
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
        <div class="field field-inline" style="margin-top:8px;">
          <label for="input-membership-fee">Membership Fee</label>
          <input type="text" inputmode="decimal" id="input-membership-fee" value="${escapeAttr(membershipFeeVal)}" placeholder="$1,450" />
        </div>
        <div class="field field-inline" style="margin-bottom:6px;">
          <label for="input-green-fee">18 Holes Green Fee</label>
          <input type="text" inputmode="decimal" id="input-green-fee" value="${escapeAttr(greenFeeVal)}" placeholder="$45" />
          <p class="field-help">Used to calculate your break-even point and savings in Analytics.</p>
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
      <div class="card" style="border:1px dashed var(--ink-muted); padding:18px; margin-top:12px;">
        <span class="toggle-label dim" style="display:block; margin-bottom:10px;">Testing (temporary)</span>
        <p class="field-help" style="margin-top:0;">Loads a random 20-round dataset into Analytics for testing. Your real round history (if any) is backed up and restored by Clear — remove this card once we're done.</p>
        <div class="btn-row" style="margin-top:10px;">
          <button class="btn small" id="btn-load-test-data">Load Test Data</button>
          <button class="btn small" id="btn-clear-test-data">Clear Test Data</button>
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

// Credits for the 19th Hole roll (Paul, 2026-07-26). Data, not markup, so the
// copy can be edited without touching layout.
//
// Each row is [left, right]. The two columns meet in the middle and justify
// TOWARDS each other — left column right-aligned, right column left-aligned,
// 20px between them. For Cast that reads "who | what"; for crew sections it
// reads "job | who", which is the usual film-credit order.
const CREDIT_SECTIONS = [
  { title: 'Cast', rows: [
    ['Dave May', 'Himself'],
    ['Pat Morgan', 'Himself'],
    ['Rick Kirkwood', 'Himself'],
    ['Jack McGuire', 'Himself'],
    ['Ray Johnson', 'Extra'],
    ['Gary Bailey', 'Extra'],
    ['Rob Denier', 'Extra'],
    ['Danny Latin', 'PGA Pro'],
    ['Donna Diner', 'Mt. Paul Catering'],
    ['Nancy Kitchen', 'Mt. Paul Catering'],
    ['Fiona &amp; Melissa', 'Servers'],
    ['Brian Proshop', 'Pro Shop Manager'],
    ['Randy', 'Assistant II'],
    ['Brett Emsland', 'PGA'],
    ['Poker Players', 'Merv, Kenny, Mike &amp; the Gang']
  ]},
  { title: 'Directed By', rows: [
    ['Directed By', 'Divot Reilly'],
    ['Written By', 'Par Shooter &amp; Bo Gie'],
    ['Produced By', 'Mt. Paul Golf Course']
  ]},
  { title: 'Production', rows: [
    ['Executive Producer', 'Sandy Trapp'],
    ['Director of Photography', 'Fair Weis'],
    ['1st Unit Cinematography', 'Chip Shott'],
    ['2nd Unit Cinematography', 'Rusty Wedge'],
    ['Camera Operator', 'Lou Feaux'],
    ['Steadicam Operator', 'Green Reider'],
    ['Focus Puller', 'Rae Kaffe']
  ]},
  { title: 'Electrical &amp; Grip', rows: [
    ['Gaffer', 'Sparky McTee'],
    ['Best Boy Electric', 'Flint Iron'],
    ['Key Grip', 'Trap Barrows'],
    ['Dolly Grip', 'Cartway Jenkins']
  ]},
  { title: 'Art Department', rows: [
    ['Production Designer', 'Fairway Foster'],
    ['Art Director', 'Bunker Hill'],
    ['Set Decorator', 'Divot Lawns'],
    ['Costume Designer', 'Plaid Weathers'],
    ['Hair &amp; Makeup', 'Betty Birdie']
  ]},
  { title: 'Assistant Directors', rows: [
    ['1st AD', 'Marker Downes'],
    ['2nd AD', 'Yardage Booke'],
    ['Script Supervisor', 'Handi Capp']
  ]},
  { title: 'Stunts', rows: [
    ['Stunt Coordinator', 'Slice Malone'],
    ['Stunt Doubles', 'The Shank Brothers'],
    ['Ball Retrieval Unit', 'The Water Hazard Divers'],
    ['Caddy Wrangler', 'Fore! Jenkins'],
    ['Sound Mixer', 'Wesley Whiffle'],
    ['Boom Operator', 'Rough Rider Nolan']
  ]},
  { title: 'Sound', rows: [
    ['Foley Artist', 'Clint Clubface'],
    ['Sound Effects &mdash; Ball Strike', 'Fresh Cut Fairway Studios']
  ]},
  { title: 'Music &amp; Post', rows: [
    ['Music By', 'The Birdie Orchestra'],
    ['Original Score', '&ldquo;Ballad of the 19th Hole&rdquo;'],
    ['Editor', 'Trim N. Green'],
    ['Colorist', 'Ivy Fairgreen'],
    ['Visual Effects', 'Mulligan Digital'],
    ['Greenskeeping Consultant', 'Sod Off Studios'],
    ['Catering', 'The Clubhouse Kitchen'],
    ['Legal Counsel', 'Rule 14-1 LLP']
  ]},
  { title: 'Location', rows: [
    ['Filmed On Location', 'Mt. Paul Golf Course<br>Front &amp; Back 9'],
    ['Cameras By', 'Titleist Vision Optics']
  ]},
  { title: 'Technical Credits', rows: [
    ['Sound By', 'Fairbank Dolby Green'],
    ['Color By', 'Augusta Technicolor'],
    ['Filmed In', 'Bogeyvision'],
    ['Certified', '18-Hole Regulation Runtime'],
    ['No Divots Were Harmed', 'In The Making Of This Round'],
    ['A Widow Nine Production', 'Paired In Post']
  ]}
];

function creditsHTML(year) {
  const sections = CREDIT_SECTIONS.map((sec) => {
    const rows = sec.rows.map(([l, r]) =>
      `<div class="credit-row"><div class="credit-l">${l}</div><div class="credit-r">${r}</div></div>`
    ).join('');
    return `<section class="credit-section">
        <h2 class="credit-section-title">${sec.title}</h2>
        ${rows}
      </section>`;
  }).join('');

  // Closing card — centred, full width, no columns. The last thing on screen
  // before the fade.
  const closing = `<section class="credit-section credit-closing">
      <p>This Round Is A Work Of Fiction</p>
      <p>Any Resemblance To An Actual Good Score<br>Is Purely Coincidental</p>
      <p class="credit-marks">DTS &middot; SDDS &middot; THX</p>
      <p class="credit-copy">Mt. Paul Golf Course &copy; ${year}</p>
    </section>`;

  return sections + closing;
}

// The last beat: a title card a second after the crawl clears (Paul,
// 2026-07-26). Drawn in HTML/CSS rather than dropped in as an image so it
// stays crisp at any density and picks up the app's own typefaces — "cleaner,
// like an illustration".
//
// The reference photo Paul supplied carried a PGA TOUR logo on the badge. That
// is a registered trademark and is NOT reproduced here; the sign's own form (a
// vertical QUIET over PLEASE on a bordered plate) is generic tournament
// signage and fine to draw fresh. The badge slot carries the Mt. Paul wordmark
// instead, which is both clear of anyone else's mark and a better joke — this
// is a Mt. Paul spoof, not a PGA one.
function finalCardHTML() {
  return `
    <div class="final-card" hidden>
      <div class="quiet-sign">
        <div class="quiet-sign-plate">
          <div class="quiet-stack">
            <span>Q</span><span>U</span><span>I</span><span>E</span><span>T</span>
          </div>
          <div class="quiet-please">Please</div>
          <img class="quiet-badge" src="assets/Logos/mt_paul_logo_vector.svg" alt="" />
        </div>
      </div>
      <div class="final-line">One for Jack</div>
      <div class="final-fineprint">A Shhhaadup Production</div>
    </div>
  `;
}

// Credit roll speed, pixels per second. Paul wants film-credit pace — "a
// little too fast to catch it all in one go", the Chuck Lorre vanity-card
// joke. Walked 40 -> 95 -> 85 (2026-07-26): 40 put the roll at 92 seconds,
// which Paul read as waiting; 95 overshot into too-quick. Tune HERE, not by
// setting a duration: duration is derived from content
// height at this speed, so adding or cutting credits changes how LONG the roll
// runs and never how fast it reads. A fixed duration would silently accelerate
// the roll every time copy was added.
const CREDIT_ROLL_PX_PER_SEC = 85;

// Paul's shot list (2026-07-26). `slot` is the card's ENTIRE time on the
// clock, fades included — dominoes ticking the clock down, not fades stacked
// on top of a hold. Corrected 2026-07-26: treating the shot-list number as the
// hold and adding a fade either side made a "2 sec" card occupy 3.4s and the
// whole sequence run 18.6s instead of the ~13s the list actually describes.
//
// Within a slot: fade in over `fade`, hold, fade out over `fade`. Requires
// slot >= 2 * fade, which every card below satisfies.
const INTRO_CARDS = [
  { cls: 'intro-hero', slot: 2000, fade: 500,
    html: 'Round Saved' },
  { cls: 'intro-line', slot: 1500, fade: 300,
    html: '<span class="intro-sub">Executive Producer</span>Paul de Zeeuw' },
  { cls: 'intro-line', slot: 1500, fade: 300,
    html: '<span class="intro-sub">In association with</span><span class="intro-big">Mulligan Studios</span>' }
];

// Three names, one at a time, each in a different spot along roughly the same
// horizon and each larger than the last — the first is 20% smaller than the
// third (34px / 38px / 43px), per the shot list.
const INTRO_NAMES = [
  { label: 'Starring',           name: 'Dave May',    pos: 'pos-a' },
  { label: 'Costarring',         name: 'Pat Morgan',  pos: 'pos-b' },
  { label: 'with Special Guest', name: 'Mike Titley', pos: 'pos-c' }
];

// The held beat on black between the studio cards and the first name. Was
// also covering a 1.6s background transition until the screen became dark from
// arrival; now it's purely a pause, so it can be tuned freely on feel.
const BLACK_SCREEN_MS = 1400;

// Beat of empty black between the crawl clearing and the last card.
const FINAL_CARD_DELAY_MS = 1000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Plays one card inside a fixed slot: fade in, hold, fade out, gone — total
// elapsed is exactly `slot`, so the sequence's running time is the sum of the
// slots and nothing else.
async function playCard(stage, cls, html, slot, fade) {
  const el = document.createElement('div');
  el.className = 'intro-card ' + cls;
  el.style.setProperty('--fade', fade + 'ms');
  el.innerHTML = html;
  stage.appendChild(el);
  // Force a frame so the transition has a start value to animate FROM —
  // without this the element is inserted already-visible and never dissolves.
  void el.offsetWidth;
  el.classList.add('visible');
  // Fade-out must START at slot-minus-fade so it FINISHES on the slot boundary.
  await wait(Math.max(fade, slot - fade));
  el.classList.remove('visible');
  await wait(fade);
  el.remove();
}

// The whole Round Saved sequence: confirmation, studio cards, cut to black,
// three names, then the credit roll. Called once from attachHandlers().
async function playSavedSequence() {
  const stage = document.querySelector('.saved-stage');
  const scroller = document.querySelector('.saved-scroll');
  const credits = document.querySelector('.saved-credits');
  if (!stage || !scroller || !credits) return;

  // Motion sensitivity: skip the whole sequence. No cards, no roll, no fade —
  // the credits are simply there, scrollable by hand. Checked in JS as well as
  // CSS because animationend would otherwise never fire and the screen would
  // sit mid-effect forever.
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    scroller.hidden = false;
    credits.classList.add('lit');
    const card = document.querySelector('.final-card');
    if (card) { card.hidden = false; card.classList.add('visible'); }
    return;
  }

  // Park the credits at their start offset now, invisible, so the roll has
  // nothing to travel before it's readable. See CREDIT_START_FROM_TOP_PX.
  parkCredits(scroller, credits);

  for (const card of INTRO_CARDS) {
    await playCard(stage, card.cls, card.html, card.slot, card.fade);
  }

  // BLACK SCREEN. Now just a held beat — the screen has been dark since it
  // rendered (see .saved-screen in the CSS), so there's nothing to transition.
  // This is the pause between the studio cards and the first name.
  await wait(BLACK_SCREEN_MS);

  for (const n of INTRO_NAMES) {
    const html = '<span class="intro-name-label">' + n.label + '</span>' + n.name;
    await playCard(stage, 'intro-name ' + n.pos, html, 1500, 300);
  }

  startCreditRoll(scroller, credits);
}

// Where the first credit waits, measured from the TOP OF THE SCREEN. Converted
// to an offset inside the scroller, which starts lower down the page than the
// viewport does. Walked out from 160 -> 186 -> 286 (2026-07-26) on Paul's eye:
// 160 parked the credits inside the scroller's top fade mask so the CAST
// heading arrived washed out; 286 sits well clear of it and gives the roll a
// beat of black under the title before the first credit.
const CREDIT_START_FROM_TOP_PX = 286;

// Positions the credits at their start offset and leaves them invisible. Runs
// before the intro cards so the layer is already in place, frozen, while the
// studio cards and the three names play over it.
function parkCredits(scroller, credits) {
  scroller.hidden = false;
  const scrollerTop = scroller.getBoundingClientRect().top;
  const startPx = Math.max(0, Math.round(CREDIT_START_FROM_TOP_PX - scrollerTop));
  credits.style.setProperty('--roll-from', startPx + 'px');
  credits.style.setProperty('--roll-to', '-' + credits.scrollHeight + 'px');
  // Inline transform holds the parked position. A running CSS animation
  // outranks inline styles in the cascade, so .rolling takes over cleanly
  // from here with no jump.
  credits.style.transform = 'translateY(' + startPx + 'px)';
  return startPx;
}

// One pass, then gone. Duration is derived from content height at a CONSTANT
// pixels-per-second, so editing the credits changes how LONG the roll runs and
// never how fast it reads. A fixed duration would silently accelerate the roll
// every time a line was added.
function startCreditRoll(scroller, credits) {
  const startPx = parkCredits(scroller, credits); // idempotent; also re-measures
  const travel = startPx + credits.scrollHeight;
  credits.style.setProperty('--roll-duration', (travel / CREDIT_ROLL_PX_PER_SEC) + 's');
  credits.classList.add('lit'); // fade up from black as the roll begins
  credits.addEventListener('animationend', () => {
    // Roll's done and off the top.
    scroller.hidden = true;
    // A beat of empty black, then the last card. The pause is the joke's
    // timing — arriving straight off the crawl would read as another credit.
    setTimeout(() => {
      const card = document.querySelector('.final-card');
      if (!card) return;
      card.hidden = false;
      void card.offsetWidth; // force a frame so the fade has a start value
      card.classList.add('visible');
    }, FINAL_CARD_DELAY_MS);
  }, { once: true });
  credits.classList.add('rolling');
}

// ===================== Screen: Round Saved (2026-07-26) =====================
//
// Terminal screen. Reached only from Final Score > Save, and deliberately has
// NO buttons and no onward navigation — per Paul: "No buttons, no action
// required. The menu allows exits to other parts of the app, or, the most
// likely action is to close the app."
//
// Why it exists: Save used to drop the player straight onto Hole 1 of a fresh
// round, which read as a grey area rather than a confirmation. Paul plays one
// round a day; the realistic next action is Analytics, Membership ROI, or
// closing the app — never starting a second round. A new user had no signal at
// all that their round had been stored.
//
// Not added to RESTORABLE_SCREENS (see readLastScreen) on purpose: reloading
// here has no round to resume, so boot() correctly falls through to Start
// Round. A confirmation is a moment, not a place to come back to.
//
// The widow equivalent already exists and is NOT routed here — the Front 9
// Score screen's own "Round Saved." posted state keeps the nine-hole scorecard
// on screen behind the confirmation, which is more informative than a blank
// card would be. See postFrontNineNow().
//
// Titled "19th Hole" (Paul, 2026-07-26) — the clubhouse bar, where a round
// gets talked about after it's over. Content below the title is still open;
// state.savedSnapshot holds { totalScore, parTotal, playerName, date } ready
// for whatever lands there.
function renderSaved() {
  // state.savedSnapshot ({ totalScore, parTotal, playerName, date }) is captured
  // at Save and available here if the credits ever want the round's own figures.
  const snap = state.savedSnapshot;
  const creditYear = new Date(snap ? snap.date : Date.now()).getFullYear();

  return `
    <div class="screen saved-screen">
      ${topbarHTML()}
      <h1 class="saved-title">19th Hole</h1>
      <div class="saved-stage">
        <div class="saved-scroll" hidden>
          <div class="saved-credits">${creditsHTML(creditYear)}</div>
        </div>
        ${finalCardHTML()}
      </div>
    </div>
  `;
}

// ===================== Screen: Front 9 Score (Pass 6 Fix 6, Pass 7 Post Now) =====================
//
// Shown after Hole 9 completes — see commitHoleAndAdvance() for the routing.
// A Continue/Post Now toggle: Continue advances into Hole 10; Post Now banks
// these nine as a Widow, the same flow a mid-round Quit uses. ("Quit" was
// renamed to "Post Now" in Pass 7 — saving is the primary action here, not
// abandoning anything.)
//
// There was a second case here (Case B, sessionLength === 9) for a deliberate
// standalone nine, which had no toggle and always posted. Unreachable —
// startRound() only ever creates 18-hole rounds — and removed 2026-07-26.
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
  let front, totalScore, parTotal, playerName;

  if (cr) {
    front = cr.holes.slice(0, 9); // exactly the 9 just-committed entries
    totalScore = front.reduce((s, h) => s + h.score, 0);
    parTotal = front.reduce((s, h) => s + h.par, 0);
    playerName = cr.playerName;
  } else if (state.front9Snapshot) {
    ({ front, totalScore, parTotal, playerName } = state.front9Snapshot);
  } else {
    // Defensive fallback — shouldn't happen (posting/posted always follow a
    // snapshot capture in postFrontNineNow()).
    front = []; totalScore = 0; parTotal = 0; playerName = '';
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
        <button class="btn" id="btn-front9-next">${continueOn ? 'Next' : 'Post Now'}</button>
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

// ===================== Screen: Bar & Grill Menu =====================
//
// A read-only reference page — the clubhouse's printed menu, transcribed.
// Content and layout live in js/bar-menu.js; this function only supplies the
// screen wrapper, topbar and the way out, the same division renderReports()
// uses. Nothing here reads or writes round data, so it is safe to open and
// leave at any point in a round.

function renderBarMenu() {
  return `
    <div class="screen bgm-screen">
      ${topbarHTML()}
      <h1>Bar &amp; Grill</h1>
      ${barMenuHTML()}
      <div style="margin-top:24px;">
        <button class="btn" id="btn-barmenu-home">Home</button>
      </div>
    </div>
  `;
}

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
        <button class="btn" id="btn-reports-home">Home</button>
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
// Score differentials, lowest first. Uses the same .bar-row.thick.fit
// treatment as every other chart on the page (2026-07-26, Paul) — it was a
// horizontal scroller with narrow columns, so eight bars huddled at the left
// while the charts above and below them spanned the full width.
//
// Value sits ABOVE the bar here, matching Hole Ratings and Last 10 Rounds;
// it used to hang below, which put the numbers on a different line from every
// other chart's.
function diffBarRowHTML(diffs) {
  const maxAbs = Math.max(1, ...diffs.map((d) => Math.abs(d)));
  return `<div class="bar-row thick fit">${diffs.map((d) => `
    <div class="bar-col">
      <div class="bar-value">${d.toFixed(1)}</div>
      <div class="bar" style="height:${Math.max(8, Math.round((Math.abs(d) / maxAbs) * 100))}px;"></div>
    </div>`).join('')}</div>`;
}

// 18-hole "avg strokes over par" bar chart, horizontally scrollable.
// Value above the bar, H-prefixed labels, all nine on screen (Paul's comp,
// 2026-07-26). Was bar-then-value with bare numerals in a horizontal scroller;
// nine bars fit a phone without scrolling, and "H3" reads as a hole where a
// lone "3" reads as a score.
// Average ACTUAL strokes per hole, not strokes over par (Paul, 2026-07-26).
// The question this answers is "how many shots does this hole usually cost me"
// — a number to scan against par, hoping for 4 or 5 rather than 7.
//
// SCALED FROM ZERO, deliberately. Strokes are a count with a real zero, so a
// 5.25 bar genuinely is taller than a 3.88 bar. Range-scaling would stretch a
// 1.4-stroke spread across the full height and exaggerate it — and most of that
// spread is just par: the par 3s sit near 4 and the par 4s near 5. Par itself
// is deliberately NOT printed (Paul, 2026-07-26: "just the bars"), so a short
// bar means a short hole, not a hole played well.
function holeRatingBarsHTML(holeRatings) {
  const max = Math.max(1, ...holeRatings.map((h) => h.avgStrokes || 0));
  return `<div class="bar-row thick fit">${holeRatings.map((h) => {
    const v = h.avgStrokes;
    const label = v === null ? '—' : v.toFixed(1);
    const height = v === null ? 4 : Math.max(8, Math.round((v / max) * 100));
    const emptyCls = v === null ? ' bar-empty' : '';
    return `
      <div class="bar-col">
        <div class="bar-value">${label}</div>
        <div class="bar${emptyCls}" style="height:${height}px;"></div>
        <div class="bar-label">H${h.holeNum}</div>
      </div>`;
  }).join('')}</div>`;
}

// Bar row for plain numbers rather than percentages (Putts / GIR Hole, etc).
// barRowHTML hard-codes a % suffix and scales from zero; these values sit in a
// narrow band where zero-scaling flattens them, so it scales within range.
// Bars for plain counts. Scales from zero, which is correct here — unlike a
// scoring average, a count of zero is a real, meaningful zero.
function countBarRowHTML(counts) {
  const max = Math.max(1, ...counts);
  return `<div class="bar-row thick fit">${counts.map((c) => `
      <div class="bar-col">
        <div class="bar-value">${c}</div>
        <div class="bar${c === 0 ? ' bar-zero' : ''}" style="height:${c === 0 ? 3 : Math.max(8, Math.round((c / max) * 100))}px;"></div>
      </div>`).join('')}</div>`;
}

function valueBarRowHTML(items, dp, signed) {
  const vals = items.map((i) => i.value).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(0.1, hi - lo);
  const floor = lo - span * 1.2, ceil = hi + span * 0.25;
  return `<div class="bar-row thick fit wide-cols">${items.map((i) => {
    if (i.value === null || i.value === undefined) {
      return `
      <div class="bar-col">
        <div class="bar-value dim">&mdash;</div>
        <div class="bar bar-empty" style="height:3px;"></div>
        <div class="bar-label">${i.label}</div>
      </div>`;
    }
    const h = Math.max(10, Math.round(((i.value - floor) / (ceil - floor)) * 110));
    return `
      <div class="bar-col">
        <div class="bar-value">${signed && i.value >= 0 ? '+' : ''}${i.value.toFixed(dp)}</div>
        <div class="bar" style="height:${h}px;"></div>
        <div class="bar-label">${i.label}</div>
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
        <h2 class="report-heading">${WEEKLY_METRIC_LABELS[key]}: Weekly Report</h2>
        <div class="bar-row thick">${bars}</div>
      </div>`;
  }).join('');
}

// "Jul 25 2026" — same shape as the Analytics dateline, but built from a round
// record's own date rather than new Date(). Local time, matching how every
// other date-derived stat on the page reads the device's timezone.
function roundDateLabel(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  return `${m} ${d.getDate()} ${d.getFullYear()}`;
}

function todaysStatsHTML(t, roundsToDate, handicap, roundsCount) {
  // "Last Round: <date>" — six equal tiles (3 across x 2 down) with the Actual
  // Score as a hero beside them, per Paul's sketch.
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
      <!-- "Last Round: <date>" (Paul, 2026-07-27), replacing "Today's Round".
           The section has always read mostRecentRound() — see the "most recent
           round only" comment on todaysStats in stats.js — so the old heading
           was the one outright false claim on the page whenever the newest
           round wasn't from today, which is most of the time. The dateline
           above renders new Date() and made it worse: on 2026-07-27 the page
           printed "Jul 27 2026" over a round played on the 25th.
           Stamping the round's OWN date ends the ambiguity outright — it reads
           correctly whether or not the round happened today, so no gating and
           no conditional wording is needed. Format matches the page dateline
           ("Jul 25 2026"); the colon form matches "Trends: Last 20 Rounds" and
           "Scores: Last 10 Rounds".
           NOTE this comment sits inside a JS template literal — no backticks
           and no dollar-brace in here, or the string terminates. (It did.)
           The todaysStats / todaysVisible identifiers keep their names; only
           display text changed. Renaming them is a separate, wider edit. -->
      <h2 class="report-heading">Last Round: ${roundDateLabel(t.date)}</h2>
      <div class="today-round">
        <div class="today-grid">
          ${tile(t.fir.count, 'FIR')}
          ${tile(t.gir.count, 'GIR')}
          ${tile(t.pen.count, 'PEN')}
          ${tile(t.ud.count, 'UD')}
          ${tile(t.putts, 'PUTTS')}
          ${
      // Sixth tile swaps RTD -> HI once a Handicap Index exists (Paul,
      // 2026-07-26). WHS Rule 5.2a establishes no Index below 3 scores, so
      // until then the slot carries Rounds to Date — a number that means
      // something from round one — and hands over the moment HI becomes real.
      //
      // Both conditions are required: the round count AND a non-null handicap.
      // handicap is null when no round has been played from a tee with a
      // Course Rating/Slope on file, which can happen at any round count.
      roundsCount >= 3 && handicap !== null
        ? tile(handicap.toFixed(1), 'HI')
        : tile(roundsToDate, 'RTD')
    }
        </div>
        <div class="today-hero">
          <div class="today-hero-score">${t.totalScore}</div>
          <div class="today-hero-net">Net: ${dash(t.net)}</div>
        </div>
      </div>
      ${barRowHTML([
        { label: 'Birdie', pct: t.birdie.pct },
        { label: 'Par', pct: t.par.pct },
        { label: 'Bogey', pct: t.bogey.pct },
        { label: 'Bogey+', pct: t.bogeyPlus.pct }
      ])}
    </div>`;
}

// Score by Day of Week — average round total per weekday, last 20 rounds.
//
// Two things this does differently from the other bar rows, both deliberate:
//
// 1. THE AXIS IS TRUNCATED. Golf scores cluster in a narrow band (Paul's test
//    data spans 75.7 to 88.8), and scaling those from zero makes seven bars of
//    near-identical height — the same flattening the Last 10 Rounds chart has.
//    Here the scale runs from just below the best day to just above the worst,
//    so a 13-stroke spread actually reads as one. Every bar is labelled with
//    its real average, which is what keeps a truncated axis honest.
//
// 2. A DAY WITH NO ROUNDS IS NOT A ZERO. It draws as an empty rule with a dash,
//    never a bar. Paul's own 20 rounds contain no Tuesday, and a 0.0 bar would
//    say he shot zero rather than that he doesn't play Tuesdays.
// BUILT-BUT-NOT-RENDERED from 2026-07-27 (Paul): "this is a custom Stat".
// Unlike FIR/GIR/scrambling/handicap there's no governing-body definition
// behind Score by Day, and the sample maths didn't support it either — see the
// note in renderAnalytics' `trends` chain. Kept whole, with stats.js's
// scoreByDay, in case it earns its place back at a few hundred rounds.
//
// windowLabelTitle is passed in so the caption can name its window without
// hardcoding "20" — renderAnalytics owns the real round count. Defaults to the
// 20-round wording since this section only rendered once 20 rounds existed.
function scoreByDayHTML(days, windowLabelTitle = 'Last 20 Rounds') {
  const played = days.filter((d) => d.avg !== null).map((d) => d.avg);
  if (!played.length) return '';
  const lo = Math.min(...played);
  const hi = Math.max(...played);
  const span = Math.max(1, hi - lo);
  // Headroom either side so the best day isn't a sliver and the worst isn't
  // pinned to the ceiling.
  const floor = lo - span * 0.35;
  const ceil = hi + span * 0.1;

  return `
    <div class="report-section">
      <h2 class="report-heading">Score by Day of Week</h2>
      <div class="bar-row thick fit">
        ${days.map((d) => {
          if (d.avg === null) {
            return `
        <div class="bar-col">
          <div class="bar-value dim">&mdash;</div>
          <div class="bar bar-empty" style="height:3px;"></div>
          <div class="bar-label">${d.label}</div>
        </div>`;
          }
          const h = Math.max(8, Math.round(((d.avg - floor) / (ceil - floor)) * 110));
          return `
        <div class="bar-col">
          <div class="bar-value">${d.avg.toFixed(1)}</div>
          <div class="bar" style="height:${h}px;"></div>
          <div class="bar-label">${d.label}</div>
        </div>`;
        }).join('')}
      </div>
      <!-- Caption set by Paul 2026-07-27, replacing "Days with no rounds on
           record show a dash." It now states what the values ARE (average gross
           18-hole strokes) and their window, matching Hole Ratings' wording —
           the old caption said neither. The dash itself is no longer explained;
           an empty rule where a bar would be is read as absence, and the
           alternative was a two-sentence note under a seven-bar chart.
           The avg: null → dash path in stats.js is unchanged. -->
      <p class="report-note">Average 18 hole score, ${windowLabelTitle.toLowerCase()}.</p>
    </div>`;
}

// Trends: Last 20 Rounds (Paul, 2026-07-26). Sits at the very bottom of
// Analytics, below Membership ROI — the deepest read on the page.
//
// This is Season Stats and Score Distribution returning, both of which were
// deleted on 2026-07-25, but the two objections that killed them are answered:
//   - They now GATE on a full 20 rounds, so the heading never describes three.
//   - Score Distribution counts ROUND TOTALS across scoring bands, not
//     birdie/par/bogey buckets. Today's Round already charts those per hole;
//     this answers a different question — how often do I break 80 — so the two
//     charts no longer say the same thing twice.
function trendsHTML(a) {
  const t = (value, label) =>
    `<div class="trend-tile"><div class="trend-value">${value}</div>` +
    `<div class="trend-label">${label}</div></div>`;
  const n = (v, dp) => (v === null || v === undefined ? '—' : Number(v).toFixed(dp));
  const p = (v) => (v === null || v === undefined ? '—' : v + '%');
  const se = a.season;
  return `
    <div class="report-section">
      <!-- Footnote form (Paul, 2026-07-27): the asterisk on the heading carries
           the window, the caption just qualifies it. Replaces "All stats are
           based on the last 20 rounds, unless otherwise noted." — which
           restated the heading before getting to its one piece of new
           information. The asterisk is doing real work: this note governs the
           whole page below it, not just this section, and the sections that
           break the rule say so in their own captions (Putting: "All rounds").
           Keep the two marks paired if either is reworded. -->
      <h2 class="report-heading">Trends: Last 20 Rounds*</h2>
      <p class="report-note trend-note">*Unless otherwise noted.</p>
      <!-- Mirrors the rocker console order from the hole screen — FIR, GIR,
           PEN, PUTTS — with HI in the last slot (Today's Round carries RTD
           there, a running count that would read identically here).
           The UD slot holds SCRAMBLING, which is the same event as Today's
           Round's UD count — par saved on a missed green — expressed as a rate
           over 20 rounds instead of a count over one. Neither reads the ud
           rocker; both derive from gir + score, so the figure survives a player
           who forgets to tap, or taps the wrong thing. -->
      <div class="trend-grid">
        ${t(p(se.fir.pct), 'FIR')}
        ${t(p(se.gir.pct), 'GIR')}
        ${t(p(a.twentyRoundAvg.pen.pct), 'PEN')}
        ${t(p(a.scrambling20.pct), 'UD')}
        ${t(n(se.puttsPerRound, 1), 'Putts')}
        ${t(a.handicap === null ? '—' : a.handicap.toFixed(1), 'HI')}
      </div>
      <h2 class="report-heading trend-subheading">Score Distribution</h2>
      ${barRowHTML(a.scoreBands.map((b) => ({ label: b.label, pct: b.pct })))}
    </div>`;
}

// Last 10 Rounds — Actual Score per round, oldest left, most recent right.
// Appears once 10 rounds are logged.
//
// Bars are proportional to the highest score in the window, so they sit at
// similar heights by design: ten rounds inside a few strokes of each other
// SHOULD look level. The numbers above carry the detail; the bars carry the
// shape. All ten fit on screen at once (.bar-row.thick.fit) — this was a
// horizontal scroller until 2026-07-26, which hid the most recent rounds off
// the right edge.
function lastTenHTML(lastTen) {
  const max = Math.max(1, ...lastTen.map((r) => r.totalScore));
  const bars = lastTen.map((r) => `
      <div class="bar-col">
        <div class="bar-value">${r.totalScore}</div>
        <div class="bar" style="height:${Math.max(6, Math.round((r.totalScore / max) * 100))}px;"></div>
      </div>`).join('');
  return `
    <div class="report-section">
      <!-- "Scores: Last 10 Rounds" (Paul, 2026-07-27) — the subject:window form
           already used by "Birdies: Weekly Report" and "Trends: Last 20
           Rounds". Naming the subject matters here because the bars are gross
           18-hole strokes, and the page carries several other per-round numbers
           (differentials, net) it could otherwise be mistaken for.
           Caption drops the window, which the heading now states, and keeps
           only the reading direction. -->
      <h2 class="report-heading">Scores: Last 10 Rounds</h2>
      <div class="bar-row thick fit">${bars}</div>
      <p class="report-note">Most recent on the right.</p>
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
      <h2 class="report-heading">Strokes per Hole</h2>
      <p class="section-empty">Play a round to see your hole-by-hole average.</p>
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
  // Redesigned 2026-07-26 to Paul's pasted comp: the chart leads, the number
  // follows as a stated line rather than a hero numeral. The count is NOT
  // hard-coded to 8 — WHS Rule 5.2a counts fewer differentials below 20 rounds
  // (lowest 3 at 9-11, and so on), so the heading reads off what was actually
  // used. It says "Best 8 of Last 20" only when it really is 8 of 20.
  const nDiff = a.best8Differentials.length;
  const handicapSection = `
    <div class="report-section">
      <h2 class="report-heading">${nDiff ? `Best ${nDiff} of ${windowLabelTitle}` : 'Score Differentials'}</h2>
      ${nDiff
        ? diffBarRowHTML(a.best8Differentials)
        : (a.handicap === null
            ? '<p class="section-empty">A Handicap Index needs at least 3 rounds (WHS Rule 5.2a).</p>'
            : '<p class="section-empty">No rounds on a recognized tee yet — Score Differential needs Course Rating/Slope from your tee.</p>')}
      ${nDiff ? '<p class="report-note">Follows the World Handicap System.</p>' : ''}
      ${a.handicap !== null
        ? `<p class="handicap-line">${isEstimate ? 'Your estimated handicap is' : 'Your Handicap Index is'}: ${a.handicap.toFixed(1)}</p>`
        : ''}
      ${isEstimate
        ? `<p class="report-note">${hs.roundsToEstablish} more round${hs.roundsToEstablish === 1 ? '' : 's'} to establish a Handicap Index.</p>`
        : ''}
    </div>`;

  // Monthly Scoring Trend (Paul's comp, 2026-07-26). Range-scaled like Score by
  // Day — month averages sit in a narrow band and zero-scaling flattens them.
  //
  // BUILT-BUT-NOT-RENDERED from 2026-07-27 (Paul), and off the page for the
  // same reason as Score by Day: a custom stat, on a sample that can't carry
  // it. Twenty rounds split by calendar month gave three bars spanning 83.0 /
  // 82.9 / 81.5 — a 1.5-stroke range, well inside the noise of any single
  // round, drawn range-scaled so that gap filled the chart. It also answered
  // roughly what Last 10 Rounds answers, one zoom level out.
  // Restoring it is one line in the `trends` chain; stats.js's monthlyScoring
  // is untouched.
  const monthlyTrend = a.monthlyScoring.length
    ? `
    <div class="report-section">
      <h2 class="report-heading">Monthly Scoring Trend</h2>
      ${valueBarRowHTML(a.monthlyScoring.map((m) => ({ label: m.label, value: m.avg })), 1)}
      <p class="report-note">Average 18 hole score by month, ${windowLabel.toLowerCase()}.</p>
    </div>`
    : '';

  // No UD row here (Paul, 2026-07-27). UD/Scrambling is ONE number and it was
  // printing in three places at once — this table, the Trends grid, and the
  // Putting card — all reading 12%, with nothing on screen to say they were the
  // same stat rather than three that happened to agree. The Trends tile won the
  // slot, since that grid is where UD reads as a peer of FIR/GIR/PEN. Do not
  // add it back here without taking it out of Trends.
  const twentyRoundAvg = `
    <div class="report-section">
      <h2 class="report-heading">${windowN} Round Average</h2>
      <table class="stat-table stat-table-headed">
        <tr><th>Stat</th><th>Avg</th></tr>
        <tr><td>FIR</td><td>${a.twentyRoundAvg.fir.pct}%</td></tr>
        <tr><td>GIR</td><td>${a.twentyRoundAvg.gir.pct}%</td></tr>
        <tr><td>PEN</td><td>${a.twentyRoundAvg.pen.pct}%</td></tr>
        <tr><td>Putts</td><td>${a.season.puttsPerRound === null ? '—' : a.season.puttsPerRound.toFixed(1)}</td></tr>
      </table>
    </div>`;

  // "Strokes per Hole", not "Hole Ratings" (Paul, 2026-07-27). The old heading
  // borrowed WHS vocabulary — Course Rating and Slope Rating are real, defined
  // things this app computes elsewhere, and a "Hole Rating" is not one of them.
  // The new heading says exactly what the bars are. The const and stats.js's
  // `holeRatings` keep their names; only the heading changed.
  const holeRatings = `
    <div class="report-section">
      <h2 class="report-heading">Strokes per Hole</h2>
      ${holeRatingBarsHTML(a.holeRatings)}
      <p class="report-note">Average, ${windowLabel.toLowerCase()}.</p>
    </div>`;

  // Stats Breakdown — the same four buckets Today's Round charts, but across
  // the last 20 rounds instead of one. Renamed from "Scoring Breakdown"
  // 2026-07-27 (Paul); the const keeps its old name, only the heading changed.
  // Deliberately NOT the duplication that
  // got the old 20-round Score Distribution deleted on 2026-07-25: that one
  // rendered from round one with no window stated, so it sat beside Today's
  // Round saying the same thing. This is explicitly the 20-round trend, and
  // Trends' own Score Distribution charts round TOTALS in bands, not holes.
  const scoringBreakdown = `
    <div class="report-section">
      <h2 class="report-heading">Stats Breakdown</h2>
      ${barRowHTML([
        { label: 'Birdie', pct: a.scoreDistribution.birdie.pct },
        { label: 'Par', pct: a.scoreDistribution.par.pct },
        { label: 'Bogey', pct: a.scoreDistribution.bogey.pct },
        { label: 'Bogey+', pct: a.scoreDistribution.bogeyPlus.pct }
      ])}
      <!-- Caption cut to the bare window label (Paul, 2026-07-27). Uses
           windowLabelTitle, not a literal "Last 20 Rounds", so it still tells
           the truth if this ever renders below a full 20. The bars are
           percentages and read as shares without being told. -->
      <p class="report-note">${windowLabelTitle}</p>
    </div>`;

  // 1 Putts — one bar per round, oldest left, matching Last 10 Rounds'
  // ordering. Counts, not percentages, so it scales from zero: a round with no
  // one-putts genuinely is zero here, unlike a scoring average.
  //
  // Was "1 Putt Par Saves" until 2026-07-27 (Paul). It claimed to be a par-save
  // stat while filtering on `score <= par`, so it counted birdies from off the
  // green and ran higher than the real par-save count. Correcting it would have
  // made it Scrambling drawn a second time; counting every one-putt instead
  // makes it a putting stat that duplicates nothing. See stats.js `onePutts`.
  //
  // BUILT-BUT-NOT-RENDERED from 2026-07-27 (Paul) — pulled off the page along
  // with Penalty Impact. Correct and computed; restoring it is one line in the
  // `trends` chain below. `stats.js`'s `onePutts` is untouched.
  const onePutts = `
    <div class="report-section">
      <h2 class="report-heading">1 Putts</h2>
      ${countBarRowHTML(a.onePutts.map((r) => r.count))}
      <p class="report-note">One-putt greens per round, last ${a.onePutts.length} round${a.onePutts.length === 1 ? '' : 's'}.</p>
    </div>`;

  // Penalty Impact — its own section from 2026-07-26 (Paul's comp). It lived in
  // the Scrambling & Putting table only for want of a home; it is a
  // course-management stat, not a short-game one.
  //
  // BUILT-BUT-NOT-RENDERED from 2026-07-27 (Paul). Note the page still carries
  // PEN as a rate (Today's Round count, Trends tile, 20 Round Average row) —
  // what's gone is the strokes-lost comparison, not penalties as a stat.
  // Restoring it is one line in the `trends` chain below; `stats.js`'s
  // `penaltyImpact` is untouched.
  const penaltySection = `
    <div class="report-section">
      <h2 class="report-heading">Penalty Impact</h2>
      ${valueBarRowHTML([
        { label: 'Holes w/ PEN', value: a.penaltyImpact.withPen },
        { label: 'Holes w/o PEN', value: a.penaltyImpact.withoutPen }
      ], 1, true)}
      <p class="report-note">Average strokes over par on holes with a penalty, against holes without.</p>
    </div>`;

  // Putting — the charted replacement for the old Scrambling & Putting table
  // (Paul's comp, 2026-07-26). Two stats from that table are NOT carried over:
  // Penalty Impact and No-Penalty Avg, which were never short-game stats and
  // only lived there for want of a home; and Up-and-Down %, which sat next to
  // Scrambling % looking like the same number computed wrong (34% vs 13% —
  // ud flag vs par-or-better). Scrambling survives, stated with its definition.
  const putting = `
    <div class="report-section">
      <h2 class="report-heading">Putting</h2>
      ${barRowHTML([
        { label: '1 Putt', pct: a.puttDistribution.onePutt.pct },
        { label: '2 Putts', pct: a.puttDistribution.twoPutt.pct },
        { label: '3+ Putts', pct: a.puttDistribution.threePuttPlus.pct }
      ])}
      <!-- The Scrambling line that sat here was dropped 2026-07-27 (Paul). It
           was the third printing of the UD figure on one page; the UD tile in
           the Trends grid is now the single home for it. What's left here is
           putting only — and since the 1 Putts chart came off the page on
           2026-07-27, these three bars are the whole of putting on Analytics. -->
      <!-- "All rounds", stated explicitly: puttDistribution is computed off
           allHoleRecords, but the Trends heading above declares the page is
           last-20 "unless otherwise noted" — so this is the noting. Window it
           to 20 and this caption goes back to the default. -->
      <p class="report-note">Share of greens by putts taken. All rounds.</p>
    </div>`;

  const weeklyTrends = a.weeklyVisible
    ? weeklySectionHTML(a.weekly, a.weeklyNewSlotIndex)
    : ['Birdies', 'Pars', 'Bogeys', 'Bogey+'].map((label) => `
    <div class="report-section">
      <h2 class="report-heading">${label}: Weekly Report</h2>
      <p class="section-empty">Play one more round (2 total) to unlock weekly trends.</p>
    </div>`).join('');

  const todaysStats = a.todaysVisible && a.todaysStats
    ? todaysStatsHTML(a.todaysStats, a.roundsToDate, a.handicap, a.roundsCount)
    : '';

  const membershipRoi = a.roi
    ? membershipROIHTML(a.roi, a.offSeason)
    : `
    <div class="report-section">
      <h2 class="report-heading">Membership ROI</h2>
      <p class="section-empty">Set up your membership fee and green fee in Settings to see savings.</p>
    </div>`;

  const lastTenSection = a.lastTenVisible && a.lastTen.length ? lastTenHTML(a.lastTen) : '';

  // Handicap Index, 20 Round Average, Hole Ratings and Scrambling & Putting sat
  // BUILT-BUT-NOT-RENDERED from 2026-07-25 while their placement was decided.
  // Rendered from 2026-07-26 (Paul), in the position the old note argued for:
  // below the weekly charts, which are the "tweener" content for the ~7 weeks
  // before 20 rounds of history exist.
  //
  // Ordering runs shallow to deep — the single Handicap Index number first,
  // then the three-figure 20 Round Average, then the per-hole chart, then the
  // detail table. Last 10 Rounds stays last of the charts because it's the
  // narrowest window, and Membership ROI stays at the very bottom since it's
  // money rather than golf.
  //
  // NOTE these four do not gate on round count. buildAnalytics computes them
  // from lastN(sorted, 20), so at three rounds they are a three-round average
  // wearing a "20 Round" label. That's the presentation question Paul still has
  // open — Season Stats and the 20-round Score Distribution were deleted on
  // 2026-07-25 for exactly this reason. See windowLabel/windowLabelTitle above,
  // which already read off the real count and are what these should use.
  // Everything below Last 10 Rounds that reads a 20-round window is gated on
  // a full 20 (Paul, 2026-07-26: "are there 20 rounds yet, yes-then render,
  // no-stay hidden"). Below that the windows aren't full and the headings would
  // be describing three rounds — exactly what got Season Stats deleted on
  // 2026-07-25. Nothing is shown in their place: placeholders for a dozen
  // locked sections would be more noise than the sections are worth.
  // Bottom run, in the order Paul is pasting the comps: Trends, then Best N of
  // Last 20, then Score by Day. Handicap moved down here from the deep block so
  // the best-8 chart isn't drawn twice on one page.
  // The pasted comps run contiguously and in the order Paul supplied them.
  const trendsSection = a.twentyRoundStatsVisible ? trendsHTML(a) : '';
  const bestEightSection = a.twentyRoundStatsVisible ? handicapSection : '';
  const holeRatingsSection = a.twentyRoundStatsVisible ? holeRatings : '';
  const trends = a.twentyRoundStatsVisible
    ? scoringBreakdown
      + putting
      // FOUR sections came out of this chain on 2026-07-27 (Paul), in order:
      // 1 Putts, Penalty Impact, Score by Day of Week, Monthly Scoring Trend.
      // The last two share a reason — custom stats with no governing definition
      // behind them, drawn on a sample too thin to say what the chart implied.
      // Score by Day split 20 rounds seven ways (2-5 per bar; Thursday's four
      // alone spanned 67 to 91, wider inside one day than between any two).
      // Monthly split them three ways for a 1.5-stroke spread, range-scaled so
      // it filled the frame.
      // Every builder survives above and stats.js still computes onePutts /
      // penaltyImpact / scoreByDay / monthlyScoring. Restoring any is one line
      // here, in position.
      + twentyRoundAvg
    : '';

  // Best 8 sits directly under Last 10 Rounds (Paul, 2026-07-26) — the two
  // recent-form charts read together, and the Handicap Index line travels with
  // it rather than being stranded further down the page.
  return todaysStats
    + weeklyTrends
    + lastTenSection
    + trendsSection
    + bestEightSection
    + holeRatingsSection
    + membershipRoi
    + trends;
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
      // Settings no longer shows a weather readout, but the fetch still runs
      // here so weatherState is warm if the user goes straight from Settings
      // into a round — the snapshot taken at tee-off can't be backfilled.
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
          // GIR and UD are mutually exclusive (Paul, 2026-07-26): "physically
          // impossible to have both a gir and a ud". Hitting the green in
          // regulation means there was no par to save. Enforced at ENTRY so the
          // combination can never be written to a round in the first place —
          // cheaper than teaching every reader to distrust the pair.
          if (key === 'gir' && d.gir) d.ud = false;
          if (key === 'ud' && d.ud) d.gir = false;
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
    case 'saved': {
      // Deliberately no other handlers — the screen has no controls. The ⋮ menu
      // is wired unconditionally by attachMenuHandlers().
      playSavedSequence();
      break;
    }
    case 'front9score': {
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
          if (state.front9Continue !== false) {
            // Continue: advance into Hole 10.
            goToHoleScreen();
          } else {
            // Post Now: bank this first nine as a Widow (pairs with a waiting
            // widow into a full round, if there is one).
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
    case 'barmenu': {
      const homeBtn = document.getElementById('btn-barmenu-home');
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
  const itemBarMenu = document.getElementById('menu-item-barmenu');
  const itemPlay = document.getElementById('menu-item-play');
  const itemSettings = document.getElementById('menu-item-settings');

  const closeMenu = () => { state.menuOpen = false; render(); };
  if (scrim) scrim.addEventListener('click', closeMenu);
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);
  if (itemAnalytics) itemAnalytics.addEventListener('click', () => { state.menuOpen = false; state.screen = 'reports'; render(); });
  if (itemBarMenu) itemBarMenu.addEventListener('click', () => {
    state.menuOpen = false;
    state.screen = 'barmenu';
    // Scroll to the top on arrival. The menu is a long page opened from a
    // topbar that may itself be scrolled well down Analytics; without this
    // you land in the middle of the beer list.
    window.scrollTo(0, 0);
    render();
  });
  if (itemPlay) itemPlay.addEventListener('click', () => { state.menuOpen = false; state.screen = 'startround'; render(); });
  if (itemSettings) itemSettings.addEventListener('click', () => {
    state.menuOpen = false;
    state.fromSettings = true;
    // Remember where Settings was opened FROM so Save can return there
    // (2026-07-26). Without this, Save always dove into a hole screen — open
    // Settings from the Front 9 Score card and Save landed you on Hole 10.
    // Not the same thing as the `last-screen` key: that one gets overwritten
    // with 'setup' the moment this screen renders, so it can't answer "where
    // did I come from". In-memory only, which is correct — a reload from
    // Settings is boot()'s problem, and it already handles it.
    state.settingsReturnTo = state.screen;
    state.screen = 'setup';
    render();
  });

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
