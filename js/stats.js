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

// Course Rating / Slope Rating for a tee ('blue' | 'red'), male ratings only
// (this course has no separate female tee data collected in the app yet —
// same convention course-data.js's getHolesForTee/getTeeMeta already use).
export function getTeeRatings(handicapData, tee) {
  if (!handicapData) return null;
  const teeName = tee === 'red' ? 'Red' : 'Blue';
  const ratings = handicapData.ratings && handicapData.ratings.male;
  if (!ratings || !ratings[teeName]) return null;
  return { courseRating: ratings[teeName].course_rating, slopeRating: ratings[teeName].slope_rating };
}

// Score Differential = (totalScore − courseRating) × 113 / slopeRating,
// rounded to 1 decimal (standard WHS practice — differentials are always
// carried to one decimal place). Returns null if ratings aren't resolvable
// for this round's tee, rather than dividing by an undefined slope.
export function scoreDifferential(round, handicapData) {
  const teeRatings = getTeeRatings(handicapData, round.tee);
  if (!teeRatings || !teeRatings.slopeRating) return null;
  const total = roundTotalScore(round);
  const diff = ((total - teeRatings.courseRating) * 113) / teeRatings.slopeRating;
  return Math.round(diff * 10) / 10;
}

// Best (lowest) 8 score differentials of the last 20 rounds, ascending. Fewer
// than 20 rounds naturally degrades to "best 8 of however many exist" (or
// fewer than 8 if fewer rounds/valid differentials exist yet).
export function best8Of20Differentials(roundsHistory, handicapData) {
  const rounds = lastN(sortRoundsByDate(roundsHistory), 20);
  const diffs = rounds
    .map((r) => scoreDifferential(r, handicapData))
    .filter((d) => d !== null)
    .sort((a, b) => a - b);
  return diffs.slice(0, Math.min(8, diffs.length));
}

// WHS Handicap Index: average of the best-8-of-last-20 differentials × 0.96,
// TRUNCATED (not rounded) to 1 decimal. Returns null if there isn't at least
// one usable differential yet.
export function handicapIndex(roundsHistory, handicapData) {
  const best = best8Of20Differentials(roundsHistory, handicapData);
  if (!best.length) return null;
  const meanDiff = best.reduce((s, v) => s + v, 0) / best.length;
  const scaled = meanDiff * 0.96;
  return Math.trunc(scaled * 10) / 10;
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
export function membershipROI(roundsHistory, settings) {
  const membershipFee = settings && Number(settings.membershipFee);
  const greenFee = settings && Number(settings.greenFee);
  if (!membershipFee || membershipFee <= 0 || !greenFee || greenFee <= 0) return null;
  const roundsPlayed = (roundsHistory || []).length;
  const cumulativeSavings = roundsPlayed * greenFee - membershipFee;
  const roundsToBreakEven = Math.ceil(membershipFee / greenFee);
  return { roundsPlayed, membershipFee, greenFee, cumulativeSavings, roundsToBreakEven };
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
  const bestRound = hasAnyRounds ? Math.min(...sorted.map(roundTotalScore)) : null;
  const worstRound = hasAnyRounds ? Math.max(...sorted.map(roundTotalScore)) : null;
  const puttsPerRound = avgRounds(last20Rounds, roundPutts);
  // Pass 5 Fix 1: FIR is now a plain boolean on every hole, par-3s included
  // (see app.js goToHoleScreen()/renderHole()) — no more filtering out
  // par-3 holes before computing the percentage. flattenHoleRecords() still
  // defensively coerces anything that isn't strictly true/false to null (old
  // or malformed data, e.g. SAMPLE_ROUNDS_HISTORY's historical par-3 nulls),
  // and `h.fir` reads falsy for those in the match predicate below — they
  // just count as a non-match, never a crash, while still counting in the
  // denominator (`last20HoleRecords` includes every hole).
  const firPctSeason = aggregateHoles(last20HoleRecords, () => true, countAndPct((h) => h.fir));
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

  // --- Best 8 of Last 20 / Handicap Index ---
  const best8Differentials = best8Of20Differentials(rounds, handicapData);
  const handicap = handicapIndex(rounds, handicapData);

  // --- 20 Round Average: FIR / GIR / PEN ---
  const twentyRoundAvg = {
    fir: firPctSeason,
    gir: girPctSeason,
    pen: aggregateHoles(last20HoleRecords, () => true, countAndPct((h) => h.pen))
  };

  // --- Hole Ratings: per-hole avg (score - par), last 20 rounds, holes 1-18 ---
  const holeRatings = [];
  for (let n = 1; n <= 18; n++) {
    holeRatings.push({
      holeNum: n,
      avgOverPar: aggregateHoles(last20HoleRecords, (h) => h.holeNum === n, avg((h) => h.score - h.par))
    });
  }

  // --- Scrambling / Putts split / Penalty impact / Putt distribution (all-time) ---
  const scrambling = aggregateHoles(allHoleRecords, (h) => !h.gir, countAndPct((h) => h.score <= h.par));
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
    todaysStats = {
      date: recent.date,
      totalScore: roundTotalScore(recent),
      putts: roundPutts(recent),
      birdie: aggregateHoles(recentHoles, () => true, countAndPct(SCORE_BUCKET_PREDICATES.birdie)),
      par: aggregateHoles(recentHoles, () => true, countAndPct(SCORE_BUCKET_PREDICATES.par)),
      bogey: aggregateHoles(recentHoles, () => true, countAndPct(SCORE_BUCKET_PREDICATES.bogey)),
      bogeyPlus: aggregateHoles(recentHoles, () => true, countAndPct(SCORE_BUCKET_PREDICATES.bogeyPlus)),
      // Pass 5 Fix 1: no more filtering par-3s out of the denominator — see
      // firPctSeason's comment above in buildAnalytics() for the rationale.
      fir: aggregateHoles(recentHoles, () => true, countAndPct((h) => h.fir)),
      gir: aggregateHoles(recentHoles, () => true, countAndPct((h) => h.gir))
    };
  }

  // --- Membership ROI (only if Settings has real membershipFee/greenFee) ---
  const roi = membershipROI(rounds, settings);

  return {
    hasAnyRounds,
    roundsCount: rounds.length,
    season,
    scoreDistribution,
    best8Differentials,
    handicap,
    twentyRoundAvg,
    holeRatings,
    scrambling,
    puttsSplit,
    penaltyImpact,
    puttDistribution,
    udOnMissedGir,
    weekly,
    weeklyVisible,
    weeklyNewSlotIndex,
    todaysStats,
    todaysVisible,
    roi
  };
}
