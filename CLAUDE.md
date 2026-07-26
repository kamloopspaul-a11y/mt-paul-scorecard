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
- `localStorage` only — keys: `mtpaul-settings`, `currentRound`, `pending-nine-holes`, `rounds-history`, `weekly-anim-week-seen`, `last-screen` (navigation only — see below). No backend, no API calls except the read-only Open-Meteo weather fetch.
- GitHub Pages hosting at a repo subpath — `manifest.json`'s `start_url`/`scope` are relative (`.`/`./`) to work correctly there.

## Data-layer modules — treat as stable, don't rewrite

`js/settings-record.js`, `js/stats-defaults.js` came verbatim from the original design handoff (`Design Handoff/` folder) and are considered correct as-is. If a bug seems to originate there, it almost certainly doesn't — look at how `js/app.js`/`js/stats.js` call them first.

`js/round-record.js` was also in that category until 2026-07-26, when its pairing rule was corrected to Paul's actual spec — see "Widows" below. `buildRoundRecord` itself is still untouched and still correct as-is.

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

## Stale rounds — the day rule + widow rescue (2026-07-26)

`reconcileStaleRound()` runs once at boot. A round left in progress on an **earlier calendar day** (`currentRound.startedAt`, compared as local days) is finished with:

- **9+ holes recorded** → the first nine is rescued as a Widow (pairing with a waiting widow if there is one).
- **fewer than 9** → nothing complete to keep, discarded.

**This is a rescue, not a policy.** Paul: *"The key here is the USER DECIDES... but in the event of a failure, a system crash, dead battery, mis-swipes, etc. an autosave routine rescues the widow."* It can never override a decision, and that falls out of there being no Quit button: every deliberate exit goes through Post Now or Save, and both clear `currentRound`. A round still present at the day boundary means no decision was ever made.

**A calendar day, not a timer.** 30 minutes of inactivity would routinely destroy live rounds — the turn (Mt. Paul is nine holes played twice, so the turn passes the clubhouse), a rain delay, a slow group. A day boundary cannot fire mid-round.

Never touched: a complete 18 unsaved on Final Score (the Pass 5 crash-recovery case), a widow already in `pending-nine-holes`, and rounds with no `startedAt` (nothing to compare — never discard on an assumption).

**There is exactly one time rule in this app.** The screen bookmark had a 30-minute TTL until 2026-07-26; it was removed as unexplainable. The bookmark is now unconditional, and it only ever applies mid-round anyway — with no round in progress, `boot()` lands on Start Round regardless.

### Data safety does not depend on any of this

Every hole is written to localStorage the moment Next is tapped (write-before-navigate). A crash, force-quit, dead battery or accidental close never loses a recorded hole. Timers here only ever *discard*; they play no part in preserving anything. Say so plainly if it comes up again — this was the single most confusing point of the 2026-07-26 session.

## Round Saved screen (2026-07-26)

Final Score > Save lands on a terminal `saved` screen: no buttons, no onward navigation, menu only. Paul plays one round a day, so the realistic next action is Analytics, Membership ROI, or closing the app — never starting a second round.

**A round is now created in exactly one place: the player tapping Start Round.** Save used to end in `goToPlayRound()`, which with `currentRound` just cleared fell through to `startRound()` and silently wrote a brand-new empty 18-hole round to disk, dropping the player on Hole 1. That phantom round also meant `currentRound` effectively always existed, so `boot()`'s mid-flight branch always matched and the Pass 7 "a launch lands on Start Round" rule was unreachable. Don't reintroduce a navigate-onward call here.

The screen is **deliberately blank** — template and plumbing only. `state.savedSnapshot` holds `{ totalScore, parTotal, playerName, date }`, captured before `currentRound` is cleared, ready for the content Paul is designing (a rotating end-card in the spirit of Chuck Lorre's vanity cards).

The widow equivalent is NOT routed here — the Front 9 Score screen's own "Round Saved." posted state keeps the nine-hole scorecard visible behind the confirmation, which is more informative.

## Widows — short rounds (2026-07-26, Paul's spec, verbatim)

> Most rounds will be 18 holes, but on occasion due to weather, we will quit after playing 9 holes. We might even be on Hole 16 and decide to quit. The standing order is to disregard the back 9 if it is incomplete, but to save the front 9 because it is complete. This 'solo' front 9 is considered as only 'half a round' and flagged as a "Widow". The widow is saved and stored in waiting to pair up with another Widow in order to make a completed round.

Consequences, all now enforced in code:

- **Every round starts at Hole 1 and is 18 holes.** `startRound()` takes no arguments. There is no back-nine session and no standalone-nine session; both were suppositions from the initial port and are deleted.
- **A Widow is only created by quitting a round that has completed at least its first nine.** Only holes 1-9 are kept; anything played past hole 9 in an abandoned round is discarded.
- **Two Widows make a round.** `resolvePendingNine` pairs whenever a widow is waiting. It used to require complementary halves (front+back), which — since every widow is a first nine — could never be satisfied, so widows were banked and never recovered. **Do not reintroduce a half/complementary check**; on a nine-hole course it has no meaning.
- **The newer widow's holes are renumbered 10-18 when paired.** `stats.js` detects the double loop via `Math.max(...holeNum) === 18`; leaving a paired round as 1-9,1-9 would make it read as a nine-hole course and corrupt Hole Ratings.

Known gap: `quitCurrentRound()` implements the quit-at-16 case correctly but **has no caller** — there is no Quit control in the UI, so the only way to create a Widow today is Post Now on the Front 9 Score screen, i.e. at exactly hole 9.

## Screen restoration on launch (2026-07-26)

`boot()` decides the landing screen. Two mechanisms live there and they are NOT the same thing — don't merge them:

- **Crash recovery** (`finalscore` / `front9score` branches): fires unconditionally. Catches a round whose holes are all recorded but that was never tapped Save; without it the next Play 18 silently overwrites and permanently loses it. Never gate these on anything.
- **Convenience resume** (`last-screen` key, 30-min TTL): remembers the screen you were on so a reload or a return from another app comes back there. Restores only `hole`/`reports`/`setup`/`startround`, and only within the TTL — a reload and a cold PWA launch are indistinguishable from inside the app, so the timestamp is what separates "stepped away mid-round" from "opened the app today". Falls back to resuming the round. Allowed to fail; losing this key costs nothing.

Before 2026-07-26 the mid-flight branch dragged the user into a hole screen on every launch, so reloading from Analytics threw you out of it.

## Next session — start here

1. Real-browser/on-device check (dark mode, webfonts, offline behaviour).
2. Resolve the post-onboarding landing-screen decision (Home vs Settings) — see PROJECT.md.
3. Commit, push, redeploy GitHub Pages.
4. Share with Dave.

## Key references

- Main Golf app: `~/Documents/Studio/Projects/Golf/` — do NOT modify (its `fetchWeather()` pattern was ported here, that's the only cross-reference)
- This project: `~/Documents/Studio/Projects/ScoreCard/`
- Original design handoff (spec + mockups + reference implementation this build came from): `Design Handoff/` in this project's own folder
