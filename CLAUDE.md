# CLAUDE.md — A Bit of Bogey

*Context file for Claude. Read this along with PROJECT.md and JOURNAL.md at the start of each session on this project.*

---

## What this project is

A standalone PWA golf scorecard + stats app for Mt. Paul Golf Course, Kamloops BC. Completely separate from Paul's main Golf Scores app (`golf-scores` repo) — do not modify that project from here. Private-Distribution track only (localStorage, no backend) — see PROJECT.md's "Distribution Model" for the Market track that isn't built yet.

Renamed and rebuilt from scratch 2026-07-23 under the name **"A Bit of Bogey."** The old "Mt. Paul Card"/"ScoreCard" concept (Spring Green branding) is superseded — ignore any lingering reference to it elsewhere in this repo's older history.

## Who it's for

- Dave (Paul's golf friend at Mt. Paul) — first real-world user
- Other Mt. Paul golfers — shared via text or QR code
- (Market track, later, separately) Mt. Paul clubhouse as a branded companion app

## Tech stack (as built, 2026-07-23)

- **Multi-file**, not single-file: `index.html` + `css/styles.css` + `js/*.js` (ES modules, `type="module"`).
- **Must be served over http(s)** to work (ES modules + `fetch()` fail under `file://`) — use `python3 -m http.server` (or equivalent) for local testing, not double-clicking `index.html`.
- No framework, no build step, no bundler.
- `manifest.json` + `sw.js` for PWA/offline (cache-first, versioned — bump `CACHE_NAME` in `sw.js` whenever a precached file's content changes).
- `localStorage` only — keys: `mtpaul-settings`, `currentRound`, `pending-nine-holes`, `rounds-history`, `weekly-anim-week-seen`. No backend, no API calls except the read-only Open-Meteo weather fetch.
- GitHub Pages hosting at a repo subpath — `manifest.json`'s `start_url`/`scope` are relative (`.`/`./`) to work correctly there.

## Data-layer modules — treat as stable, don't rewrite

`js/round-record.js`, `js/settings-record.js`, `js/stats-defaults.js` came verbatim from the original design handoff (`Design Handoff/` folder) and are considered correct as-is. If a bug seems to originate there, it almost certainly doesn't — look at how `js/app.js`/`js/stats.js` call them first.

## Colour / branding

- CTA gradient: `#8C2E39` → `#5C1620` (maroon), used identically in light and dark mode
- Light mode background: `#F4EFE3`; dark mode is a dark near-black/charcoal background with off-white text (no source mockup for dark mode — a judgment call, revisit if Paul wants a specific palette)
- Fonts: Bebas Neue (titles/score numerals), Hanken Grotesk (UI labels) — loaded from Google Fonts, falls back to system fonts if offline on a first-ever (never-cached) launch
- Logo: `assets/Logos/mt_paul_logo_vector.svg`

## Course data — NOT hardcoded, fetched at runtime

`mt-paul-course-data.json` (par/yardage/stroke-index, Blue + Red tees, project root) and `mt-paul-handicap-ratings.json` (Course Rating/Slope, kept separate since ratings are reissued seasonally) — both fetched via `js/course-data.js` / `js/stats.js`. Don't hardcode hole data into JS — update the JSON files instead.

## Golf stat definitions (get these right)

- **GIR**: ball reaches the green in (par − 2) strokes or fewer.
- **Putts**: only strokes taken with the ball already on the green. A putter stroke from off the green is a stroke (can still count toward GIR) but must NOT increment putts.
- **FIR**: shown and counted on every hole, including par-3s (owner decision, 2026-07-23 — overrides the more conventional "no fairway on a par-3" read that an earlier draft used).

## What's built (2026-07-23, v1.0)

See PROJECT.md's "What's built" section for the full list — round capture, Analytics/Reports, Settings (incl. weather + membership ROI inputs), PWA/offline. Not yet: on-device testing, git commit/push, CSV export/import.

## Next session — start here

1. Real-browser/on-device check (dark mode, webfonts, offline behaviour).
2. Resolve the post-onboarding landing-screen decision (Home vs Settings) — see PROJECT.md.
3. Commit, push, redeploy GitHub Pages.
4. Share with Dave.

## Key references

- Main Golf app: `~/Documents/Studio/Projects/Golf/` — do NOT modify (its `fetchWeather()` pattern was ported here, that's the only cross-reference)
- This project: `~/Documents/Studio/Projects/ScoreCard/`
- Original design handoff (spec + mockups + reference implementation this build came from): `Design Handoff/` in this project's own folder
