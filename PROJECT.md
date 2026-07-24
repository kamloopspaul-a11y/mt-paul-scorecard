# PROJECT — A Bit of Bogey

*A standalone digital golf scorecard + stats PWA for Mt. Paul Golf Course, Kamloops BC. Separate from Paul's main Golf Scores app. Distributed via link/QR code, installed as a PWA on any phone. Formerly prototyped under the working name "Mt. Paul Card"/"ScoreCard" — renamed and rebuilt from scratch 2026-07-23 (the old Spring Green concept was carried into `Projects/Golf` instead; this project is the new, separate build).*

---

## Status

**Version:** v1.0 (Passes 1-5 of the initial build complete, 2026-07-23) — functional, not yet committed to git, not yet tested on a real device/browser.
**Live URL:** https://kamloopspaul-a11y.github.io/mt-paul-scorecard/ (not yet redeployed with this build — still showing the old placeholder as of this writing).
**GitHub repo:** `https://github.com/kamloopspaul-a11y/mt-paul-scorecard`.
**Local folder:** `~/Documents/Studio/Projects/ScoreCard/`.

### What's built
- **Onboarding → Setup/Settings → Home** flow, with a Mt. Paul film-poster-style onboarding screen.
- **Live 18-hole (or 9-hole) scoring**: real stroke counter, FIR/GIR/PEN/UD toggles (FIR shown on every hole including par-3s, per owner decision 2026-07-23), putts counter, per-hole crash-resilient localStorage writes.
- **Quit logic**: discards rounds under 9 holes, saves 9+ holes as a pending nine-hole record.
- **Nine-hole pairing**: a later front/back nine automatically pairs with a waiting widow into a full 18-hole record; a same-half replay abandons the old widow rather than faking a pairing.
- **Final Score → Save**: builds and appends a real round record to `rounds-history` in localStorage.
- **Analytics/Reports screen**: Season Stats, Score Distribution, WHS-style Handicap Index (best-8-of-20 differentials × 0.96, truncated), 20-Round Average, per-hole Hole Ratings, Scrambling/Putting/Penalty splits, Weekly Trends (real-calendar-anchored, gated to 2+ rounds, with a one-time grow-in animation on a newly-revealed week), Today's Stats (gated to 1+ round), Membership ROI (cumulative savings + rounds-to-break-even, gated on Settings having real fee values).
- **Settings screen**: name, dark/light mode (instant toggle), tee (Blue/Red), stats visibility, Membership Fee, Green Fees, a live weather readout (Open-Meteo, no key required), and a visible-but-disabled "Export Scores" row (CSV export/import is an explicitly deferred later phase — see below).
- **PWA/offline**: `manifest.json` (GitHub-Pages-subpath-correct `start_url`/`scope`), a cache-first `sw.js` (versioned `bogey-v3`) precaching the full app shell, real icon set.
- **Architecture**: multi-file (`index.html` + `css/styles.css` + `js/*.js` ES modules), not a single-file app. Data-layer modules (`round-record.js`, `settings-record.js`, `stats-defaults.js`) came verbatim from the design handoff and are considered stable/correct — don't rewrite their logic, only the app shell/UI around them.

### Known limitations / open items
- **Not yet tested in a real browser/device.** All verification this build cycle was via Node/jsdom harnesses (no headless browser available in the build sandbox) — a real on-device pass (especially the two new webfonts, dark mode, and offline/service-worker behavior) is recommended before sharing with Dave.
- **Onboarding movie-credits copy was reconstructed**, not transcribed verbatim, from a garbled/overlapping source image layer — worth checking against the original design file if the exact wording/names matter.
- **Post-onboarding landing screen is still an open decision.** Right now, completing Setup for the first time lands on Home, and every later launch also lands on Home. Paul is considering having first-time completion land on Settings instead (so a new player reviews their info before playing), with Home only as the default on later launches — deferred until after this build review.
- **No dark-mode source mockup exists** — the dark palette (dark background, off-white text, same maroon CTA gradient) was a judgment call, not a spec match.
- **CSV Export/Import is deferred.** The Settings screen shows the row per the mockup but it's non-functional (shows a "coming soon" toast). See the "Export / Import — CSV Backup" section below for the already-researched spec to build against when this phase starts.
- **`sw.js`'s `CACHE_NAME` must be bumped** (currently `bogey-v3`) any time a precached file's content changes, or already-installed users will keep serving stale assets.

---

## Distribution Model — Two Firewalled Tracks

Decided 2026-07-07: this project splits into two separate builds before production, kept fully independent of each other and of the main Golf app. **This build (v1.0) is the Private Distribution track only.**

**1. Market Distribution (with Dashboard)** — not started
- Public-facing version aimed at anonymous walk-up players at Mt. Paul
- Shared via QR code poster at pro shop / first tee
- Includes GA4 usage tracking and an analytics dashboard (rounds tracked, unique users, peak days) — the value prop for the pitch to Dan Latin / pro shop staff
- Carries Phase 1-3 of the original Vision (booking button, club life, events) — see "Business Model" and "Tee Time Integration" below for that pitch material, kept for whenever this track starts

