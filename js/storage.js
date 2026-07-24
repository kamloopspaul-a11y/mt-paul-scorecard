// Small localStorage helpers shared across the app. Centralizing the key names
// here means every read/write path agrees on exactly the same key strings.

export const KEYS = {
  SETTINGS: 'mtpaul-settings',
  CURRENT_ROUND: 'currentRound',
  PENDING_NINE: 'pending-nine-holes',
  ROUNDS_HISTORY: 'rounds-history',
  // Pass 4 — Weekly Reveal grow-in animation tracking only (js/stats.js
  // getLastAnimatedWeekStart/markWeekAnimated). Never holds score/stat data.
  WEEKLY_ANIM_SEEN: 'weekly-anim-week-seen'
};

export function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to read/parse localStorage key', key, e);
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('Failed to write localStorage key', key, e);
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.error('Failed to remove localStorage key', key, e);
  }
}

// Read-modify-write append onto a JSON array stored at `key`. Never clobbers
// existing entries — reads the current array (or [] if absent), pushes the
// new record, writes the whole array back.
//
// Defensive (Pass 5): readJSON's fallback only kicks in when the key is
// missing or its JSON fails to parse — if the key holds *valid* JSON that
// isn't an array (e.g. hand-edited localStorage, or a future bug elsewhere
// writing the wrong shape), `arr.push` would throw and the record — a
// completed round or nine — would be lost. Falling back to [] in that case
// still beats a crash.
export function appendToArray(key, record) {
  const raw = readJSON(key, []);
  const arr = Array.isArray(raw) ? raw : [];
  arr.push(record);
  writeJSON(key, arr);
  return arr;
}
