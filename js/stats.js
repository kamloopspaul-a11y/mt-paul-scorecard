// A Bit of Bogey — Analytics/Reports stat engine. Pass 2 scope.
//
// SINGLE PLACE that turns raw `rounds-history` (+ settings + handicap ratings)
// into every number the Reports screen shows. Every function here is a pure,
// stateless read of whatever data it's given — nothing is cached/stored as a
// running total. Callers (app.js) should re-run buildAnalytics() on every
// render so the numbers always reflect the freshest localStorage state.
//
// Adapted from the aggregator pattern in `Design Handoff/A Bit of Bogey.dc.html`
// (flattenHoleRecords / aggregateHoles / countAndPct / avg), extended per
// Design Handoff/README.md section 4 to also carry `fir` and `ud` on every
// flattened hole record, plus round-level and weekly helpers needed for the
// full stat table.

import { KEYS } from './storage.js';
const WEEKLY_ANIM_KEY = KEYS.WEEKLY_ANIM_SEEN;

// ===================== Core aggregator primitives =====================

// Flattens every round's holes into one flat list, across the whole
// rounds-history array (or whatever subset the caller passes in — callers
// take last-N slices of ROUNDS before flattening, so windowing always happens
// at the round level, never by truncating a flat list).
export function flattenHoleRecords(roundsHistory) {
  const flat = [];
  (roundsHistory || []).forEach((round) => {
    (round.holes || []).forEach((h) => {
      flat.push({
        date: round.date,
        holeNum: h.holeNum,
        par: h.par,
        // Stroke index, captured onto the hole at play time (app.js
        // goToHoleScreen). null on rounds saved before that landed — every
        // consumer treats null as "fall back to the ratings file".
        si: typeof h.si === 'number' ? h.si : null,
        score: h.score,
        putts: h.putts || 0,
        // fir is true|false|null — null (par 3, no fairway) must never be
        // coerced into a false "miss". Only true/false pass through as-is.
        fir: h.fir === true || h.fir === false ? h.fir : null,
        gir: !!h.gir,
        pen: !!h.pen,
        ud: !!h.ud
      });
    });
  });
  return flat;
}

// Filters a hole-record list by `predicate`, then hands the matches to
// `reducer` (typically the result of countAndPct(...) or avg(...)).
export function aggregateHoles(holeRecords, predicate, reducer) {
  return reducer((holeRecords || []).filter(predicate));
}

// Returns a reducer: {count, pct} of holes matching `matchPredicate` out of
// the holes passed in. {0,0} on an empty set — never NaN.
export function countAndPct(matchPredicate) {
  return (holes) => {
    if (!holes || !holes.length) return { count: 0, pct: 0 };
    const count = holes.filter(matchPredicate).length;
    return { count, pct: Math.round((count / holes.length) * 100) };
  };
}

// Returns a reducer: mean of valueFn(hole) over the holes passed in. `null`
// (not 0, not NaN) on an empty set, e.g. "no PEN logged yet".
export function avg(valueFn) {
  return (holes) => {
    if (!holes || !holes.length) return null;
    return holes.reduce((sum, h) => sum + valueFn(h), 0) / holes.length;
  };
}

// Round-level analogue of avg() — mean of valueFn(round) over a list of
// rounds. `null` on empty, never NaN.
export function avgRounds(rounds, valueFn) {
  if (!rounds || !rounds.length) return null;
  return rounds.reduce((sum, r) => sum + valueFn(r), 0) / rounds.length;
}

// ===================== Round-level helpers =====================

