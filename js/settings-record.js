// SINGLE SOURCE OF TRUTH for persistent app/user settings — distinct from
// round-record.js (per-round stats data). Settings are not stats: they don't
// live in `rounds-history` and no chart should read them for scoring numbers.
// Stored under one localStorage key, e.g. 'mtpaul-settings', read/written whole.

export function buildSettingsRecord({
  playerName, teePref, statsTrackingEnabled, lightMode,
  membershipFee, greenFee
}) {
  return {
    playerName,                 // string
    teePref,                    // 'blue' | 'red'
    statsTrackingEnabled,       // boolean — Setup's Show/Hide Stats toggle
    lightMode,                  // boolean — Dark/Light mode switch
    membershipFee,              // number, dollars — Membership ROI input
    greenFee                    // number, dollars — Membership ROI input
  };
}

// Note: `mtpaul-player-record-v2` currently conflates this settings shape with
// in-progress-round state (holeAchieved, putts for the hole being played).
// Those two do not belong in the same record — in-progress hole state should
// move to a `currentRound` object per the real data wiring handoff, leaving
// this settings record to hold only what's listed above. Rounds Played on
// Membership ROI is NOT a settings field — it's `rounds-history.length`, read
// live, never stored here or anywhere else.