**2. Private Distribution (localStorage only) — this is what v1.0 is**
- Shared privately via text link (e.g., to Dave) for personal use between known players
- No account, no backend, no Apps Script, no analytics, no dashboard
- Scores persist only in the local player's browser (`localStorage`)

**Firewall rule:** the two tracks do not share files, a repo, or analytics/config. Neither ties into the main Golf app's Google Sheets / webhook infrastructure.

---

## Core Spec (Private track, as built)

- Mt. Paul Golf Course — Blue or Red tees (player's choice in Settings)
- 9 holes looped twice = 18 holes, Blue tees Par 64 / 3,974 yards (see `mt-paul-course-data.json` for full per-hole par/yardage/stroke-index, both tees)
- Name captured once in Setup, editable later in Settings
- Full stat tracking: score, putts, FIR, GIR, PEN, UD per hole
- Scores persist via localStorage (survive back button, tab close, and — as of the Pass 5 crash-resilience fix — a completed-but-unsaved Final Score screen surviving a reload)
- Full back-navigation to edit a just-recorded hole (from Final Score's Back button)

---

## PWA Spec (as built)

- `index.html` + `css/styles.css` + `js/*.js` (multi-file, ES modules) + `manifest.json` + `sw.js`
- Service Worker: cache-first, versioned (`bogey-v3`), full app-shell precache
- `display: standalone`, `viewport-fit=cover` with real `env(safe-area-inset-*)` usage
- Theme colours: CTA gradient `#8C2E39` → `#5C1620`, light-mode background `#F4EFE3`, dark mode available
- Fonts: Bebas Neue (titles/score numerals), Hanken Grotesk (UI labels), loaded from Google Fonts (system-font fallback when offline on first-ever launch)
- Icons: full 32/192/512/maskable/apple-touch set in `icons/`

---

## Export / Import — CSV Backup (researched, not yet built)

Applies to the Private Distribution track. No account, no backend — CSV export/import is the only backup/portability mechanism (phone upgrades, personal backup, importing scores elsewhere).

- **Export (primary path):** Web Share API Level 2, `navigator.share({ files: [csvFile] })`, feature-detected via `navigator.canShare({ files: [...] })`. Pops the native iOS share sheet — works inside the installed standalone PWA. Must be called synchronously from the tap handler (user-gesture requirement); keep CSV-build fast/synchronous before the `share()` call.
- **Export (fallback path):** if `canShare` with files is unsupported, open the CSV as a blob URL in a new tab.
- **Not usable at all:** `<a download>` inside standalone mode (historically unreliable across iOS versions) and the File System Access API (not implemented in WebKit on any iOS version).
- **Import:** plain `<input type="file" accept=".csv">` + `FileReader` — no known standalone-mode issues.
- **Must-test-on-device item:** some iOS point releases have had share-sheet bugs specific to home-screen-launched standalone PWAs vs. Safari tabs — test from the installed icon, not a Safari tab or desktop dev tools.

---

## Tee Time Integration (Market track only, not built)

- Mt. Paul uses Chronogolf (owned by Lightspeed)
- Phase 1: simple link button → their Chronogolf public booking URL
- Full API integration not realistic (requires Lightspeed enterprise partnership)

---

## Business Model (Market track pitch, not started)

Decision maker: Dan Latin (owner) or pro shop staff.
- Branded digital scorecard replaces paper cards; QR poster drives installs; booking shortcut drives Chronogolf traffic; GA4 monthly usage report
- Pricing options: one-time build fee $500-$1,500; monthly maintenance $50-$150/month; sponsor facilitation cut (future)
- Template reuse: same build deployable to other Kamloops courses (Bighorn, Sun Peaks, etc.) with branding swap

---

## Files in This Project

| File | Notes |
|------|-------|
| `PROJECT.md` | This file |
| `JOURNAL.md` | Session notes — Sessions 1-4 cover the old placeholder/style-exploration era; Sessions 5+ cover the real v1.0 build (Session 5 = CSV research, 6 = Analytics, 7 = Settings/weather/PWA, 8 = visual fidelity, 9 = debug pass) |
| `CLAUDE.md` | Claude context for future sessions — kept in sync with this file |
| `index.html` | Real app shell (replaced the placeholder 2026-07-23) |
| `css/styles.css`, `js/*.js` | App code — see "What's built" above |
| `manifest.json`, `sw.js`, `icons/` | PWA files |
| `mt-paul-course-data.json`, `mt-paul-handicap-ratings.json` | Course/tee/handicap data, project root (fetched at runtime) |
| `assets/` | Hole photos, logo (`assets/Logos/mt_paul_logo_vector.svg`), onboarding/final-score art |
| `Design Handoff/` | The original design handoff package (README spec, `.dc.html` design reference, mockup screenshots, source data files) this build was implemented from — kept for reference, not shipped |
| `wip/` | Gitignored scratch space for in-progress work not yet promoted |

---

## Next Steps

1. Real-browser/on-device smoke test (dark mode, webfonts, offline/service-worker behaviour, share-sheet-adjacent UI).
2. Decide the post-onboarding landing screen question (Home vs Settings on first completion).
3. Commit and push to GitHub, redeploy GitHub Pages.
4. Share with Dave for first real-world use.
5. When ready: build CSV Export/Import per the researched spec above.