export function sortRoundsByDate(roundsHistory) {
  return (roundsHistory || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
}

export function lastN(arr, n) {
  return (arr || []).slice(-n);
}

// front9Score/back9Score/totalScore are computed once at save time by
// buildRoundRecord() and stored on the record — these helpers just read that
// stored value, falling back to summing holes only for defensive robustness
// (e.g. a hand-rolled test fixture that omits the precomputed totals).
export function roundFront9Score(r) {
  if (r.front9Score != null) return r.front9Score;
  return (r.holes || []).slice(0, 9).reduce((s, h) => s + (h.score || 0), 0);
}
export function roundBack9Score(r) {
  if (r.back9Score != null) return r.back9Score;
  return (r.holes || []).slice(9, 18).reduce((s, h) => s + (h.score || 0), 0);
}
export function roundTotalScore(r) {
  if (r.totalScore != null) return r.totalScore;
  return roundFront9Score(r) + roundBack9Score(r);
}
export function roundPutts(r) {
  return (r.holes || []).reduce((s, h) => s + (h.putts || 0), 0);
}

export function mostRecentRound(roundsHistory) {
  const sorted = sortRoundsByDate(roundsHistory);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

// ===================== Handicap / Score Differential (WHS-style) =====================
//
// mt-paul-handicap-ratings.json is the source of truth for Course Rating /
// Slope Rating per README ("ratings are re-issued seasonally, kept separate"
// from mt-paul-course-data.json's hole/yardage data). Fetched + cached the
// same way course-data.js caches mt-paul-course-data.json.

let _handicapCache = null;

export async function loadHandicapRatings() {
  if (_handicapCache) return _handicapCache;
  const res = await fetch('./mt-paul-handicap-ratings.json');
  if (!res.ok) throw new Error('Failed to load mt-paul-handicap-ratings.json: ' + res.status);
  _handicapCache = await res.json();
  return _handicapCache;
}

// Course Rating / Slope Rating for a tee ('blue' | 'red') under a rating set
// ('male' | 'female').
//
// Mt. Paul rates both Blue and Red for men AND ladies off the same physical
// tees — the holes, yardages and stroke index are shared, only CR/Slope differ.
// The gap is large enough to matter: an 82 on Blue is a 30.2 differential on
// the men's rating and 23.6 on the ladies'. Until 2026-07-25 this function
// hardcoded `.male`, so the ladies' set was unreachable.
//
// `ratingSet` comes from the ROUND (captured when it was played), not live from
// Settings, so flipping the Settings switch never rewrites posted rounds.
// Rounds saved before that field existed pass undefined and fall back to male,
// which is what they were actually calculated with. Falls back to male too if
// the requested set isn't published for this tee.
export function getTeeRatings(handicapData, tee, ratingSet = 'male') {
  if (!handicapData || !handicapData.ratings) return null;
  const teeName = tee === 'red' ? 'Red' : 'Blue';
  const set = ratingSet === 'female' ? 'female' : 'male';
  const ratings = handicapData.ratings[set] || handicapData.ratings.male;
  const entry = (ratings && ratings[teeName])
    || (handicapData.ratings.male && handicapData.ratings.male[teeName]);
  if (!entry) return null;
  return { courseRating: entry.course_rating, slopeRating: entry.slope_rating };
}

// The rating set a round was played under, defaulting to male for rounds saved
// before the field existed.
export function roundRatingSet(round) {
  return round && round.ratingSet === 'female' ? 'female' : 'male';
}

// --- Stroke index (2026-07-25) -------------------------------------------
//
// Net double bogey (Rule 3.1b, below) needs each hole's stroke index. Order of
// preference, most portable first:
//   1. `h.si` on the hole record itself — travels with the round, so a history
//      spanning several courses stays correct. Nothing writes this yet; when
//      multi-course support lands, capture SI onto the hole at save time and
//      this path takes over with no further change here.
//   2. mt-paul-handicap-ratings.json's `stroke_index` map, by hole number.
// Returns null when neither is available, which makes adjustedGrossScore fall
// back to the unadjusted total rather than silently guessing at SI 1.
export function strokeIndexForHole(hole, handicapData) {
  if (typeof hole.si === 'number') return hole.si;
  const si = handicapData && handicapData.stroke_index;
  if (!si) return null;
  const n = hole.holeNum;
  const bucket = n <= 9 ? si.out : si.in;
  const v = bucket && bucket['H' + n];
  return typeof v === 'number' ? v : null;
}

// Course Handicap = Handicap Index × (Slope / 113) + (Course Rating − par),
// rounded to the nearest whole number (Rule 6.1a). Used here only to work out
// how many strokes are received on each hole for the net double bogey cap.
export function courseHandicap(index, teeRatings, parTotal) {
  if (index === null || !teeRatings || !teeRatings.slopeRating) return null;
  return Math.round(
    index * (teeRatings.slopeRating / 113) + (teeRatings.courseRating - parTotal)
  );
}

// Strokes received on a hole of stroke index `si` from a Course Handicap of
// `ch`, over an 18-hole course: one stroke per full loop of 18, plus one more
// on the `ch % 18` hardest holes. A plus handicap gives strokes back, starting
// from the easiest hole (SI 18) — returned as a negative number.
export function strokesReceivedOnHole(ch, si, holeCount = 18) {
  if (ch === null || si === null) return 0;
  if (ch >= 0) return Math.floor(ch / holeCount) + (si <= ch % holeCount ? 1 : 0);
  const give = -ch;
  return -(Math.floor(give / holeCount) + (si > holeCount - (give % holeCount) ? 1 : 0));
}

// Adjusted Gross Score (Rule 3.1) — the score differential is computed from
// this, NOT from the raw gross total, so one blow-up hole can't distort a
// Handicap Index.
//
//   * With an established Handicap Index (3.1b): every hole is capped at
//     net double bogey = par + 2 + strokes received on that hole.
//     Exception: a Course Handicap over 54 receiving 4+ strokes on a hole caps
//     at par + 5 instead.
//   * Before an index is established (3.1a): every hole caps at par + 5.
//
// If stroke index data can't be resolved, returns the unadjusted total — an
// under-adjusted (never over-adjusted) score, which is the safe direction.
export function adjustedGrossScore(round, handicapData, ch, { established = true } = {}) {
  const holes = round.holes || [];
  return holes.reduce((sum, h) => {
    const par = h.par || 0;
    if (!established) return sum + Math.min(h.score, par + 5);
    const si = strokeIndexForHole(h, handicapData);
    if (si === null || ch === null) return sum + h.score;
    const strokes = strokesReceivedOnHole(ch, si);
    const cap = ch > 54 && strokes >= 4 ? par + 5 : par + 2 + strokes;
    return sum + Math.min(h.score, cap);
  }, 0);
}

// Score Differential = (Adjusted Gross Score − Course Rating − PCC) × 113 / Slope,
// rounded to 1 decimal (Rule 5.1).
//
// PCC (playing conditions calculation, Rule 5.6) is always 0 here and that is
// correct rather than a shortcut: it needs at least eight acceptable scores
// submitted by different players on the same course on the same day, and is
// defined as 0 when fewer are available. A single-player app never has a field.
//
// Returns null if ratings aren't resolvable for this round's tee, rather than
// dividing by an undefined slope.
export function scoreDifferential(round, handicapData, ch = null, opts = {}) {
  const teeRatings = getTeeRatings(handicapData, round.tee, roundRatingSet(round));
  if (!teeRatings || !teeRatings.slopeRating) return null;
  const total = adjustedGrossScore(round, handicapData, ch, opts);
  const diff = ((total - teeRatings.courseRating) * 113) / teeRatings.slopeRating;
  return Math.round(diff * 10) / 10;
}

// Rule 5.2a — with fewer than 20 differentials on record, how many of the
// lowest to average and what adjustment to subtract from the result. Below 3
// scores no Handicap Index exists at all.
const WHS_TABLE = [
  /* 0-2 */ null, null, null,
  /* 3  */ { take: 1, adjust: -2.0 },
  /* 4  */ { take: 1, adjust: -1.0 },
  /* 5  */ { take: 1, adjust: 0 },
  /* 6  */ { take: 2, adjust: -1.0 },
  /* 7  */ { take: 2, adjust: 0 },
  /* 8  */ { take: 2, adjust: 0 },
  /* 9  */ { take: 3, adjust: 0 },
  /* 10 */ { take: 3, adjust: 0 },
  /* 11 */ { take: 3, adjust: 0 },
  /* 12 */ { take: 4, adjust: 0 },
  /* 13 */ { take: 4, adjust: 0 },
  /* 14 */ { take: 4, adjust: 0 },
  /* 15 */ { take: 5, adjust: 0 },
  /* 16 */ { take: 5, adjust: 0 },
  /* 17 */ { take: 6, adjust: 0 },
  /* 18 */ { take: 6, adjust: 0 },
  /* 19 */ { take: 7, adjust: 0 },
  /* 20 */ { take: 8, adjust: 0 }
];

export const MAX_HANDICAP_INDEX = 54.0; // Rule 5.3

export function whsSelectionFor(count) {
  if (count < 3) return null;
  return WHS_TABLE[Math.min(count, 20)];
}

// Rounds needed before a Handicap Index exists at all (Rule 5.2a's table
// starts at 3). Below this the app shows an estimate, clearly labelled.
export const ROUNDS_TO_ESTABLISH = 3;

// Whether a Handicap Index was in effect when the round at chronological
// position `i` (0-based, oldest first, across the WHOLE history) was played.
//
// This is a per-round property, not a global one, and it decides which cap
// Rule 3.1 applies: par + 5 before an index exists (3.1a), net double bogey
// after (3.1b). An index is established once 3 scores have been submitted, so
// the first three rounds were all played without one and keep the par + 5 cap
// permanently — WHS does not retroactively re-adjust scores once an index
// arrives. Round 4 onward is the first played with an index in effect.
export function indexInEffectFor(i) {
  return i >= ROUNDS_TO_ESTABLISH;
}

// Every acceptable differential in the handicap window (most recent 20),
// ascending. `established` is resolved per round from its position in the full
// history, so the oldest rounds keep their par+5 caps.
export function windowDifferentials(roundsHistory, handicapData, ch = null) {
  const all = sortRoundsByDate(roundsHistory);
  const firstInWindow = Math.max(0, all.length - 20);
  return all
    .slice(firstInWindow)
    .map((r, k) =>
      scoreDifferential(r, handicapData, ch, { established: indexInEffectFor(firstInWindow + k) })
    )
    .filter((d) => d !== null)
    .sort((a, b) => a - b);
}

// The differentials actually used in the Handicap Index calculation: the
// lowest `take` of the most recent 20, ascending. Named for what it is rather
// than "best 8" — with fewer than 20 scores on record it is not 8 (Rule 5.2a).
export function countingDifferentials(roundsHistory, handicapData, ch = null) {
  const diffs = windowDifferentials(roundsHistory, handicapData, ch);
  const sel = whsSelectionFor(diffs.length) || ESTIMATE_SELECTION;
  return diffs.slice(0, Math.min(sel.take, diffs.length));
}

// Below 3 scores WHS defines no Handicap Index, so there is no rule to follow
// and the app is on its own. Staying as close as possible: reuse the 3-score
// row exactly (lowest 1, adjustment -2.0). Because it is the same formula the
// real Index will use at round 3, the number does not lurch when it becomes
// official — only the label changes.
const ESTIMATE_SELECTION = { take: 1, adjust: -2.0 };

// WHS Handicap Index (Rules 5.2a / 5.2b / 5.3): average the lowest N of the
// most recent 20 Score Differentials per the table above, apply that row's
// adjustment, ROUND (not truncate) to the nearest tenth, and cap at 54.0.
//
// There is no 0.96 multiplier — that belonged to the pre-2020 USGA system,
// which also used the lowest 10 of 20 rather than 8.
//
// The circularity — differentials need adjusted gross scores, which need a
// Course Handicap, which needs a Handicap Index — is resolved the way WHS does
// in spirit (each score is adjusted using the index in effect when it was
// played) but without storing index history: iterate to a fixed point, seeding
// from the unadjusted differentials. Converges in 2-3 passes in practice; the
// loop is capped regardless and returns its last value.
//
// Returns null with no acceptable scores at all. With 1-2 scores it returns an
// ESTIMATE (see handicapWithStatus() to tell which you have); at 3+ it is a
// real Handicap Index.
export function handicapIndex(roundsHistory, handicapData) {
  const rounds = lastN(sortRoundsByDate(roundsHistory), 20);
  if (!rounds.length) return null;

  const newest = rounds[rounds.length - 1];
  const parTotal = (newest.holes || []).reduce((s, h) => s + (h.par || 0), 0);
  const teeRatings = getTeeRatings(handicapData, newest.tee, roundRatingSet(newest));

  const compute = (ch) => {
    const diffs = windowDifferentials(roundsHistory, handicapData, ch);
    if (!diffs.length) return null;
    const sel = whsSelectionFor(diffs.length) || ESTIMATE_SELECTION;
    const used = diffs.slice(0, Math.min(sel.take, diffs.length));
    const mean = used.reduce((s, v) => s + v, 0) / used.length;
    return Math.min(MAX_HANDICAP_INDEX, Math.round((mean + sel.adjust) * 10) / 10);
  };

  // Seed with no Course Handicap: rounds played before an index existed cap at
  // par+5 either way, and the rest fall back to their unadjusted totals for
  // this first pass only.
  let index = compute(null);
  if (index === null) return null;

  for (let i = 0; i < 6; i++) {
    const next = compute(courseHandicap(index, teeRatings, parTotal));
    if (next === null || next === index) return next === null ? index : next;
    index = next;
  }
  return index;
}

// The handicap figure plus what it actually is, for the Analytics label.
//   status 'index'    — a real WHS Handicap Index (3+ acceptable scores)
//   status 'estimate' — our own approximation (1-2 scores); WHS defines none
//   status null       — nothing to show yet
export function handicapWithStatus(roundsHistory, handicapData) {
  const count = windowDifferentials(roundsHistory, handicapData, null).length;
  const value = handicapIndex(roundsHistory, handicapData);
  if (value === null || count === 0) {
    return { value: null, status: null, scoreCount: count, roundsToEstablish: ROUNDS_TO_ESTABLISH };
  }
  return {
    value,
    status: count >= ROUNDS_TO_ESTABLISH ? 'index' : 'estimate',
    scoreCount: count,
    roundsToEstablish: Math.max(0, ROUNDS_TO_ESTABLISH - count)
  };
}

// Back-compat alias for the Analytics screen's "Best 8 Score Differentials of
// Last 20 Rounds" card. Recomputes the Course Handicap the same way
// handicapIndex() lands on it so the listed differentials are the ones the
// index was actually built from.
export function best8Of20Differentials(roundsHistory, handicapData) {
  const rounds = lastN(sortRoundsByDate(roundsHistory), 20);
  if (!rounds.length) return [];
  const newest = rounds[rounds.length - 1];
  const parTotal = (newest.holes || []).reduce((s, h) => s + (h.par || 0), 0);
  const index = handicapIndex(roundsHistory, handicapData);
  if (index === null) return [];
  const ch = courseHandicap(index, getTeeRatings(handicapData, newest.tee, roundRatingSet(newest)), parTotal);
  return countingDifferentials(roundsHistory, handicapData, ch);
}

// ===================== Weekly grouping (Monday-start week) =====================

export const WEEKLY_LABELS = ['4 Wks Ago', '3 Wks Ago', 'Last Wk', 'This Wk'];

export function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday-start week
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

const SCORE_BUCKET_PREDICATES = {
  birdie: (h) => h.score < h.par,
  par: (h) => h.score === h.par,
  bogey: (h) => h.score === h.par + 1,
  bogeyPlus: (h) => h.score >= h.par + 2
};

// Groups a round's holes by the ISO/Monday-start week the round was played,
// and returns countAndPct for `metricKey` (birdie|par|bogey|bogeyPlus) per
// week, right-aligned so the most recent week is always the last slot.
//
// Pass 5 Fix 2: the window is anchored on the REAL current date (`now`,
// defaulting to `new Date()` at call time), not on "whatever weeks happen to
// have rounds in rounds-history". Previously this took the last N distinct
// weeks that had any data, sorted — so a gap in play (e.g. skipping 2 weeks)
// silently shifted the labels onto whichever earlier weeks did have data,
// instead of showing the actual skipped weeks as empty. Now we compute the
// exact 4 real calendar week-start keys walking back from this week and look
// each one up in the byWeek map — a real calendar week with zero rounds
// genuinely renders as an empty slot (hasData:false) rather than being
// skipped over.
export function computeWeeklyWindow(roundsHistory, metricKey, weekCount = 4, now = new Date()) {
  const rounds = sortRoundsByDate(roundsHistory);
  const predicate = SCORE_BUCKET_PREDICATES[metricKey] || (() => false);
  const byWeek = new Map(); // weekStart -> { matched, total }
  rounds.forEach((r) => {
    const wk = getWeekStart(r.date);
    const holes = r.holes || [];
    const matched = holes.filter(predicate).length;
    const entry = byWeek.get(wk) || { matched: 0, total: 0 };
    entry.matched += matched;
    entry.total += holes.length;
    byWeek.set(wk, entry);
  });

  // Walk back from this week's Monday-start key, weekCount-1 weeks at a time,
  // to get the exact calendar week-start keys for the window (oldest first,
  // so the array lines up with WEEKLY_LABELS' "N Wks Ago" -> "This Wk" order).
  const thisWeekStart = getWeekStart(now.toISOString());
  const weekKeys = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const d = new Date(thisWeekStart);
    d.setDate(d.getDate() - i * 7);
    weekKeys.push(d.toISOString().slice(0, 10));
  }

  return weekKeys.map((wk, i) => {
    const entry = byWeek.get(wk);
    if (!entry) return { weekStart: wk, count: 0, pct: 0, hasData: false, label: WEEKLY_LABELS[i] };
    const pct = entry.total ? Math.round((entry.matched / entry.total) * 100) : 0;
    return { weekStart: wk, count: entry.matched, pct, hasData: true, label: WEEKLY_LABELS[i] };
  });
}

// ===================== Gating helpers (README section 5) =====================

export function isTodaysStatsVisible(roundsHistory) {
  return (roundsHistory || []).length >= 1;
}
export function isWeeklyChartsVisible(roundsHistory) {
  return (roundsHistory || []).length >= 2;
}

// Everything on the deep end of Analytics — Handicap Index, 20 Round Average,
// Hole Ratings, Scrambling & Putting, Trends — waits for a full 20 rounds
// (Paul, 2026-07-26: "are there 20 rounds yet, yes-then render, no-stay
// hidden"). Below that the windows aren't full and a "20 round" heading would
// be describing three rounds. This is why Season Stats and the 20-round Score
// Distribution were deleted on 2026-07-25 — they rendered from round one.
export function isTwentyRoundStatsVisible(roundsHistory) {
  return (roundsHistory || []).length >= 20;
}

// Score bands for the Trends distribution — how many of the last 20 ROUNDS
// finished in each scoring range (distinct from Today's Round's birdie/par/
// bogey buckets, which count HOLES within one round; that duplication is what
// got the old 20-round Score Distribution deleted).
//
// Thresholds are fixed, and suit a player scoring in the 70s and 80s. A higher
// handicap piles every round into 85+ and the chart says nothing — if this ever
// ships beyond Paul and Dave, these want deriving from the player's own spread
// rather than hard-coded.
export const SCORE_BANDS = [
  { label: '<75',   test: (t) => t < 75 },
  { label: '75-79', test: (t) => t >= 75 && t <= 79 },
  { label: '80-84', test: (t) => t >= 80 && t <= 84 },
  { label: '85+',   test: (t) => t >= 85 }
];

// ===================== Weekly Reveal — new-bar animation (Pass 4) =====================
//
// Design Handoff/Design-Screens/18-23 ("Weekly Reveal") turned out to be a
// behavior spec for these same Weekly charts, not a separate screen — see
// JOURNAL.md Pass 4 entry. The gating/rolling-window math above already
// matches the spec (derived fresh from rounds-history every read, fixed
// "4 Wks Ago.../This Wk" labels, never numbered). The one piece Pass 2 didn't
// build was the grow-in animation on the newest bar the first time its
// week's data appears. This is presentation-only sugar: it never changes any
// score/stat value, and the one new localStorage key it reads/writes exists
// solely to remember "has this week's reveal already played" so revisiting
// Reports doesn't replay the animation every time.
export function getLastAnimatedWeekStart() {
  try { return localStorage.getItem(WEEKLY_ANIM_KEY) || null; } catch (e) { return null; }
}

export function markWeekAnimated(weekStart) {
  try { localStorage.setItem(WEEKLY_ANIM_KEY, weekStart); } catch (e) {}
}

// Index of the rightmost filled slot whose weekStart hasn't been marked as
// animated yet (-1 if nothing new — already seen, or no data at all). `slots`
// is one metric's computeWeeklyWindow() output; any metric works since all
// four share the same week boundaries.
export function resolveNewWeekSlotIndex(slots, lastAnimatedWeekStart) {
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i].hasData) {
      return slots[i].weekStart !== lastAnimatedWeekStart ? i : -1;
    }
  }
  return -1;
}

