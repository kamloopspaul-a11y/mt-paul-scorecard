// SINGLE SOURCE OF TRUTH for persistent app/user settings — distinct from
// round-record.js (per-round stats data). Settings are not stats: they don't
// live in `rounds-history` and no chart should read them for scoring numbers.
// Stored under one localStorage key, e.g. 'mtpaul-settings', read/written whole.

export function buildSettingsRecord({
  playerName, teePref, ratingSet, statsTrackingEnabled, lightMode,
  membershipFee, greenFee, roundsToDate, seasons
}) {
  return {
    playerName,                 // string
    teePref,                    // 'blue' | 'red'
    // Which published Course Rating / Slope set applies (2026-07-25). Mt. Paul
    // rates both Blue and Red for men and ladies off the SAME physical tees —
    // only CR/Slope differ, the stroke index table is shared. This is a golf
    // question (which rating set the player is scored under), not a personal
    // one, which is why the Settings switch is labelled "Ratings".
    ratingSet,                  // 'male' | 'female' — defaults to 'male'
    statsTrackingEnabled,       // boolean — Setup's Show/Hide Stats toggle
    lightMode,                  // boolean — Dark/Light mode switch
    membershipFee,              // number, dollars — Membership ROI input
    greenFee,                   // number, dollars — Membership ROI input
    // Rounds played on the current membership. NOT rounds-history.length —
    // rounds can predate the app, and they all count toward getting value from
    // the fee. stats.js roundsToDate() prefers this when set and falls back to
    // logged rounds when it isn't.
    roundsToDate,
    // Per-season fees, keyed by calendar year and stamped silently on save:
    //   seasons: { "2026": { membershipFee, greenFee, roundsToDate }, ... }
    // Fees vary year to year, so the flat fields above can only ever be right
    // for the season they were last entered in — they remain as a fallback for
    // records saved before this existed. stats.js seasonSettings() reads this.
    seasons
  };
}

// Note: `mtpaul-player-record-v2` currently conflates this settings shape with
// in-progress-round state (holeAchieved, putts for the hole being played).
// Those two do not belong in the same record — in-progress hole state should
// move to a `currentRound` object per the real data wiring handoff, leaving
// this settings record to hold only what's listed above. Rounds Played on
// Membership ROI is NOT a settings field — it's `rounds-history.length`, read
// live, never stored here or anywhere else.