// ===================== Membership ROI =====================
//
// Only meaningful once Settings (Pass 3) actually collects membershipFee /
// greenFee. Until then those fields are 0/undefined on the settings record —
// treat that as "not set up yet" and return null so the caller can show a
// note instead of a fake $0 break-even or a divide-by-zero.
// ===================== Membership season =====================
//
// A membership season is a CALENDAR YEAR, 1 January to 31 December. Asked
// "what were your 2026 stats", that answers itself; anything spanning years
// needs a footnote every time it is mentioned.
//
// No year is hardcoded — every function derives it from the date it is given
// (defaulting to now), so the app never needs an annual update, and any season
// can be reported by passing a date inside it.
//
// Renewal timing (early bird, dues deadlines) is deliberately NOT modelled:
// it has no bearing on stats or on the savings ledger. The club is paid either
// way; ROI only cares what was paid and how many rounds it bought.
export function seasonYear(now = new Date()) {
  return now.getFullYear();
}

// The season a given round belongs to — its calendar year.
export function seasonOfRound(round) {
  return new Date(round.date).getFullYear();
}

// Rounds logged in a given season (defaults to the current one).
export function roundsInSeason(roundsHistory, year = seasonYear()) {
  return (roundsHistory || []).filter((r) => seasonOfRound(r) === year);
}

// --- Per-season membership settings (2026-07-25) --------------------------
//
// Membership and green fees change from year to year, so a single pair of
// numbers can only ever be right for one season. `settings.seasons` keys them
// by calendar year:
//
//   seasons: { "2026": { membershipFee, greenFee, roundsToDate }, "2027": {...} }
//
// The year is captured SILENTLY — stamped from the clock when fees are saved.
// The player never picks a year, and never sees one. Ask "what did you pay?",
// file it under the year they answered in.
//
// Falls back to the flat top-level fields for settings saved before this
// existed, so nothing needs migrating: a legacy record keeps working, and the
// first save after this change files the values under the current year.
export function seasonSettings(settings, year = seasonYear()) {
  const s = settings || {};
  const bucket = (s.seasons && s.seasons[String(year)]) || null;
  if (bucket) return bucket;
  // Legacy flat fields — only meaningful for the season they were entered in,
  // which we can't know, so they answer for any year rather than none.
  return {
    membershipFee: s.membershipFee,
    greenFee: s.greenFee,
    roundsToDate: s.roundsToDate
  };
}

// Writes fees into the season bucket, stamping the year from `now`. Returns a
// NEW settings object — never mutates the one passed in.
export function withSeasonSettings(settings, values, now = new Date()) {
  const year = String(seasonYear(now));
  const s = settings || {};
  const seasons = Object.assign({}, s.seasons);
  seasons[year] = Object.assign({}, seasons[year], values);
  return Object.assign({}, s, { seasons });
}

// Every season the player has fee data or logged rounds for, newest first.
export function knownSeasons(roundsHistory, settings) {
  const years = new Set();
  Object.keys((settings && settings.seasons) || {}).forEach((y) => years.add(Number(y)));
  (roundsHistory || []).forEach((r) => years.add(seasonOfRound(r)));
  return [...years].filter(Number.isFinite).sort((a, b) => b - a);
}

// --- Green fee rate schedule (2026-07-25) ---------------------------------
//
// Green fees change, sometimes mid-season, and a rise in July must NOT restate
// what a round in April was worth. So a season holds a dated schedule:
//
//   greenFees: [ { from: "2026-01-01", amount: 45 },
//                { from: "2026-07-01", amount: 50 } ]
//
// Each round is valued at the rate in effect on the day it was played, which
// makes the ledger exact and — more importantly — stable: editing the fee today
// changes nothing that already happened.
//
// Membership fee needs no schedule. It is paid once for the season, so a change
// belongs to the next season's bucket, not to a date inside this one.
//
// Falls back to a single flat `greenFee` (effective from the start of the
// season) for settings saved before the schedule existed.
// A bare "YYYY-MM-DD" is a CALENDAR DATE, not an instant. `new Date()` parses
// it as UTC midnight, which lands on the previous day — and sometimes the
// previous YEAR — anywhere west of Greenwich. That silently filed a 1 January
// rate under the wrong season. Parsed here as local midnight instead.
export function parseCalendarDate(value) {
  if (value instanceof Date) return value;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(value);
}

// Formats a Date as a local YYYY-MM-DD. toISOString() would convert to UTC and
// shift the date backwards for the same reason as above.
export function toCalendarDate(d) {
  const dt = parseCalendarDate(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function greenFeeSchedule(settings, year = seasonYear()) {
  const bucket = seasonSettings(settings, year) || {};
  const list = Array.isArray(bucket.greenFees) ? bucket.greenFees.slice() : [];
  if (!list.length && Number(bucket.greenFee) > 0) {
    list.push({ from: `${year}-01-01`, amount: Number(bucket.greenFee) });
  }
  return list
    .filter((e) => e && Number(e.amount) > 0 && e.from)
    .sort((a, b) => parseCalendarDate(a.from) - parseCalendarDate(b.from));
}

// The green fee in effect on `date`. Returns the earliest rate for a date
// before any entry (a round played before the first recorded rate is valued at
// that rate rather than at nothing), and null when no rates exist at all.
export function greenFeeOn(date, settings, year = seasonYear(parseCalendarDate(date))) {
  const schedule = greenFeeSchedule(settings, year);
  if (!schedule.length) return null;
  const when = parseCalendarDate(date);
  let rate = schedule[0].amount;
  for (const entry of schedule) {
    if (parseCalendarDate(entry.from) <= when) rate = Number(entry.amount);
  }
  return Number(rate);
}

// The rate in effect right now — what a round played today is worth, and the
// basis for the forward-looking break-even figure.
export function currentGreenFee(settings, now = new Date()) {
  return greenFeeOn(now, settings, seasonYear(now));
}

// Adds a rate effective from `from` (default today), leaving earlier rates
// intact. Replaces an existing entry with the same start date rather than
// stacking duplicates. Returns a NEW settings object.
export function withGreenFeeChange(settings, amount, from = new Date()) {
  const when = parseCalendarDate(from);
  const year = seasonYear(when);
  const iso = toCalendarDate(when);
  const schedule = greenFeeSchedule(settings, year).filter((e) => e.from !== iso);
  schedule.push({ from: iso, amount: Number(amount) });
  schedule.sort((a, b) => parseCalendarDate(a.from) - parseCalendarDate(b.from));
  // `greenFee` mirrors the LATEST rate so the legacy flat field stays truthful.
  const latest = schedule[schedule.length - 1].amount;
  return withSeasonSettings(settings, { greenFees: schedule, greenFee: Number(latest) }, when);
}

// --- Off-season rounds (2026-07-25) ---------------------------------------
//
// Winter golf at Mt. Paul is played to fairway greens off artificial mats, with
// significantly reduced yardages. WHS Rule 2.1 makes those scores unacceptable
// for handicap purposes on two counts — the course no longer maintains "length
// and normal playing difficulty at a consistent level", and it is outside its
// active season. So no score, and no stats worth keeping.
//
// But the rounds still happened and the membership still covered them, and
// Mt. Paul charges full green fee year round — a winter round saves exactly as
// much as a July one. They belong in the ledger.
//
// Stored as a TALLY, not as rounds:
//
//   offSeasonRounds: { "2026-11": 3, "2026-12": 2, "2027-01": 4 }
//
// Deliberately not round records. A record with no score would have to be
// excluded by hand from every aggregation in the app — including ones not
// written yet, which is where it would eventually be forgotten. A tally is
// invisible to all of them and reachable only where it is explicitly summed.
//
// Keyed by YEAR-MONTH because off-season play straddles 31 December: November
// and December belong to one membership season, January onward to the next.
// A bare counter could not split them. The month also prices each round at the
// green fee in effect then, should a rate ever change mid-winter.
export function offSeasonTally(settings) {
  const t = (settings && settings.offSeasonRounds) || {};
  return Object.keys(t)
    .filter((k) => /^\d{4}-\d{2}$/.test(k) && Number(t[k]) > 0)
    .sort()
    .map((k) => ({ key: k, year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)), count: Math.round(Number(t[k])) }));
}

export function offSeasonRoundsInSeason(settings, year = seasonYear()) {
  return offSeasonTally(settings)
    .filter((e) => e.year === year)
    .reduce((sum, e) => sum + e.count, 0);
}

// Green-fee value of the off-season rounds in a season, each month priced at
// the rate in effect on the 15th of that month.
export function offSeasonValue(settings, year = seasonYear()) {
  return offSeasonTally(settings)
    .filter((e) => e.year === year)
    .reduce((sum, e) => {
      const rate = greenFeeOn(`${e.key}-15`, settings, year) || 0;
      return sum + e.count * rate;
    }, 0);
}

// Returns a NEW settings object with `count` rounds recorded for a year-month.
// Setting 0 removes the entry rather than storing a zero.
export function withOffSeasonRounds(settings, yearMonth, count) {
  const s = settings || {};
  const tally = Object.assign({}, s.offSeasonRounds);
  const n = Math.round(Number(count));
  if (!Number.isFinite(n) || n <= 0) delete tally[yearMonth];
  else tally[yearMonth] = n;
  return Object.assign({}, s, { offSeasonRounds: tally });
}

// The winter span containing — or most recently preceding — `now`: October
// through March, six months crossing a year boundary.
//
// Which span is shown derives entirely from today, so nothing is stored or
// maintained: Oct-Dec looks forward into the winter now starting, Jan-Mar looks
// back at the one that started last October, and Apr-Sep shows the winter just
// finished (which is the "I forgot this feature existed until May" case).
//
// Months later than the current one are marked `future` — you cannot have
// played a round you have not reached yet.
// Winter runs 1 October to 31 March. Outside it the entry table is hidden
// entirely — the previous winter is settled and there is nothing relevant to
// edit, so showing six spent months in July is just clutter.
export const WINTER_MONTHS = [9, 10, 11, 0, 1, 2]; // Oct-Dec, Jan-Mar (0 = Jan)

export function isWinter(now = new Date()) {
  return WINTER_MONTHS.includes(now.getMonth());
}

export function winterMonthsFor(now = new Date(), roundsHistory = []) {
  const startYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  const logged = loggedRoundsByMonth(roundsHistory);
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const out = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(startYear, 9 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({
      key,                                   // "2026-11" — storage key, never shown
      label: d.toLocaleString('en-CA', { month: 'short', year: 'numeric' }),
      year: d.getFullYear(),
      future: d > thisMonth,
      logged: logged[key] || 0
    });
  }
  return out;
}

// Live rounds the app captured, grouped by year-month. Shown beside each winter
// row so a month like October — where a proper round may well have been played
// and logged — cannot be quietly counted twice.
export function loggedRoundsByMonth(roundsHistory) {
  const out = {};
  (roundsHistory || []).forEach((r) => {
    const k = String(r.date).slice(0, 7);
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

// Rounds to date (RTD) — rounds played on the current membership.
//
// NOT the same as rounds-history.length, and deliberately so: a member may have
// played plenty before installing the app, and every one of those rounds counts
// toward getting value out of the fee. `settings.roundsToDate` is the figure the
// player supplies; logged rounds are only the fallback when it isn't set.
//
// Counted PER SEASON, because the membership resets 31 December — rounds from
// last year did nothing for this year's fee. At install this is 0, and the
// first round posted makes it 1.
//
// `settings.roundsToDate`, when set, overrides the count. That exists for two
// reasons: seeding hypothetical figures while the report is being built, and
// members who install mid-season with rounds already behind them. Left unset
// (the default), the figure is simply this season's logged rounds.
export function roundsToDate(roundsHistory, settings, now = new Date()) {
  const year = seasonYear(now);
  const offSeason = offSeasonRoundsInSeason(settings, year);
  const seeded = Number(seasonSettings(settings, year).roundsToDate);
  // Off-season rounds are added on top of a seeded figure too — the seed stands
  // in for logged rounds, not for the winter tally, which is recorded separately.
  if (Number.isFinite(seeded) && seeded > 0) return Math.round(seeded) + offSeason;
  return roundsInSeason(roundsHistory, year).length + offSeason;
}

// `now` selects the season being reported — pass a date in any year to get that
// year's ROI, computed from that year's own fees.
export function membershipROI(roundsHistory, settings, now = new Date()) {
  const year = seasonYear(now);
  const fees = seasonSettings(settings, year);
  const membershipFee = Number(fees.membershipFee);
  const schedule = greenFeeSchedule(settings, year);
  // Requires BOTH a membership fee and at least one green fee rate: a fee with
  // nothing to compare it against cannot produce a meaningful saving.
  if (!membershipFee || membershipFee <= 0 || !schedule.length) return null;

  const currentFee = currentGreenFee(settings, now);
  const roundsPlayed = roundsToDate(roundsHistory, settings, now);

  // The ledger: every logged round valued at the rate in effect ON THE DAY IT
  // WAS PLAYED, so a mid-season rise never restates an earlier round.
  const logged = roundsInSeason(roundsHistory, year);
  const loggedValue = logged.reduce((sum, r) => sum + (greenFeeOn(r.date, settings, year) || 0), 0);

  // RTD can exceed the logged rounds — a seeded figure, or a member who
  // installed mid-season. Those unlogged rounds have no date to price against,
  // so they are valued at the current rate and the approximation is declared
  // rather than hidden.
  const offSeasonCount = offSeasonRoundsInSeason(settings, year);
  const offSeasonWorth = offSeasonValue(settings, year);
  // Anything left over is a seeded/unlogged round with no date to price against,
  // so it takes the current rate. Off-season rounds are excluded from that
  // remainder — they are priced by their own month above.
  const unloggedCount = Math.max(0, roundsPlayed - logged.length - offSeasonCount);
  const grossValue = loggedValue + offSeasonWorth + unloggedCount * currentFee;

  const cumulativeSavings = grossValue - membershipFee;
  // Break-even looks FORWARD, so it uses today's rate: "at what it costs now,
  // how many rounds does the fee take to repay". Past rates can't change it.
  const roundsToBreakEven = Math.ceil(membershipFee / currentFee);
  const perRoundCostToDate = roundsPlayed > 0 ? membershipFee / roundsPlayed : null;
  // What today's round was worth: today's green fee less what a round actually
  // costs under the membership. Negative until break-even.
  const todaysSavings = perRoundCostToDate === null ? null : currentFee - perRoundCostToDate;

  return {
    roundsPlayed, membershipFee,
    greenFee: currentFee,
    greenFeeSchedule: schedule,
    rateChangedThisSeason: schedule.length > 1,
    grossValue,
    unloggedCount,
    offSeasonCount,
    offSeasonWorth,
    cumulativeSavings, roundsToBreakEven, perRoundCostToDate, todaysSavings,
    season: year
  };
}

// ===================== The one entry point app.js calls =====================
//
// Builds every number the Reports/Analytics screen needs, in one pass, always
// freshly recomputed from the full rounds-history array (never a stored
// running total). `handicapData` is the parsed mt-paul-handicap-ratings.json
// (or null if it hasn't loaded — every handicap-dependent field degrades to
// null rather than throwing).
export function buildAnalytics(roundsHistory, settings, handicapData) {
  const rounds = roundsHistory || [];
  const hasAnyRounds = rounds.length > 0;
  const sorted = sortRoundsByDate(rounds);
  const last20Rounds = lastN(sorted, 20);
  const last20HoleRecords = flattenHoleRecords(last20Rounds);
  const allHoleRecords = flattenHoleRecords(rounds);

  // --- Season Stats hero tiles (last 20 rounds, except Best/Worst = all-time) ---
  const scoringAvg = avgRounds(last20Rounds, roundTotalScore);
  // Best and worst are ALL-TIME, not last-20 — a personal best is a career
  // figure, not a rolling-window one.
  const bestRound = hasAnyRounds ? Math.min(...sorted.map(roundTotalScore)) : null;
  //
  // worstRound IS DELIBERATELY NOT DISPLAYED ANYWHERE (Paul, 2026-07-26):
  // "People will remember their best round for the longest time. And want to
  // forget their worst round as quickly as possible. So we won't be posting
  // that." It briefly appeared in the Trends grid and was taken out.
  //
  // Kept computed rather than deleted so this note survives with it — the value
  // is one line and free, and anyone tempted to add a "worst round" tile should
  // read the reason before doing it. Do not surface this in the UI.
  const worstRound = hasAnyRounds ? Math.max(...sorted.map(roundTotalScore)) : null;
  const puttsPerRound = avgRounds(last20Rounds, roundPutts);
  // FIR denominator = fairways AVAILABLE, not holes played (2026-07-25).
  //
  // Pass 5 Fix 1 counted every hole, because FIR was then shown on all 18.
  // Pass 7 reversed that (app.js renderHole() hides FIR on every par 3 — there
  // is no fairway to hit from a par-3 tee), but this line was never updated, so
  // all 8 of Mt. Paul's par 3s sat in the denominator as permanent misses:
  // 99 of 200 fairways read as 28% instead of 50%.
  //
  // Keys on par, not on `fir === null`: goToHoleScreen() defaults `fir: false`
  // on every hole, so existing saved rounds carry false (not null) on par 3s
  // and a null check would quietly miss them. Keying on par also picks up
  // par 5s automatically when courses beyond Mt. Paul are added.
  const isFairwayHole = (h) => h.par >= 4;
  const firPctSeason = aggregateHoles(last20HoleRecords, isFairwayHole, countAndPct((h) => h.fir));
  const girPctSeason = aggregateHoles(last20HoleRecords, () => true, countAndPct((h) => h.gir));

  const season = {
    scoringAvg, bestRound, worstRound, puttsPerRound,
    fir: firPctSeason, gir: girPctSeason
  };

  // --- Score Distribution (last 20 rounds) ---
  const scoreDistribution = {
    birdie: aggregateHoles(last20HoleRecords, () => true, countAndPct(SCORE_BUCKET_PREDICATES.birdie)),
    par: aggregateHoles(last20HoleRecords, () => true, countAndPct(SCORE_BUCKET_PREDICATES.par)),
    bogey: aggregateHoles(last20HoleRecords, () => true, countAndPct(SCORE_BUCKET_PREDICATES.bogey)),
    bogeyPlus: aggregateHoles(last20HoleRecords, () => true, countAndPct(SCORE_BUCKET_PREDICATES.bogeyPlus))
  };

  // --- Trends: how the last 20 ROUND TOTALS spread across scoring bands ---
  const bandTotals = last20Rounds.map(roundTotalScore);
  const scoreBands = SCORE_BANDS.map((b) => {
    const count = bandTotals.filter(b.test).length;
    return {
      label: b.label,
      count,
      pct: bandTotals.length ? Math.round((count / bandTotals.length) * 100) : 0
    };
  });

  // --- Monthly scoring trend (last 20 rounds) ---
  //
  // Grouped by LOCAL calendar month, chronological, only months that actually
  // contain rounds. No zero-filling of empty months: a gap month would draw as
  // a zero-score bar, and in a 20-round window an empty month usually just
  // means the window doesn't reach that far back.
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthKeys = [];
  const monthBuckets = {};
  last20Rounds.forEach((r) => {
    const d = new Date(r.date);
    if (isNaN(d)) return;
    const key = d.getFullYear() + '-' + String(d.getMonth()).padStart(2, '0');
    if (!monthBuckets[key]) { monthBuckets[key] = { label: MONTH_ABBR[d.getMonth()], totals: [] }; monthKeys.push(key); }
    monthBuckets[key].totals.push(roundTotalScore(r));
  });
  const monthlyScoring = monthKeys.sort().map((k) => ({
    label: monthBuckets[k].label,
    count: monthBuckets[k].totals.length,
    avg: monthBuckets[k].totals.reduce((a2, b) => a2 + b, 0) / monthBuckets[k].totals.length
  }));

  // --- One-putt greens, per round, last 10 ---
  //
  // Was "1 Putt Par Saves" (!gir && putts === 1 && score <= par) until
  // 2026-07-27. That formula was wrong twice over. Under Paul's definition a
  // par save is EXACTLY par and method-agnostic — a chip-in counts the same as
  // a one-putt — so singling out the putted subset contradicted UD/Scrambling;
  // and `score <= par` let birdies from off the green in, so the chart ran
  // HIGHER than the true par-save count, not lower (5 vs 4 and 1 vs 0 in the
  // last ten of the test fixture). Fixing it to `=== par` would have made it a
  // per-round redraw of Scrambling — a fourth rendering of one number.
  //
  // So it is now simply the count of one-putt greens: a putting skill in its
  // own right, overlapping nothing else on the page. The Putting card states
  // 1-putt as an all-time rate; this is the same event as a per-round trend.
  // No !gir test and no score test — a one-putt is a one-putt.
  const lastTenRounds = lastN(sorted, 10);
  const onePutts = lastTenRounds.map((r) => ({
    date: r.date,
    count: (r.holes || []).filter((h) => h.putts === 1).length
  }));

  // --- Score by day of week (last 20 rounds) ---
  //
  // Local day, not UTC: getDay() reads the device's timezone, so a round saved
  // at 9am in Kamloops is a Kamloops day. Parsing as UTC would push early or
  // late rounds onto the wrong day.
  //
  // Days with NO rounds carry avg: null, NOT zero. Nobody shoots 0, so a zero
  // bar would read as a catastrophic round rather than an absence. The renderer
  // draws those as an empty rule — see scoreByDayHTML in app.js. Paul's own
  // test data has no Tuesday rounds, which is exactly the case this guards.
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byDayBuckets = DAY_LABELS.map(() => []);
  last20Rounds.forEach((r) => {
    const d = new Date(r.date);
    if (isNaN(d)) return;
    byDayBuckets[d.getDay()].push(roundTotalScore(r));
  });
  const scoreByDay = DAY_LABELS.map((label, i) => {
    const v = byDayBuckets[i];
    return {
      label,
      count: v.length,
      avg: v.length ? v.reduce((a2, b) => a2 + b, 0) / v.length : null
    };
  });

  // --- Best 8 of Last 20 / Handicap Index ---
  const best8Differentials = best8Of20Differentials(rounds, handicapData);
  const handicap = handicapIndex(rounds, handicapData);

  // --- 20 Round Average: FIR / GIR / PEN ---
  const twentyRoundAvg = {
    fir: firPctSeason,
    gir: girPctSeason,
    pen: aggregateHoles(last20HoleRecords, () => true, countAndPct((h) => h.pen))
  };

  // --- Hole Ratings: per-PHYSICAL-hole avg (score - par), last 20 rounds ------
  //
  // Mt. Paul is a nine-hole course; an 18-hole round is two loops of the same
  // nine, so holeNum 1-18 names each physical hole twice (hole N and N+9 are
  // the same hole — verified in mt-paul-course-data.json, identical par and
  // yardage). Charting 1-18 drew every hole twice under different labels and
  // halved the sample behind each bar.
  //
  // Detected rather than hardcoded, so this stays right if an 18-hole course is
  // ever added: if the back nine's pars match the front nine's hole for hole,
  // treat it as a double loop and pool both plays; otherwise chart all 18.
  // Pooling doubles the evidence per bar — 40 plays per hole across 20 rounds
  // instead of 20.
  const holeRatings = (() => {
    const holeCount = Math.max(0, ...last20HoleRecords.map((h) => h.holeNum));
    const parFor = (n) => {
      const rec = last20HoleRecords.find((h) => h.holeNum === n);
      return rec ? rec.par : null;
    };
    const isDoubleLoop =
      holeCount === 18 &&
      [1, 2, 3, 4, 5, 6, 7, 8, 9].every((n) => parFor(n) !== null && parFor(n) === parFor(n + 9));
    const loopSize = isDoubleLoop ? 9 : holeCount;
    const key = (h) => (isDoubleLoop ? ((h.holeNum - 1) % 9) + 1 : h.holeNum);
    const out = [];
    for (let n = 1; n <= loopSize; n++) {
      out.push({
        holeNum: n,
        par: parFor(n),
        plays: last20HoleRecords.filter((h) => key(h) === n).length,
        // Average ACTUAL strokes — what the player really writes down (Paul,
        // 2026-07-26: "I want full strokes, not abbreviated over under par
        // junk... I want to know how many strokes do I usually play it in").
        avgStrokes: aggregateHoles(last20HoleRecords, (h) => key(h) === n, avg((h) => h.score)),
        // Kept alongside: same data expressed against par. Nothing renders it
        // today, but every other stat on the page is a differential and this is
        // the bridge back to them.
        avgOverPar: aggregateHoles(last20HoleRecords, (h) => key(h) === n, avg((h) => h.score - h.par))
      });
    }
    return out;
  })();

  // --- Scrambling / Putts split / Penalty impact / Putt distribution (all-time) ---
  // Scrambling = a PAR SAVE on a missed green. EXACTLY par, not par-or-better
  // (Paul, 2026-07-26): "Technically to 'Scramble' is to fight for Par. You
  // don't scramble to make less than par, that's good golfing that put you into
  // a scoring position to make Birdy or better, or simply a stroke of luck."
  //
  // Was `score <= par`, which folded birdies-from-off-the-green into the same
  // number. Note this DIVERGES from the PGA Tour definition, which is par or
  // better — so this figure is not comparable with a tour or third-party
  // scrambling percentage. That's deliberate; it answers Paul's question, not
  // the tour's.
  //
  // Derived from gir + score, never from the ud flag: this needs no discipline
  // from the player at entry time, where a flag does.
  const scrambling = aggregateHoles(allHoleRecords, (h) => !h.gir, countAndPct((h) => h.score === h.par));
  // Last-20 twin. As of 2026-07-27 the ONLY place this stat renders is the UD
  // tile in the Trends: Last 20 grid, whose heading claims a 20-round window —
  // so that tile must read scrambling20, not scrambling. The two were identical
  // while the fixture held exactly 20 rounds, which is why the mismatch went
  // unseen; at round 21 the all-time figure starts drifting under a heading
  // that promises the last 20. `scrambling` (all-time) is kept for the day a
  // section legitimately wants a career figure — use the one the surrounding
  // heading actually claims.
  const scrambling20 = aggregateHoles(last20HoleRecords, (h) => !h.gir, countAndPct((h) => h.score === h.par));
  const puttsSplit = {
    gir: aggregateHoles(allHoleRecords, (h) => h.gir, avg((h) => h.putts)),
    nonGir: aggregateHoles(allHoleRecords, (h) => !h.gir, avg((h) => h.putts))
  };
  const penaltyImpact = {
    withPen: aggregateHoles(allHoleRecords, (h) => h.pen, avg((h) => h.score - h.par)),
    withoutPen: aggregateHoles(allHoleRecords, (h) => !h.pen, avg((h) => h.score - h.par))
  };
  const puttDistribution = {
    onePutt: aggregateHoles(allHoleRecords, () => true, countAndPct((h) => h.putts === 1)),
    twoPutt: aggregateHoles(allHoleRecords, () => true, countAndPct((h) => h.putts === 2)),
    threePuttPlus: aggregateHoles(allHoleRecords, () => true, countAndPct((h) => h.putts >= 3))
  };
  // Scrambling's UD (up-and-down) companion stat, e.g. for a "1-putt par saves"
  // style readout: UD rate among non-GIR holes.
  const udOnMissedGir = aggregateHoles(allHoleRecords.filter((h) => !h.gir), () => true, countAndPct((h) => h.ud));
  // NOTHING RENDERS EITHER OF THESE as of 2026-07-26 (Paul: "Drop the UD tile,
  // keep Scrambling only"). The ud flag is player-tapped, and on real cards it
  // gets missed or misapplied — Scrambling replaced it everywhere, derived from
  // gir + score so it needs no discipline at entry time. Kept computed, and one
  // line each, so this reasoning survives next to the data. Do not resurrect a
  // UD percentage without re-reading it.
  //
  // Last-20 twin of the above. The all-time figure is the right one beside
  // Scrambling (also all-time); it is the WRONG one under a heading that says
  // "20 Round Average" or inside the Trends grid, which is what it was doing
  // until 2026-07-26. Same stat, different window — keep both, use the one the
  // surrounding heading claims.
  const udOnMissedGir20 = aggregateHoles(last20HoleRecords.filter((h) => !h.gir), () => true, countAndPct((h) => h.ud));

  // --- Weekly charts (last 4 weeks), gated to >= 2 rounds ---
  const weeklyVisible = isWeeklyChartsVisible(rounds);
  const weekly = weeklyVisible
    ? {
        birdie: computeWeeklyWindow(rounds, 'birdie'),
        par: computeWeeklyWindow(rounds, 'par'),
        bogey: computeWeeklyWindow(rounds, 'bogey'),
        bogeyPlus: computeWeeklyWindow(rounds, 'bogeyPlus')
      }
    : null;
  // Which bar (if any) should play the Weekly Reveal grow-in this render —
  // read-only here, never marked-seen inside buildAnalytics() so this stays
  // a pure derive-from-source function; the caller (renderReports()) marks
  // it after using this value. See resolveNewWeekSlotIndex() above.
  const weeklyNewSlotIndex = weeklyVisible
    ? resolveNewWeekSlotIndex(weekly.birdie, getLastAnimatedWeekStart())
    : -1;

  // --- Today's Stats (most recent round only), gated to >= 1 round ---
  const todaysVisible = isTodaysStatsVisible(rounds);
  let todaysStats = null;
  if (todaysVisible) {
    const recent = mostRecentRound(rounds);
    const recentHoles = flattenHoleRecords([recent]);
    const recentPar = (recent.holes || []).reduce((sum, h) => sum + (h.par || 0), 0);
    const recentCourseHandicap = courseHandicap(
      handicap,
      getTeeRatings(handicapData, recent.tee, roundRatingSet(recent)),
      recentPar
    );
    todaysStats = {
      date: recent.date,
      totalScore: roundTotalScore(recent),
      putts: roundPutts(recent),
      birdie: aggregateHoles(recentHoles, () => true, countAndPct(SCORE_BUCKET_PREDICATES.birdie)),
      par: aggregateHoles(recentHoles, () => true, countAndPct(SCORE_BUCKET_PREDICATES.par)),
      bogey: aggregateHoles(recentHoles, () => true, countAndPct(SCORE_BUCKET_PREDICATES.bogey)),
      bogeyPlus: aggregateHoles(recentHoles, () => true, countAndPct(SCORE_BUCKET_PREDICATES.bogeyPlus)),
      // Denominator is fairways available (par 4s and 5s), not holes played —
      // see firPctSeason's comment above in buildAnalytics() for the rationale.
      fir: aggregateHoles(recentHoles, (h) => h.par >= 4, countAndPct((h) => h.fir)),
      gir: aggregateHoles(recentHoles, () => true, countAndPct((h) => h.gir)),
      pen: aggregateHoles(recentHoles, () => true, countAndPct((h) => h.pen)),
      // UD = PAR SAVED (Paul, 2026-07-26). Derived from the round itself —
      // missed the green, still made par — NOT from the ud rocker.
      //
      // "How the player saved Par isn't the factor, be it a One Putt, or a
      // Chip In... the only thing that matters is missed GIR and made Par."
      //
      // So UD and Scrambling are the same event: this is the count for one
      // round, Scrambling is the rate across many. The rocker stays as a note
      // the player can keep however they like; no statistic reads it.
      ud: aggregateHoles(recentHoles, (h) => !h.gir, countAndPct((h) => h.score === h.par)),
      // Today's Round hero (2026-07-25). Net = Actual Score − Course Handicap.
      //
      // Course Handicap, NOT Handicap Index: the Index is a portable rating of
      // the player, the Course Handicap is how many strokes they actually
      // receive on this tee —
      //   CH = HI × (Slope / 113) + (Course Rating − Par)
      // On Mt. Paul Blue (slope 86, CR 59.0 vs par 64) both terms pull down, so
      // a 20.0 Index receives 10 strokes, not 20. Subtracting the Index here
      // would read ~10 strokes low, and would do so by a course-dependent
      // amount — the same mistake pattern as the pre-2026-07-25 handicap bugs.
      //
      // null (renders as —) until a Handicap Index exists, i.e. before 3 rounds.
      courseHandicap: recentCourseHandicap,
      net: recentCourseHandicap === null ? null : roundTotalScore(recent) - recentCourseHandicap
    };
  }

  // --- Membership ROI (only if Settings has real membershipFee/greenFee) ---
  // --- Last 10 Rounds: Actual Score per round, oldest left -> newest right ---
  // Appears once 10 rounds are logged. Deliberately the ACTUAL score, not the
  // adjusted or net figure — this is the "what have I been shooting lately"
  // read, and it is the number the player wrote on the card.
  const lastTen = lastN(sorted, 10).map((r) => ({
    date: r.date,
    totalScore: roundTotalScore(r)
  }));
  const lastTenVisible = rounds.length >= 10;

  const roi = membershipROI(rounds, settings);

  return {
    hasAnyRounds,
    roundsCount: rounds.length,
    season,
    scoreDistribution,
    best8Differentials,
    // What the handicap figure actually is — a real Index, or our estimate
    // while the player works toward the 3 rounds WHS requires.
    handicapStatus: handicapWithStatus(rounds, handicapData),
    handicap,
    twentyRoundAvg,
    holeRatings,
    scrambling,
    scrambling20,
    puttsSplit,
    penaltyImpact,
    puttDistribution,
    udOnMissedGir,
    udOnMissedGir20,
    weekly,
    weeklyVisible,
    weeklyNewSlotIndex,
    todaysStats,
    todaysVisible,
    lastTen,
    lastTenVisible,
    scoreBands,
    scoreByDay,
    onePutts,
    monthlyScoring,
    twentyRoundStatsVisible: isTwentyRoundStatsVisible(rounds),
    // Off-season entry table: the winter span around today, each month carrying
    // its live-round count and its tally, plus how the six months split across
    // the two membership seasons they always straddle.
    offSeason: (() => {
      const now = new Date();
      const months = winterMonthsFor(now, rounds).map((m) => Object.assign({}, m, {
        tally: (settings && settings.offSeasonRounds && settings.offSeasonRounds[m.key]) || 0
      }));
      // Shown only during winter (1 Oct - 31 Mar). The tally itself keeps
      // counting toward the ledger year round; only the entry table hides.
      return { months, visible: isWinter(now) };
    })(),
    roundsToDate: roundsToDate(rounds, settings),
    roi
  };
}
